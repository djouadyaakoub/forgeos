/**
 * ForgeOS — ephemeral agent factory
 * Flat exec path: .cursor/agents/<agent_id>.md (mandatory for Cursor discovery)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRules } from './engine.mjs';
import { getProjectDir } from './project-adapter.mjs';

function projectDir() {
  return getProjectDir();
}

export const EPHEMERAL_ID_PREFIX = 'ephemeral-';

export const GLOBAL_PERMANENT_AGENT_IDS = [
  'orchestrator',
  'architect',
  'qa-bugfix',
  'docs-sync',
  'security',
  'codebase-organization',
  'solution-research',
  'project-archaeology',
  'release-readiness',
  'release-deployment',
  'environment-config',
];

export const CRITICAL_SENSITIVE_FLAGS = [
  'production_deploy',
  'destructive_database',
  'credential_systems',
  'security_boundary',
  'financial_data',
  'auth_tenancy',
];

export const EPHEMERAL_FORBIDDEN_WRITE_PREFIXES = [
  '.cursor/agents/',
  '.cursor/hooks/',
  '.cursor/policy/',
  '.cursor/skills/',
  'docs/agents/RUNTIME_LAW.md',
  'docs/agents/design/',
  '.cursor/agent-state/',
  '.agent-os/',
];

export const EPHEMERAL_FORBIDDEN_WRITE_EXACT = [
  '.cursor/agents/registry.yaml',
  '.cursor/hooks.json',
];

export function getPermanentAgentIds() {
  const rules = loadRules();
  const projectIds = Object.keys(rules.agents || {});
  return [...new Set([...GLOBAL_PERMANENT_AGENT_IDS, ...projectIds])];
}

function normalizeRelPath(filePath) {
  if (!filePath) return '';
  const raw = String(filePath);
  const abs = path.isAbsolute(raw) ? raw : path.join(projectDir(), raw);
  let rel = path.relative(projectDir(), abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
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

export function isEphemeralAgentId(agentId) {
  return String(agentId || '').startsWith(EPHEMERAL_ID_PREFIX);
}

export function generateAgentId(taskId, slug) {
  const safeSlug = String(slug || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${EPHEMERAL_ID_PREFIX}${taskId}-${safeSlug}`;
}

export function specsDir() {
  const rules = loadRules();
  return path.join(projectDir(), rules.ephemeral_factory?.specs_dir || 'docs/agents/ephemeral');
}

export function specPathForAgentId(agentId) {
  return path.join(specsDir(), `${agentId}.yaml`);
}

export function execPathForAgentId(agentId) {
  return path.join(projectDir(), '.cursor/agents', `${agentId}.md`);
}

export function buildExecMarkdownFromSpec(spec) {
  const allowed = (spec.allowed_paths || []).map((p) => `- \`${p}\``).join('\n');
  return `---
name: ${spec.agent_id}
description: ${spec.purpose || spec.title}
model: inherit
---

# ${spec.title}

**Task:** \`${spec.task_id}\`  
**Ephemeral agent** — task-scoped; factory retires on task completion.

## Purpose

${spec.purpose || ''}

## Allowed paths

${allowed || '- (see specification YAML)'}
`;
}

export function writeEphemeralExecFile(spec) {
  const abs = execPathForAgentId(spec.agent_id);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buildExecMarkdownFromSpec(spec), 'utf8');
  return normalizeRelPath(abs);
}

export function removeEphemeralExecFile(agentId) {
  const abs = execPathForAgentId(agentId);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    return true;
  }
  return false;
}

function activeRegistryPath() {
  const rules = loadRules();
  return path.join(projectDir(), rules.ephemeral_factory?.runtime_registry || '.cursor/agent-state/active-ephemeral.json');
}

export function loadActiveEphemeralRegistry() {
  const p = activeRegistryPath();
  if (!fs.existsSync(p)) return { schema_version: 1, agents: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { schema_version: 1, agents: {} };
  }
}

export function saveActiveEphemeralRegistry(data) {
  const p = activeRegistryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function parseSimpleYamlSpec(content) {
  const spec = {};
  const lines = content.split(/\r?\n/);
  let currentList = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentList) {
      spec[currentList].push(listItem[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      spec[key] = [];
      currentList = key;
      continue;
    }
    currentList = null;
    spec[key] = value.trim().replace(/^["']|["']$/g, '');
  }
  for (const k of ['allowed_paths', 'forbidden_paths', 'capabilities', 'domains']) {
    if (spec[k] && !Array.isArray(spec[k])) spec[k] = [spec[k]];
  }
  return spec;
}

export function loadEphemeralSpec(agentId) {
  const specFile = specPathForAgentId(agentId);
  if (!fs.existsSync(specFile)) return null;
  return parseSimpleYamlSpec(fs.readFileSync(specFile, 'utf8'));
}

export function validateEphemeralSpec(spec) {
  const rules = loadRules();
  const prefix = rules.project?.task_id_prefix || 'TASK';
  const taskPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}-\\d{3}$`);
  const errors = [];

  if (!spec?.agent_id || !isEphemeralAgentId(spec.agent_id)) {
    errors.push('agent_id must start with ephemeral- and include task id');
  }
  if (!spec?.task_id || !taskPattern.test(spec.task_id)) {
    errors.push(`task_id must match ${prefix}-YYYYMMDD-NNN`);
  }
  if (!spec?.title || !spec?.purpose) errors.push('title and purpose required');
  if (!Array.isArray(spec.allowed_paths) || spec.allowed_paths.length === 0) {
    errors.push('allowed_paths must be a non-empty narrow allowlist');
  }
  if ((spec.approval_tier_max ?? 2) > 2 && spec.approval_tier_max !== 3) {
    errors.push('approval_tier_max must be <= 2 unless explicitly set to 3 with human approval');
  }
  const forbiddenProfiles = ['release', 'production-restricted', 'forbidden'];
  if (forbiddenProfiles.includes(spec.tool_profile)) {
    errors.push(`tool_profile ${spec.tool_profile} is not allowed for ephemeral agents`);
  }
  for (const p of spec.allowed_paths || []) {
    if (matchesAny(p, EPHEMERAL_FORBIDDEN_WRITE_PREFIXES) || EPHEMERAL_FORBIDDEN_WRITE_EXACT.includes(normalizeRelPath(p))) {
      errors.push(`allowed_paths cannot include protected path ${p}`);
    }
  }
  if (!spec.retirement?.condition && !spec.retirement_condition) {
    errors.push('retirement condition required');
  }
  return { valid: errors.length === 0, errors };
}

export function buildAgentConfigFromSpec(spec) {
  let tierMax = Number(spec.approval_tier_max ?? 2);
  if (tierMax > 3) tierMax = 3;
  if (tierMax === 3 && spec.status !== 'approved') tierMax = 2;
  return {
    ephemeral: true,
    agent_id: spec.agent_id,
    task_id: spec.task_id,
    tool_profile: spec.tool_profile || 'implement-local',
    approval_tier_max: tierMax,
    paths_writable: spec.allowed_paths || [],
    paths_forbidden: [...(spec.forbidden_paths || []), ...defaultForbiddenPathsForSpec(spec)],
    capabilities: spec.capabilities || [],
    domains: spec.domains || [],
    status: spec.runtime_status || spec.status || 'proposed',
  };
}

export function defaultForbiddenPathsForSpec(spec) {
  return [
    ...EPHEMERAL_FORBIDDEN_WRITE_PREFIXES.map((p) => (p.endsWith('/') ? `${p}**` : p)),
    ...EPHEMERAL_FORBIDDEN_WRITE_EXACT,
    `docs/agents/ephemeral/${spec.agent_id}.yaml`,
    `.cursor/agents/${spec.agent_id}.md`,
  ];
}

export function getEphemeralAgentConfig(agentId) {
  if (!isEphemeralAgentId(agentId)) return null;
  const registry = loadActiveEphemeralRegistry();
  const entry = registry.agents?.[agentId];
  if (!entry || !['active', 'verification'].includes(entry.status)) return null;
  const spec = loadEphemeralSpec(agentId);
  if (!spec) return null;
  return buildAgentConfigFromSpec({ ...spec, runtime_status: entry.status });
}

export function isEphemeralWriteForbidden(agentId, relPath) {
  if (!isEphemeralAgentId(agentId)) return false;
  const p = normalizeRelPath(relPath);
  if (EPHEMERAL_FORBIDDEN_WRITE_EXACT.includes(p)) return true;
  if (matchesAny(p, EPHEMERAL_FORBIDDEN_WRITE_PREFIXES)) return true;
  if (p === normalizeRelPath(specPathForAgentId(agentId))) return true;
  if (p === normalizeRelPath(execPathForAgentId(agentId))) return true;
  return false;
}

export function activateEphemeralAgent(spec, { force = false } = {}) {
  const validation = validateEphemeralSpec(spec);
  if (!validation.valid && !force) return { ok: false, errors: validation.errors };
  if (!['approved', 'active'].includes(spec.status) && !force) {
    return { ok: false, errors: ['status must be approved before activation'] };
  }
  writeEphemeralExecFile(spec);
  const registry = loadActiveEphemeralRegistry();
  registry.agents[spec.agent_id] = {
    status: 'active',
    task_id: spec.task_id,
    spec_path: normalizeRelPath(specPathForAgentId(spec.agent_id)),
    exec_path: normalizeRelPath(execPathForAgentId(spec.agent_id)),
    activated_at: new Date().toISOString(),
    retirement_condition: spec.retirement?.condition || spec.retirement_condition || 'task_completed',
  };
  saveActiveEphemeralRegistry(registry);
  return { ok: true, registry_entry: registry.agents[spec.agent_id] };
}

export function retireEphemeralAgent(agentId, reason = 'task_completed', status = 'retired') {
  const registry = loadActiveEphemeralRegistry();
  if (!registry.agents?.[agentId]) return { ok: false, errors: ['agent not in active registry'] };
  registry.agents[agentId].status = status;
  registry.agents[agentId].retired_at = new Date().toISOString();
  registry.agents[agentId].retirement_reason = reason;
  saveActiveEphemeralRegistry(registry);
  removeEphemeralExecFile(agentId);
  return { ok: true, entry: registry.agents[agentId] };
}

export function evaluatePromotionCandidate(history = []) {
  const recent = history.filter((h) => h.outcome === 'success');
  if (recent.length < 3) return { candidate: false, reason: 'fewer_than_3_successful_uses' };
  return { candidate: true, reason: 'recurring_capability_detected', promotion_allowed: false, next_step: 'human_git_review_required' };
}

export function classifyGapSeverity(gapContext, input = {}) {
  const flags = input.sensitive_flags || {};
  const criticalHit = CRITICAL_SENSITIVE_FLAGS.some((f) => flags[f] === true);
  if (criticalHit) return 'critical';
  const { confidence, bestScore = 0 } = gapContext;
  if (confidence === 'high' || bestScore >= 0.8) return 'none';
  if (confidence === 'medium') return 'weak';
  return 'material';
}

export function evaluateCapabilityGap(input = {}) {
  const rules = loadRules();
  const scores = getPermanentAgentIds()
    .filter((id) => id !== 'orchestrator')
    .map((id) => {
      const agentCfg = rules.agents[id] || {};
      const affected = input.affected_paths || [];
      const writable = agentCfg.paths_writable || [];
      const pathHits = affected.length === 0 ? 1 : affected.filter((p) => matchesAny(p, writable)).length / affected.length;
      return { agentId: id, total: pathHits, pathScore: pathHits };
    });
  scores.sort((a, b) => b.total - a.total);
  const best = scores[0] || { total: 0, agentId: null };
  let confidence = 'none';
  if (best.total >= 0.8) confidence = 'high';
  else if (best.total >= 0.55) confidence = 'medium';
  else if (best.total >= 0.25) confidence = 'low';
  const gapSeverity = classifyGapSeverity({ confidence, bestScore: best.total }, input);
  return {
    confidence,
    gap_severity: gapSeverity,
    best_agent: best.agentId,
    best_score: best.total,
    scores,
    sufficient_existing_capability: confidence === 'high',
    requires_architect: gapSeverity === 'material' || gapSeverity === 'critical',
    requires_human: gapSeverity === 'critical',
  };
}
