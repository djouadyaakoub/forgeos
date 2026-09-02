/**
 * ForgeOS — project adapter loader
 * Discovers .agent-os/project.yaml and merges with global baseline.
 * Projects may only NARROW policy — never weaken global security baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectDir, resolveProjectDirFromCandidates, collectProjectCandidates } from './runtime.mjs';
import { resolveTestDirFromEnv } from './identity.mjs';

const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));

export const MANIFEST_PATH = '.agent-os/project.yaml';
export const MANIFEST_JSON_PATH = '.agent-os/project.json';

export function getProjectDir(hookInput = null) {
  if (process.env.CURSOR_PROJECT_DIR) return path.resolve(process.env.CURSOR_PROJECT_DIR);
  const testDir = resolveTestDirFromEnv();
  if (testDir) return path.resolve(testDir);
  return resolveProjectDir(hookInput);
}

/**
 * Normalize legacy agent_os block to forgeos (read-time compat).
 */
export function normalizeProjectManifest(data) {
  if (!data || typeof data !== 'object') return data;
  const normalized = { ...data };
  if (!normalized.forgeos && normalized.agent_os) {
    normalized.forgeos = { ...normalized.agent_os, _migrated_from: 'agent_os' };
  }
  if (normalized.forgeos && !normalized.agent_os) {
    normalized.agent_os = normalized.forgeos;
  }
  return normalized;
}

export function getForgeOsBlock(manifest) {
  return manifest?.forgeos || manifest?.agent_os || null;
}

export { resolveProjectDirFromCandidates, collectProjectCandidates };

export function loadGlobalRules() {
  const rulesPath = path.join(PLUGIN_ROOT, 'rules.json');
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
}

export function getPluginRoot() {
  return PLUGIN_ROOT;
}

