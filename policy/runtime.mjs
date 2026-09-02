/**
 * ForgeOS — runtime bootstrap & project resolution
 * Resolves project directory, runtime mode, and policy authority for hooks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginRoot, hookCommand } from './plugin-root.mjs';

const MANIFEST_REL = '.agent-os/project.yaml';

export const RUNTIME_MODES = ['LOCAL_RUNTIME', 'UNIVERSAL_RUNTIME', 'MIGRATION'];
export const POLICY_AUTHORITY = 'forgeos';

let _resolvedProjectDir = null;
let _runtimeConfig = null;

function parseSimpleRuntimeYaml(content) {
  const data = {};
  const lines = String(content).split(/\r?\n/);
  let section = null;
  let subsection = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^(\s*)([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    const key = kv[2];
    const value = kv[3].trim().replace(/^["']|["']$/g, '');
    if (indent === 0) {
      section = key;
      data[section] = data[section] || {};
      subsection = null;
      continue;
    }
    if (indent === 2 && section) {
      if (value === '') {
        subsection = key;
        data[section][subsection] = data[section][subsection] || {};
      } else {
        data[section][key] = value;
      }
      continue;
    }
    if (indent === 4 && section && subsection) {
      data[section][subsection][key] = value;
    }
  }
  return data;
}

export function getPluginRootFromRuntime() {
  const resolved = resolvePluginRoot();
  if (!resolved.root) {
    throw new Error(resolved.error || 'Plugin root not found');
  }
  return resolved.root;
}

export function getPluginRoot() {
  return getPluginRootFromRuntime();
}

export function resolveProjectDirFromCandidates(candidates = []) {
  const seen = new Set();
  for (const start of candidates) {
    if (!start || typeof start !== 'string') continue;
    let dir = path.resolve(start);
    while (true) {
      const key = dir.toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);
      const manifest = path.join(dir, MANIFEST_REL);
      if (fs.existsSync(manifest)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function collectProjectCandidates(hookInput = null) {
  const candidates = [];
  const input = hookInput && typeof hookInput === 'object' ? hookInput : {};

  if (process.env.CURSOR_PROJECT_DIR) candidates.push(process.env.CURSOR_PROJECT_DIR);
  if (process.env.CURSOR_WORKSPACE) candidates.push(process.env.CURSOR_WORKSPACE);
  if (process.env.AGENT_OS_TEST_DIR) candidates.push(process.env.AGENT_OS_TEST_DIR);

  for (const key of ['workspace_folder', 'workspace_root', 'project_path', 'rootPath', 'cwd']) {
    if (input[key]) candidates.push(input[key]);
  }
  if (Array.isArray(input.workspace_roots)) {
    candidates.push(...input.workspace_roots);
  }

  candidates.push(process.cwd());

  if (input.tool_input?.path || input.tool_input?.file_path) {
    const p = input.tool_input.path || input.tool_input.file_path;
    if (path.isAbsolute(p)) candidates.push(path.dirname(p));
  }

  return [...new Set(candidates.filter(Boolean).map((c) => path.resolve(String(c))))];
}

export function resolveProjectDir(hookInput = null) {
  if (_resolvedProjectDir) return _resolvedProjectDir;
  const fromEnv = process.env.CURSOR_PROJECT_DIR || process.env.AGENT_OS_TEST_DIR;
  if (fromEnv) {
    _resolvedProjectDir = path.resolve(fromEnv);
    return _resolvedProjectDir;
  }
  const resolved = resolveProjectDirFromCandidates(collectProjectCandidates(hookInput));
  _resolvedProjectDir = resolved || process.cwd();
  return _resolvedProjectDir;
}

export function loadRuntimeConfig(projectDir = resolveProjectDir()) {
  if (_runtimeConfig) return _runtimeConfig;
  const runtimePath = path.join(projectDir, '.agent-os/runtime.yaml');
  if (!fs.existsSync(runtimePath)) {
    _runtimeConfig = {
      mode: 'LOCAL_RUNTIME',
      policy_authority: 'local',
      plugin_root: null,
      source: 'default',
    };
    return _runtimeConfig;
  }
  const parsed = parseSimpleRuntimeYaml(fs.readFileSync(runtimePath, 'utf8'));
  const runtime = parsed.runtime || {};
  _runtimeConfig = {
    mode: runtime.mode || 'UNIVERSAL_RUNTIME',
    policy_authority: runtime.policy_authority || 'universal',
    plugin_id: runtime.plugin_id || 'cursor-agent-os',
    hook_strategy: runtime.hook_strategy || 'portable_shim',
    plugin_root: runtime.plugin_root || null,
    integrated_at: runtime.integrated_at || null,
    rollback: parsed.rollback || {},
    source: '.agent-os/runtime.yaml',
  };
  return _runtimeConfig;
}

export function initHookRuntime(hookInput = null) {
  const projectDir = resolveProjectDir(hookInput);
  process.env.CURSOR_PROJECT_DIR = projectDir;
  const config = loadRuntimeConfig(projectDir);

  if (config.plugin_root) {
    process.env.AGENT_OS_PLUGIN_ROOT = config.plugin_root;
    process.env.CURSOR_AGENT_OS_PLUGIN_ROOT = config.plugin_root;
  } else {
    try {
      const root = getPluginRootFromRuntime();
      process.env.AGENT_OS_PLUGIN_ROOT = root;
      process.env.CURSOR_AGENT_OS_PLUGIN_ROOT = root;
    } catch {
      appendRuntimeAudit(projectDir, {
        type: 'runtime_error',
        message: 'Plugin root resolution failed during hook init',
        mode: config.mode,
      });
    }
  }

  if (config.mode === 'LOCAL_RUNTIME') {
    appendRuntimeAudit(projectDir, {
      type: 'runtime_warning',
      message: 'LOCAL_RUNTIME mode — hooks should delegate to Universal OS. Fail-closed recommended.',
      mode: config.mode,
    });
  }

  return {
    project_dir: projectDir,
    runtime_mode: config.mode,
    policy_authority: config.mode === 'LOCAL_RUNTIME' ? 'local-legacy' : POLICY_AUTHORITY,
    plugin_root: getPluginRoot(),
  };
}

export function assertUniversalPolicyAuthority(projectDir = resolveProjectDir()) {
  const config = loadRuntimeConfig(projectDir);
  if (config.mode === 'UNIVERSAL_RUNTIME' || config.mode === 'MIGRATION') {
    return { ok: true, authority: POLICY_AUTHORITY, mode: config.mode };
  }
  return {
    ok: false,
    authority: config.policy_authority,
    mode: config.mode,
    reason: 'local_runtime_active',
  };
}

export function appendRuntimeAudit(projectDir, entry) {
  const auditPath = path.join(projectDir, '.cursor/policy/runtime-audit.log');
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, line + '\n');
  } catch {
    // audit failure must not block hooks
  }
}

export function resetRuntimeCache() {
  _resolvedProjectDir = null;
  _runtimeConfig = null;
}

export function hookPath(name) {
  return path.join(getPluginRootFromRuntime(), 'policy/hooks', name).replace(/\\/g, '/');
}

export { hookCommand };
