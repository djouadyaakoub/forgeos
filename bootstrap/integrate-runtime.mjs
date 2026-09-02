#!/usr/bin/env node
/**
 * Phase 11/12 — Integrate Universal Agent OS runtime into a project (portable hooks)
 *
 * Usage:
 *   node bootstrap/integrate-runtime.mjs --project-dir <path> [--plugin-root <path>]
 *   node bootstrap/integrate-runtime.mjs --rollback --project-dir <path>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginRoot, PLUGIN_ID } from '../policy/plugin-root.mjs';
import { MANIFEST_PATH } from '../policy/project-adapter.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIM_TEMPLATE = path.join(PLUGIN_ROOT, 'templates/runtime/hook-shim.mjs');
const HOOK_FILES = [
  'policy-subagent-start.mjs',
  'policy-pre-tool.mjs',
  'policy-shell.mjs',
  'policy-mcp.mjs',
  'policy-post-tool.mjs',
];

const args = process.argv.slice(2);
const rollback = args.includes('--rollback');
const projectDirIdx = args.indexOf('--project-dir');
const pluginRootIdx = args.indexOf('--plugin-root');
const projectDir = projectDirIdx >= 0 ? path.resolve(args[projectDirIdx + 1]) : process.cwd();

const HOOKS_JSON = path.join(projectDir, '.cursor/hooks.json');
const HOOKS_BACKUP = path.join(projectDir, '.cursor/hooks.json.local-backup');
const SHIM_DIR = path.join(projectDir, '.cursor/hooks/agent-os');
const RUNTIME_YAML = path.join(projectDir, '.agent-os/runtime.yaml');
const RETIRED_MARKER = path.join(projectDir, '.cursor/policy/local-runtime.RETIRED');

function resolveIntegrationPluginRoot() {
  if (pluginRootIdx >= 0) {
    return path.resolve(args[pluginRootIdx + 1]);
  }
  const resolved = resolvePluginRoot();
  if (!resolved.root) {
    throw new Error(resolved.error || 'Plugin root not found — run bootstrap/install-plugin.mjs');
  }
  return resolved.root;
}

function installPortableShims() {
  const shimSource = fs.readFileSync(SHIM_TEMPLATE, 'utf8');
  fs.mkdirSync(SHIM_DIR, { recursive: true });
  for (const name of HOOK_FILES) {
    fs.writeFileSync(path.join(SHIM_DIR, name), shimSource, 'utf8');
  }
}

function buildPortableHooksJson() {
  const hook = (name) => `node .cursor/hooks/agent-os/${name}`;
  return {
    version: 1,
    hooks: {
      subagentStart: [{ command: hook('policy-subagent-start.mjs') }],
      preToolUse: [
        {
          command: hook('policy-pre-tool.mjs'),
          matcher: 'Shell|Write|StrReplace|Delete|ApplyPatch',
          failClosed: true,
        },
      ],
      beforeShellExecution: [{ command: hook('policy-shell.mjs'), failClosed: true }],
      beforeMCPExecution: [{ command: hook('policy-mcp.mjs'), failClosed: true }],
      postToolUse: [
        {
          command: hook('policy-post-tool.mjs'),
          matcher: 'Write|StrReplace|Shell',
          failClosed: false,
        },
      ],
    },
    _agent_os: {
      runtime: 'UNIVERSAL_RUNTIME',
      policy_authority: 'universal-agent-os',
      plugin_id: PLUGIN_ID,
      hook_strategy: 'portable_shim',
      integrated_by: 'bootstrap/integrate-runtime.mjs',
    },
  };
}

function writeRuntimeYaml(previousMode) {
  const now = new Date().toISOString();
  const content = `schema_version: 1

runtime:
  mode: UNIVERSAL_RUNTIME
  policy_authority: universal
  plugin_id: ${PLUGIN_ID}
  hook_strategy: portable_shim
  integrated_at: ${now}

rollback:
  hooks_backup: .cursor/hooks.json.local-backup
  previous_mode: ${previousMode}
`;
  fs.mkdirSync(path.dirname(RUNTIME_YAML), { recursive: true });
  fs.writeFileSync(RUNTIME_YAML, content, 'utf8');
}

function writeRetiredMarker() {
  const content = `# Local Runtime Retired (Phase 11/12)

Speed Flexy local policy hooks are **not** the active policy authority.

**Active authority:** Universal Cursor Agent OS (\`plugin_id: ${PLUGIN_ID}\`)
**Hook strategy:** portable shim (\`.cursor/hooks/agent-os/*\`)

## Rollback

\`\`\`powershell
node bootstrap/integrate-runtime.mjs --rollback --project-dir "<project>"
\`\`\`

Run from Universal Agent OS checkout or user install manifest.
`;
  fs.mkdirSync(path.dirname(RETIRED_MARKER), { recursive: true });
  fs.writeFileSync(RETIRED_MARKER, content, 'utf8');
}

function hooksContainAbsoluteDevPath() {
  if (!fs.existsSync(HOOKS_JSON)) return false;
  const raw = fs.readFileSync(HOOKS_JSON, 'utf8');
  return /[A-Za-z]:[\\/][^"'\s]*(?:cursor-agent-os|ForgeOS)/i.test(raw);
}

function integrate() {
  const manifestPath = path.join(projectDir, MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${MANIFEST_PATH} — run bootstrap --apply-adapter first`);
  }

  const pluginRoot = resolveIntegrationPluginRoot();
  const previousMode = fs.existsSync(RUNTIME_YAML) ? 'MIGRATION' : 'LOCAL_RUNTIME';

  fs.mkdirSync(path.dirname(HOOKS_JSON), { recursive: true });
  if (fs.existsSync(HOOKS_JSON) && !fs.existsSync(HOOKS_BACKUP)) {
    fs.copyFileSync(HOOKS_JSON, HOOKS_BACKUP);
  }

  installPortableShims();
  fs.writeFileSync(HOOKS_JSON, JSON.stringify(buildPortableHooksJson(), null, 2), 'utf8');
  writeRuntimeYaml(previousMode);
  writeRetiredMarker();

  return {
    action: 'integrate',
    project_dir: projectDir,
    runtime_mode: 'UNIVERSAL_RUNTIME',
    hook_strategy: 'portable_shim',
    hooks_json: HOOKS_JSON.replace(/\\/g, '/'),
    shim_dir: SHIM_DIR.replace(/\\/g, '/'),
    hooks_backup: HOOKS_BACKUP.replace(/\\/g, '/'),
    runtime_yaml: RUNTIME_YAML.replace(/\\/g, '/'),
    plugin_root_resolved: pluginRoot.replace(/\\/g, '/'),
    absolute_dev_path_in_hooks: hooksContainAbsoluteDevPath(),
  };
}

function rollbackIntegration() {
  if (!fs.existsSync(HOOKS_BACKUP)) {
    throw new Error(`No rollback backup at ${HOOKS_BACKUP}`);
  }
  fs.copyFileSync(HOOKS_BACKUP, HOOKS_JSON);
  if (fs.existsSync(RUNTIME_YAML)) {
    fs.renameSync(RUNTIME_YAML, `${RUNTIME_YAML}.rollback-${Date.now()}`);
  }
  if (fs.existsSync(RETIRED_MARKER)) {
    fs.unlinkSync(RETIRED_MARKER);
  }
  return {
    action: 'rollback',
    project_dir: projectDir,
    runtime_mode: 'LOCAL_RUNTIME',
    restored_hooks: HOOKS_JSON.replace(/\\/g, '/'),
  };
}

try {
  const report = rollback ? rollbackIntegration() : integrate();
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
}
