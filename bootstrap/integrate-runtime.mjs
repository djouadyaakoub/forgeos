#!/usr/bin/env node
/**
 * Integrate ForgeOS portable policy hooks into a project.
 *
 * Usage:
 *   node bootstrap/integrate-runtime.mjs --project-dir <path> [--plugin-root <path>]
 *   node bootstrap/integrate-runtime.mjs --rollback --project-dir <path>
 *
 * Host path after integrate:
 *   Cursor hooks.json → .cursor/hooks/agent-os/* shim → policy/hooks/* → Policy Authority
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolvePluginRoot, PLUGIN_ID } from '../policy/plugin-root.mjs';
import { MANIFEST_PATH } from '../policy/project-adapter.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import {
  installPortablePolicyHooks,
  hooksContainAbsoluteDevPath,
  portableHooksJsonPath,
} from '../policy/portable-hooks.mjs';

const args = process.argv.slice(2);
const rollback = args.includes('--rollback');
const projectDirIdx = args.indexOf('--project-dir');
const pluginRootIdx = args.indexOf('--plugin-root');
const projectDir = projectDirIdx >= 0 ? path.resolve(args[projectDirIdx + 1]) : process.cwd();

const HOOKS_JSON = portableHooksJsonPath(projectDir);
const HOOKS_BACKUP = path.join(projectDir, '.cursor/hooks.json.local-backup');
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

function writeRetiredMarker() {
  const content = `# Local Runtime Retired

Project-local policy hooks are **not** the active ForgeOS policy authority.

**Active authority:** ForgeOS (\`POLICY_AUTHORITY = ${POLICY_AUTHORITY}\`)
**Hook strategy:** portable shim (\`.cursor/hooks/agent-os/*\`)
**Plugin id (Cursor):** ${PLUGIN_ID}

## Rollback

\`\`\`powershell
node bootstrap/integrate-runtime.mjs --rollback --project-dir "<project>"
\`\`\`
`;
  fs.mkdirSync(path.dirname(RETIRED_MARKER), { recursive: true });
  fs.writeFileSync(RETIRED_MARKER, content, 'utf8');
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

  const installed = installPortablePolicyHooks(projectDir, {
    previousMode,
    integrated_by: 'bootstrap/integrate-runtime.mjs',
  });
  writeRetiredMarker();

  return {
    action: 'integrate',
    project_dir: projectDir,
    runtime_mode: 'UNIVERSAL_RUNTIME',
    hook_strategy: 'portable_shim',
    policy_authority: POLICY_AUTHORITY,
    hooks_json: installed.hooks_json,
    shim_dir: installed.shim_dir,
    hooks_backup: HOOKS_BACKUP.replace(/\\/g, '/'),
    runtime_yaml: installed.runtime_yaml,
    plugin_root_resolved: pluginRoot.replace(/\\/g, '/'),
    absolute_dev_path_in_hooks: hooksContainAbsoluteDevPath(
      fs.existsSync(HOOKS_JSON) ? fs.readFileSync(HOOKS_JSON, 'utf8') : ''
    ),
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
