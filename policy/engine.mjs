/**
 * ForgeOS — policy engine
 * Loads global baseline + project adapter; fail-closed by default.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadEffectiveRules,
  getProjectDir,
  getTasksBasePath,
  getTaskIdPattern,
} from './project-adapter.mjs';
import { POLICY_AUTHORITY } from './runtime.mjs';
import {
  getEphemeralAgentConfig,
  isEphemeralAgentId,
  isEphemeralWriteForbidden,
} from './ephemeral-factory.mjs';

function projectDir() {
  return getProjectDir();
}

export function loadRules() {
  return loadEffectiveRules(projectDir());
}

export function getPolicyAuthority() {
  return POLICY_AUTHORITY;
}

export function loadSession() {
  const sessionPath = path.join(projectDir(), '.cursor/policy/runtime-session.json');
  if (!fs.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch {
    return null;
  }
}

export function saveSession(data) {
  const sessionPath = path.join(projectDir(), '.cursor/policy/runtime-session.json');
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
}

export function clearSession() {
  const sessionPath = path.join(projectDir(), '.cursor/policy/runtime-session.json');
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
}

export function resolveSession(session) {
  return session ?? loadSession();
}

function normalizeRelPath(filePath) {
  if (!filePath) return '';
  const raw = String(filePath);
  const abs = path.isAbsolute(raw) ? raw : path.join(projectDir(), raw);
  let rel = path.relative(projectDir(), abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  let p = raw.replace(/\\/g, '/');
  const root = projectDir().replace(/\\/g, '/').replace(/\/$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    p = p.slice(root.length + 1);
  }
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

function globMatch(relPath, pattern) {
  const p = normalizeRelPath(relPath);
  const pat = pattern.replace(/\\/g, '/');
  const regex = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*');
  return new RegExp(`^${regex}$`, 'i').test(p);
}

function matchesAny(relPath, patterns = []) {
  return patterns.some((g) => globMatch(relPath, g));
}

function listTaskFiles() {
  const rules = loadRules();
  const base = path.join(projectDir(), getTasksBasePath(rules));
  const files = [];
  for (const bucket of ['active', 'completed', 'archived']) {
    const dir = path.join(base, bucket);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskFile = path.join(dir, entry.name, 'task.yaml');
      if (fs.existsSync(taskFile)) files.push(taskFile);
    }
  }
  return files;
}

function parseSimpleYamlApproval(content) {
  const approval = { required: false, status: 'not_required', scope: [] };
  const block = content.match(/approval:\s*\n([\s\S]*?)(?:\n[a-z_]+:|$)/);
  if (!block) return approval;
  const lines = block[1];
  const req = lines.match(/^\s*required:\s*(true|false)/m);
  if (req) approval.required = req[1] === 'true';
  const status = lines.match(/^\s*status:\s*(\S+)/m);
  if (status) approval.status = status[1];
  const scopeMatch = lines.match(/^\s*scope:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (scopeMatch) {
    approval.scope = [...scopeMatch[1].matchAll(/^\s*-\s*(.+)$/gm)].map((m) =>
      m[1].trim().replace(/^["']|["']$/g, '')
    );
  }
  return approval;
}

export function taskFilePathForId(taskId) {
  if (!taskId) return null;
  const rules = loadRules();
  const base = path.join(projectDir(), getTasksBasePath(rules));
  for (const bucket of ['active', 'completed', 'archived']) {
    const taskFile = path.join(base, bucket, taskId, 'task.yaml');
    if (fs.existsSync(taskFile)) return taskFile;
  }
  return null;
}

export function loadTaskApprovalForId(taskId) {
  const taskFile = taskFilePathForId(taskId);
  if (!taskFile) return null;
  const content = fs.readFileSync(taskFile, 'utf8');
  const approval = parseSimpleYamlApproval(content);
  return {
    task_id: taskId,
    approval,
    task_file: taskFile.replace(/\\/g, '/'),
  };
}

export function findApprovalForTask(taskId, operation) {
  if (!taskId || !operation) return null;
  const loaded = loadTaskApprovalForId(taskId);
  if (!loaded) return null;
  if (loaded.approval.status !== 'approved') return null;
  if (!loaded.approval.scope.includes(operation)) return null;
  return loaded;
}

export function parseTaskIdFromEphemeralAgentId(agentId) {
  if (!isEphemeralAgentId(agentId)) return null;
  const rules = loadRules();
  const prefix = rules.project?.task_id_prefix || 'TASK';
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = agentId.match(new RegExp(`^ephemeral-(${escaped}-\\d{8}-\\d{3})-`));
  return match ? match[1] : null;
}

export function resolveCurrentTaskId(session, agentId) {
  const sess = resolveSession(session);
  if (sess?.task_id) return String(sess.task_id);
  if (isEphemeralAgentId(agentId)) {
    const cfg = getEphemeralAgentConfig(agentId);
    if (cfg?.task_id) return cfg.task_id;
    return parseTaskIdFromEphemeralAgentId(agentId);
  }
  return null;
}

function getEffectiveAgentTierMax(agentId) {
  const agent = getAgentConfig(agentId);
  const profile = getToolProfile(agent.tool_profile);
  const agentTier = Number(agent.approval_tier_max ?? 2);
  const profileTier = Number(profile.approval_tier_max ?? 0);
  return Math.min(agentTier, profileTier);
}

export function evaluateApprovalForOperation(operation, taskId = null) {
  if (!taskId) {
    return { permission: 'deny', reason: 'missing_task_context' };
  }
  const approved = findApprovalForTask(taskId, operation);
  if (approved) {
    return { permission: 'allow', task_id: approved.task_id, reason: 'approved_scope_match' };
  }
  return { permission: 'deny', reason: 'no_approved_scope_match' };
}

export function appendAudit(entry) {
  const auditPath = path.join(projectDir(), '.cursor/policy/audit.log');
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, line + '\n');
}

export function resolveAgentId(session) {
  const sess = resolveSession(session);
  if (!sess?.subagent_type) return 'orchestrator';
  const t = sess.subagent_type;
  if (isEphemeralAgentId(t)) return t;
  const rules = loadRules();
  if (rules.agents[t]) return t;
  if (t === 'generalPurpose' || t === 'explore' || t === 'shell') return 'orchestrator';
  return t;
}

function getAgentConfig(agentId) {
  if (isEphemeralAgentId(agentId)) {
    const ephemeral = getEphemeralAgentConfig(agentId);
    if (ephemeral) return ephemeral;
  }
  const rules = loadRules();
  return rules.agents[agentId] || rules.agents.orchestrator;
}

function getToolProfile(name) {
  const rules = loadRules();
  return rules.tool_profiles[name] || rules.tool_profiles['read-explore'];
}

function isProtectedPath(relPath) {
  const rules = loadRules();
  const p = normalizeRelPath(relPath);
  if (rules.protected_path_exact?.some((exact) => p === exact.replace(/\\/g, '/'))) {
    return true;
  }
  return (rules.protected_path_prefixes || []).some((pref) => {
    const prefix = pref.replace(/\\/g, '/');
    return p === prefix.replace(/\/$/, '') || p.startsWith(prefix);
  });
}

function classifyShellOperation(command) {
  const rules = loadRules();
  const cmd = String(command || '');
  for (const rule of rules.shell_rules || []) {
    for (const pat of rule.patterns || []) {
      if (new RegExp(pat, 'i').test(cmd)) return rule;
    }
  }
  return null;
}

function classifyMcpOperation(serverName, toolName) {
  const rules = loadRules();
  for (const rule of rules.mcp_rules || []) {
    if (!rule.server_names.includes(serverName)) continue;
    if (!rule.tool_names.includes(toolName)) continue;
    return rule;
  }
  return null;
}

function checkTier3Approval(operation, opTier, agentId, session, context = {}) {
  const effectiveMax = getEffectiveAgentTierMax(agentId);
  const currentTaskId = resolveCurrentTaskId(session, agentId);

  if (isEphemeralAgentId(agentId) && opTier > effectiveMax) {
    const reason = `Tier ${opTier} operation '${operation}' blocked — ephemeral agent '${agentId}' maximum tier is ${effectiveMax}.`;
    appendAudit({ type: 'approval_check', task_id: currentTaskId, operation, agent_id: agentId, requested: true, result: 'deny', reason, ...context });
    return { permission: 'deny', user_message: `Blocked: ${operation} exceeds agent maximum tier (${effectiveMax}).`, agent_message: reason, reason: 'agent_tier_cap' };
  }

  if (!currentTaskId) {
    const reason = `Tier 3 operation '${operation}' blocked — no current task identity in session (fail closed).`;
    appendAudit({ type: 'approval_check', task_id: null, operation, agent_id: agentId, requested: true, result: 'deny', reason, ...context });
    return { permission: 'deny', user_message: `Blocked: ${operation} requires task-bound approval.`, agent_message: reason, reason: 'missing_task_context' };
  }

  const approved = findApprovalForTask(currentTaskId, operation);
  const result = approved ? 'allow' : 'deny';
  const reason = approved
    ? `Tier 3 operation '${operation}' allowed by task ${approved.task_id} approval scope.`
    : `Tier 3 operation '${operation}' blocked for task ${currentTaskId} — requires approval.status: approved with exact scope '${operation}'.`;

  appendAudit({ type: 'approval_check', task_id: currentTaskId, operation, agent_id: agentId, requested: true, result, reason, ...context });

  if (approved) return { permission: 'allow', reason, task_id: currentTaskId };
  return {
    permission: 'deny',
    user_message: `Blocked: ${operation} requires task ${currentTaskId} approval.`,
    agent_message: reason,
    reason: 'tier3_approval_required',
  };
}

function checkPathWrite(relPath, agentId, session = null) {
  const rules = loadRules();
  const p = normalizeRelPath(relPath);
  const agent = getAgentConfig(agentId);
  const profile = getToolProfile(agent.tool_profile);

  if (isEphemeralAgentId(agentId)) {
    if (isEphemeralWriteForbidden(agentId, p)) {
      return { permission: 'deny', user_message: `Blocked: ephemeral agent cannot modify protected paths.`, agent_message: `Ephemeral write forbidden: ${p}`, reason: 'ephemeral_forbidden_path' };
    }
    if (!['active', 'verification'].includes(agent.status)) {
      return { permission: 'deny', user_message: `Blocked: ephemeral agent is not active.`, agent_message: `Ephemeral agent status ${agent.status}`, reason: 'ephemeral_not_active' };
    }
  }

  if (isProtectedPath(p)) {
    if (isEphemeralAgentId(agentId)) {
      return { permission: 'deny', user_message: `Blocked: ephemeral agents cannot modify Agent OS protected configuration.`, agent_message: `Ephemeral denied protected path ${p}`, reason: 'ephemeral_protected_path' };
    }
    const maint = checkTier3Approval('agent_os_config_write', 3, agentId, session, { path: p });
    if (maint.permission === 'allow') return maint;
    return { permission: 'deny', user_message: `Blocked: '${p}' is Agent OS protected configuration.`, agent_message: `Write to protected path ${p} denied.`, reason: 'protected_path' };
  }

  if (agent.handoff_only_writes && (!agent.paths_writable || agent.paths_writable.length === 0)) {
    return { permission: 'deny', user_message: `Blocked: agent '${agentId}' requires explicit handoff allowed_paths.`, agent_message: `Agent ${agentId} has handoff_only_writes.`, reason: 'handoff_only_writes' };
  }

  if (!profile.allows_write) {
    return { permission: 'deny', user_message: `Blocked: tool profile '${agent.tool_profile}' does not allow writes.`, agent_message: `Profile ${agent.tool_profile} prohibits write.`, reason: 'tool_profile_no_write' };
  }

  if (agent.paths_forbidden?.some((g) => globMatch(p, g))) {
    return { permission: 'deny', user_message: `Blocked: path forbidden for agent '${agentId}'.`, agent_message: `Path ${p} forbidden.`, reason: 'forbidden_path' };
  }

  const writable =
    agent.paths_writable?.length > 0
      ? agent.paths_writable
      : agentId === 'orchestrator'
        ? rules.orchestrator_writable_prefixes
        : [];

  if (writable.length === 0 || !matchesAny(p, writable)) {
    return { permission: 'deny', user_message: `Blocked: agent '${agentId}' is not owner of '${p}'.`, agent_message: `Path ownership: ${p} not allowed for ${agentId}.`, reason: 'path_ownership' };
  }

  return { permission: 'allow', reason: 'path_ok' };
}

export function evaluateShell(command, session = null) {
  const sess = resolveSession(session);
  const agentId = resolveAgentId(sess);
  const op = classifyShellOperation(command);

  if (!op) {
    if (/\b(test|build|lint|analyze|check)\b/i.test(command || '')) {
      return { permission: 'allow', reason: 'local_verification_command' };
    }
    return { permission: 'allow', reason: 'no_tier3_match' };
  }

  if (op.tier >= 3) return checkTier3Approval(op.operation, op.tier, agentId, sess, { command });
  return { permission: 'allow', reason: 'tier_below_3' };
}

export function evaluateMcp(serverName, toolName, session = null) {
  const sess = resolveSession(session);
  const agentId = resolveAgentId(sess);
  const op = classifyMcpOperation(serverName, toolName);
  if (!op) return { permission: 'allow', reason: 'mcp_not_classified' };
  if (op.tier >= 3) {
    return checkTier3Approval(op.operation, op.tier, agentId, sess, { mcp_server: serverName, mcp_tool: toolName });
  }
  return { permission: 'allow', reason: 'tier_below_3' };
}

export function evaluatePreToolUse(input) {
  if (input?.__parse_error) {
    return { permission: 'deny', user_message: 'Blocked: hook input could not be parsed — fail closed.', agent_message: 'Hook stdin JSON parse failed.', reason: 'hook_input_parse_error' };
  }

  const sess = resolveSession(null);
  const agentId = resolveAgentId(sess);
  const toolName = input?.tool_name || '';

  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob' || toolName === 'SemanticSearch') {
    return { permission: 'allow', reason: 'tier_0_read' };
  }

  if (toolName === 'Shell') {
    return evaluateShell(input.tool_input?.command, sess);
  }

  if (['Write', 'StrReplace', 'Delete', 'ApplyPatch'].includes(toolName)) {
    const rel = input.tool_input?.path || input.tool_input?.file_path;
    if (!rel) {
      return { permission: 'deny', user_message: 'Blocked: write tool missing path.', agent_message: 'Missing path in write tool_input.', reason: 'missing_path' };
    }
    return checkPathWrite(rel, agentId, sess);
  }

  if (toolName === 'Task') {
    return { permission: 'allow', reason: 'subagent_delegation' };
  }

  if (String(toolName).startsWith('MCP') || String(toolName).includes('MCP')) {
    return { permission: 'allow', reason: 'mcp_handled_by_beforeMCPExecution' };
  }

  if (!toolName) {
    return { permission: 'deny', user_message: 'Blocked: missing tool_name — fail closed.', agent_message: 'Empty tool_name.', reason: 'missing_tool_name' };
  }

  return { permission: 'deny', user_message: `Blocked: unknown tool '${toolName}' — fail closed.`, agent_message: `Unknown tool ${toolName}.`, reason: 'unknown_tool' };
}

export function hookOutput(decision) {
  if (decision.permission === 'allow') {
    return JSON.stringify({ permission: 'allow' });
  }
  return JSON.stringify({
    permission: 'deny',
    user_message: decision.user_message || 'Policy denied this action.',
    agent_message: decision.agent_message || decision.reason || 'Denied by Agent OS policy.',
  });
}

export function readStdinJson() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { __parse_error: true };
  }
}

export function dryRunScenario(name, payload = {}) {
  switch (name) {
    case 'read':
      return evaluatePreToolUse({ tool_name: 'Read', tool_input: { path: payload.path } });
    case 'write':
      clearSession();
      if (payload.agent || payload.task_id) {
        saveSession({ subagent_type: payload.agent, task_id: payload.task_id });
      }
      return evaluatePreToolUse({ tool_name: 'Write', tool_input: { path: payload.path } });
    case 'shell':
      clearSession();
      if (payload.agent || payload.task_id) {
        saveSession({ subagent_type: payload.agent, task_id: payload.task_id });
      }
      return evaluateShell(payload.command);
    case 'mcp':
      clearSession();
      if (payload.agent || payload.task_id) {
        saveSession({ subagent_type: payload.agent, task_id: payload.task_id });
      }
      return evaluateMcp(payload.server, payload.tool);
    case 'approval':
      return evaluateApprovalForOperation(payload.operation, payload.task_id);
    default:
      return { permission: 'deny', reason: 'unknown_scenario' };
  }
}

export { getTaskIdPattern, getTasksBasePath };
