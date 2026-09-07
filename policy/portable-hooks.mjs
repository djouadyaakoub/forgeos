/**
 * Portable host-hook installation — single ForgeOS policy authority wiring.
 *
 * Production host path:
 *   Host event → project portable shim → policy/hooks/* → Policy Authority
 *
 * Absolute-path hook wiring is deprecated. Do not invent a second rule engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_AUTHORITY, CURSOR_PLUGIN_ID, PRODUCT_ID } from './identity.mjs';

const POLICY_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORGEOS_ROOT = path.dirname(POLICY_DIR);
const SHIM_TEMPLATE = path.join(FORGEOS_ROOT, 'templates/runtime/hook-shim.mjs');

export const PORTABLE_HOOK_FILES = [
  'policy-subagent-start.mjs',
  'policy-pre-tool.mjs',
  'policy-shell.mjs',
  'policy-mcp.mjs',
  'policy-post-tool.mjs',
];

export function portableShimDir(projectDir) {
  return path.join(projectDir, '.cursor/hooks/agent-os');
}

export function portableHooksJsonPath(projectDir) {
  return path.join(projectDir, '.cursor/hooks.json');
}

export function buildPortableHooksJson(options = {}) {
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
    _forgeos: {
      runtime: 'UNIVERSAL_RUNTIME',
      policy_authority: POLICY_AUTHORITY,
      product_id: PRODUCT_ID,
      plugin_id: CURSOR_PLUGIN_ID,
      hook_strategy: 'portable_shim',
      integrated_by: options.integrated_by || 'policy/portable-hooks.mjs',
    },
    // Legacy key retained for older detectors; value is forgeos authority id.
    _agent_os: {
      runtime: 'UNIVERSAL_RUNTIME',
      policy_authority: POLICY_AUTHORITY,
      plugin_id: CURSOR_PLUGIN_ID,
      hook_strategy: 'portable_shim',
      integrated_by: options.integrated_by || 'policy/portable-hooks.mjs',
    },
  };
}

export function installPortableShims(projectDir, options = {}) {
  const templatePath = options.shimTemplate || SHIM_TEMPLATE;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing portable hook shim template: ${templatePath}`);
  }
  const shimSource = fs.readFileSync(templatePath, 'utf8');
  const shimDir = portableShimDir(projectDir);
  fs.mkdirSync(shimDir, { recursive: true });
  for (const name of PORTABLE_HOOK_FILES) {
    fs.writeFileSync(path.join(shimDir, name), shimSource, 'utf8');
  }
  return shimDir;
}

export function writePortableHooksJson(projectDir, options = {}) {
  const hooksPath = portableHooksJsonPath(projectDir);
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  const json = buildPortableHooksJson(options);
  fs.writeFileSync(hooksPath, JSON.stringify(json, null, 2), 'utf8');
  return hooksPath;
}

export function writeRuntimeYaml(projectDir, previousMode = 'LOCAL_RUNTIME') {
  const runtimePath = path.join(projectDir, '.agent-os/runtime.yaml');
  const now = new Date().toISOString();
  const content = `schema_version: 1

runtime:
  mode: UNIVERSAL_RUNTIME
  policy_authority: ${POLICY_AUTHORITY}
  plugin_id: ${CURSOR_PLUGIN_ID}
  product_id: ${PRODUCT_ID}
  hook_strategy: portable_shim
  integrated_at: ${now}

rollback:
  hooks_backup: .cursor/hooks.json.local-backup
  previous_mode: ${previousMode}
`;
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, content, 'utf8');
  return runtimePath;
}

/**
 * Install portable ForgeOS policy hooks for a project (idempotent overwrite of shim + hooks.json).
 */
export function installPortablePolicyHooks(projectDir, options = {}) {
  const previousMode = options.previousMode
    || (fs.existsSync(path.join(projectDir, '.agent-os/runtime.yaml')) ? 'MIGRATION' : 'LOCAL_RUNTIME');

  const shimDir = installPortableShims(projectDir, options);
  const hooksPath = writePortableHooksJson(projectDir, {
    integrated_by: options.integrated_by || 'policy/portable-hooks.mjs',
  });
  const runtimePath = writeRuntimeYaml(projectDir, previousMode);

  return {
    project_dir: projectDir.replace(/\\/g, '/'),
    hook_strategy: 'portable_shim',
    policy_authority: POLICY_AUTHORITY,
    hooks_json: hooksPath.replace(/\\/g, '/'),
    shim_dir: shimDir.replace(/\\/g, '/'),
    runtime_yaml: runtimePath.replace(/\\/g, '/'),
  };
}

export function hooksContainAbsoluteDevPath(hooksJsonRaw) {
  return /[A-Za-z]:[\\/][^"'\s]*(?:cursor-agent-os|ForgeOS)/i.test(String(hooksJsonRaw || ''));
}

export function classifyHookAuthority(hooksJson) {
  const cmd = hooksJson?.hooks?.preToolUse?.[0]?.command || '';
  const usesPortableShim = cmd.includes('.cursor/hooks/agent-os/');
  const usesAbsoluteDevPath = hooksContainAbsoluteDevPath(cmd);
  const usesLegacyLocalHook =
    cmd.includes('.cursor/hooks/policy-pre-tool') && !cmd.includes('agent-os');
  const usesRelativePluginHook =
    /(?:^|\s)node\s+policy\/hooks\//.test(cmd) || cmd.includes('policy/hooks/policy-pre-tool');

  let classification = 'MISSING_HOST_HOOK';
  if (!cmd) classification = 'MISSING_HOST_HOOK';
  else if (usesPortableShim && !usesAbsoluteDevPath) classification = 'PORTABLE_FORGEOS_AUTHORITY';
  else if (usesAbsoluteDevPath) classification = 'NON_PORTABLE_SAME_ENGINE';
  else if (usesLegacyLocalHook) classification = 'LEGACY_LOCAL_HOOK';
  else if (usesRelativePluginHook) classification = 'DEV_RELATIVE_PLUGIN_HOOK';
  else classification = 'UNKNOWN_WIRING';

  return {
    preToolUse: cmd,
    uses_portable_shim: usesPortableShim,
    uses_absolute_dev_path: usesAbsoluteDevPath,
    uses_legacy_local_hook: usesLegacyLocalHook,
    uses_relative_plugin_hook: usesRelativePluginHook,
    classification,
  };
}