function parseSimpleYaml(content) {
  const lines = String(content).split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  function peekNextList(fromIdx, indent) {
    for (let i = fromIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const li = l.match(/^(\s*)/)[1].length;
      if (li <= indent) return false;
      return /^\s*-\s+/.test(l);
    }
    return false;
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)[1].length;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem) {
      const raw = listItem[1].trim();
      const kvItem = raw.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
      if (kvItem && typeof parent === 'object' && !Array.isArray(parent)) {
        const arrKey = stack[stack.length - 1].key;
        if (!Array.isArray(parent)) {
          // list of objects under parent key handled via stack
        }
      }
      const val = raw.replace(/^["']|["']$/g, '');
      if (Array.isArray(parent)) parent.push(val);
      continue;
    }

    const kv = line.match(/^(\s*)([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[2];
    const value = kv[3].trim();

    if (value === '') {
      const isList = peekNextList(lineIdx, indent);
      const child = isList ? [] : {};
      parent[key] = child;
      stack.push({ indent, obj: child, key });
      continue;
    }

    let parsed = value.replace(/^["']|["']$/g, '');
    if (parsed === 'true') parsed = true;
    else if (parsed === 'false') parsed = false;
    else if (/^\d+$/.test(parsed)) parsed = Number(parsed);
    parent[key] = parsed;
  }
  return root;
}

export function loadProjectManifest(projectDir = getProjectDir()) {
  const yamlPath = path.join(projectDir, MANIFEST_PATH);
  const jsonPath = path.join(projectDir, MANIFEST_JSON_PATH);

  if (fs.existsSync(yamlPath)) {
    return { source: MANIFEST_PATH, data: normalizeProjectManifest(parseSimpleYaml(fs.readFileSync(yamlPath, 'utf8'))) };
  }
  if (fs.existsSync(jsonPath)) {
    return { source: MANIFEST_JSON_PATH, data: normalizeProjectManifest(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))) };
  }
  return { source: null, data: null };
}

export function isProjectInitialized(projectDir = getProjectDir()) {
  const manifest = loadProjectManifest(projectDir);
  if (manifest.data) return true;
  const agentsMd = path.join(projectDir, 'AGENTS.md');
  const projectRegistry = path.join(projectDir, '.cursor/agents/registry.yaml');
  return fs.existsSync(agentsMd) || fs.existsSync(projectRegistry);
}

export function discoverProject(projectDir = getProjectDir()) {
  const manifest = loadProjectManifest(projectDir);
  const signals = {
    manifest: !!manifest.data,
    agents_md: fs.existsSync(path.join(projectDir, 'AGENTS.md')),
    cursor_rules: fs.existsSync(path.join(projectDir, '.cursor/rules')),
    project_registry: fs.existsSync(path.join(projectDir, '.cursor/agents/registry.yaml')),
    stack_doc: fs.existsSync(path.join(projectDir, 'docs/STACK.md')),
    task_store: fs.existsSync(path.join(projectDir, 'docs/project/tasks')),
  };

  const mode = manifest.data || signals.agents_md || signals.project_registry
    ? 'INITIALIZED'
    : 'UNINITIALIZED';

  return {
    mode,
    manifest: manifest.data,
    manifest_source: manifest.source,
    signals,
    project_dir: projectDir,
  };
}

function deepMergeAgents(globalAgents, projectAgents = {}) {
  const merged = { ...globalAgents };
  for (const [id, cfg] of Object.entries(projectAgents)) {
    merged[id] = { ...(merged[id] || {}), ...cfg };
  }
  return merged;
}

function unionUnique(base = [], extra = []) {
  const a = Array.isArray(base) ? base : [];
  const b = Array.isArray(extra) ? extra : [];
  return [...new Set([...a, ...b])];
}

function asStringList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return [];
}

function loadProjectPolicyJson(projectDir) {
  const rulesPath = path.join(projectDir, '.cursor/policy/rules.json');
  if (!fs.existsSync(rulesPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch {
    return null;
  }
}

function manifestShellRulesUsable(shellRules = []) {
  return shellRules.some((rule) => rule && typeof rule === 'object' && Array.isArray(rule.patterns) && rule.patterns.length > 0);
}

function tier3OperationIds(manifest) {
  const raw = manifest?.policy?.tier3_operations || manifest?.policy?.tier_3_operations || [];
  const ops = Array.isArray(raw) ? raw : [];
  return ops
    .map((op) => {
      if (typeof op === 'string') {
        const match = op.match(/^id:\s*(\S+)/);
        return match ? match[1] : op;
      }
      return op?.id || op?.operation || null;
    })
    .filter(Boolean);
}

function supplementProjectShellRules(global, manifest, projectDir) {
  const manifestShell = manifest?.policy?.shell_rules || [];
  if (manifestShellRulesUsable(manifestShell)) return manifestShell;

  const projectPolicy = loadProjectPolicyJson(projectDir);
  if (!projectPolicy?.shell_rules?.length) return [];

  const projectTier3 = new Set(tier3OperationIds(manifest));
  const globalOps = new Set((global.shell_rules || []).map((r) => r.operation));

  return projectPolicy.shell_rules.filter(
    (rule) => rule?.patterns?.length && projectTier3.has(rule.operation) && !globalOps.has(rule.operation)
  );
}

function supplementProjectMcpRules(global, manifest, projectDir) {
  const manifestMcp = manifest?.policy?.mcp_rules || [];
  if (manifestMcp.some((rule) => rule && typeof rule === 'object' && rule.operation)) return manifestMcp;

  const projectPolicy = loadProjectPolicyJson(projectDir);
  if (!projectPolicy?.mcp_rules?.length) return [];

  const projectTier3 = new Set(tier3OperationIds(manifest));
  const globalOps = new Set((global.mcp_rules || []).map((r) => r.operation));

  return projectPolicy.mcp_rules.filter(
    (rule) => rule?.operation && projectTier3.has(rule.operation) && !globalOps.has(rule.operation)
  );
}

/**
 * Merge global rules with project adapter.
 * Project may add tier_3 ops, protected paths, shell/mcp rules, agents.
 * Project CANNOT remove global protected paths or global tier_3 baseline ops.
 */
export function loadEffectiveRules(projectDir = getProjectDir()) {
  const global = loadGlobalRules();
  const { data: manifest } = loadProjectManifest(projectDir);

  if (!manifest) {
    return { ...global, _source: 'global_only', _project_initialized: false };
  }

  const policy = manifest.policy || {};
  const projectTier3Ids = tier3OperationIds(manifest);
  const projectAgents = manifest.agents || manifest.specialists || {};
  const projectShellRules = supplementProjectShellRules(global, manifest, projectDir);
  const projectMcpRules = supplementProjectMcpRules(global, manifest, projectDir);

  const effective = {
    ...global,
    schema_version: global.schema_version,
    fail_closed_default: true,
    tier_3_operations: unionUnique(global.tier_3_operations, projectTier3Ids),
    protected_path_prefixes: unionUnique(global.protected_path_prefixes, asStringList(policy.protected_paths || policy.protected_path_prefixes)),
    protected_path_exact: unionUnique(global.protected_path_exact, asStringList(policy.protected_path_exact)),
    shell_rules: [...(global.shell_rules || []), ...projectShellRules],
    mcp_rules: [...(global.mcp_rules || []), ...projectMcpRules],
    agents: deepMergeAgents(global.agents, projectAgents),
    tool_profiles: { ...global.tool_profiles, ...(policy.tool_profiles || {}) },
    project: {
      id: manifest.project?.id,
      name: manifest.project?.name,
      task_id_prefix: manifest.project?.task_id_prefix || manifest.tasks?.id_prefix || 'TASK',
      task_id_pattern: manifest.project?.task_id_pattern || manifest.tasks?.id_pattern,
      paths: manifest.paths || {},
      knowledge: manifest.knowledge || {},
    },
    ephemeral_factory: {
      ...global.ephemeral_factory,
      ...(manifest.ephemeral || {}),
      specs_dir: manifest.knowledge?.ephemeral || global.ephemeral_factory.specs_dir,
    },
    _source: 'global_plus_project',
    _project_initialized: true,
    _manifest_version: manifest.schema_version,
    _agent_os_compat: getForgeOsBlock(manifest)?.version || manifest.agent_os_version,
    _forgeos_compat: getForgeOsBlock(manifest),
  };

  return effective;
}

export function getTasksBasePath(rules) {
  const fromManifest = rules.project?.paths?.tasks || rules.project?.knowledge?.tasks;
  return fromManifest || 'docs/project/tasks';
}

export function getTaskIdPattern(rules) {
  const prefix = rules.project?.task_id_prefix || 'TASK';
  const custom = rules.project?.task_id_pattern;
  if (custom) return new RegExp(custom);
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}-\\d{3}$`);
}

export function checkAgentOsCompatibility(projectDir = getProjectDir()) {
  const global = loadGlobalRules();
  const { data: manifest } = loadProjectManifest(projectDir);
  const forgeBlock = getForgeOsBlock(manifest);
  if (!forgeBlock?.version && !manifest?.agent_os_version) {
    return { compatible: true, reason: 'no_version_constraint', legacy_identifiers: ['agent_os'] };
  }
  const required = forgeBlock?.version || manifest.agent_os_version;
  const osVersion = global.agent_os_version || '1.0.0';
  if (typeof required === 'string' && required.startsWith('>=')) {
    const min = required.replace('>=', '').trim().split(' ')[0];
    const [maj] = min.split('.').map(Number);
    const [curMaj] = osVersion.split('.').map(Number);
    if (curMaj < maj) {
      return { compatible: false, reason: 'major_version_too_old', required, current: osVersion };
    }
    const maxMatch = required.match(/<\s*([\d.]+)/);
    if (maxMatch) {
      const maxMajor = maxMatch[1].split('.').map(Number)[0];
      if (curMaj >= maxMajor) {
        return { compatible: false, reason: 'major_version_too_new', required, current: osVersion };
      }
    }
  }

  const adapterSchema = forgeBlock?.adapter_schema_version ?? manifest.agent_os?.adapter_schema_version ?? manifest.schema_version;
  const migrationRequired = adapterSchema != null && adapterSchema < 1;
  const autoMigrate = forgeBlock?.compatibility?.auto_migrate === true;

  return {
    compatible: true,
    reason: 'version_ok',
    required,
    current: osVersion,
    adapter_schema_version: adapterSchema,
    migration_required: migrationRequired,
    migration_mode: migrationRequired ? (autoMigrate ? 'AUTO_SAFE' : 'REVIEW_REQUIRED') : null,
  };
}
