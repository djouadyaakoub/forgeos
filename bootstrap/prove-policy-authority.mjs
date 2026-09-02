#!/usr/bin/env node
/**
 * Prove single policy authority — portable shims delegate to Universal OS only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { POLICY_AUTHORITY } from '../policy/runtime.mjs';
import { getPolicyAuthority, loadRules } from '../policy/engine.mjs';

const args = process.argv.slice(2);
const idx = args.indexOf('--project-dir');

function resolveProjectDir() {
  if (idx >= 0 && args[idx + 1]) return path.resolve(args[idx + 1]);
  if (process.env.CURSOR_PROJECT_DIR) return path.resolve(process.env.CURSOR_PROJECT_DIR);
  if (process.env.FORGEOS_TEST_DIR) return path.resolve(process.env.FORGEOS_TEST_DIR);
  if (process.env.AGENT_OS_TEST_DIR) return path.resolve(process.env.AGENT_OS_TEST_DIR);
  console.error(JSON.stringify({
    action: 'prove-policy-authority',
    status: 'MISSING_PROJECT_DIR',
    message: 'Pass --project-dir <path> or set CURSOR_PROJECT_DIR / FORGEOS_TEST_DIR',
  }));
  process.exit(2);
}

const projectDir = resolveProjectDir();

process.env.CURSOR_PROJECT_DIR = projectDir;

const hooksPath = path.join(projectDir, '.cursor/hooks.json');
const portableShim = path.join(projectDir, '.cursor/hooks/agent-os/policy-pre-tool.mjs');
const localHook = path.join(projectDir, '.cursor/hooks/policy-pre-tool.mjs');

const report = {
  project_dir: projectDir,
  policy_authority: getPolicyAuthority(),
  rules_source: loadRules()._source,
  hooks_json_exists: fs.existsSync(hooksPath),
  portable_shim_exists: fs.existsSync(portableShim),
  hook_chain: null,
  hook_decision: null,
  single_authority: false,
};

if (fs.existsSync(hooksPath)) {
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const cmd = hooks.hooks?.preToolUse?.[0]?.command || '';
  report.hook_chain = {
    preToolUse: cmd,
    uses_portable_shim: cmd.includes('.cursor/hooks/agent-os/'),
    uses_absolute_dev_path: /[A-Za-z]:[\\/].*(?:cursor-agent-os|ForgeOS)/i.test(cmd),
    uses_legacy_local_hook: cmd.includes('.cursor/hooks/policy-pre-tool') && !cmd.includes('agent-os'),
    legacy_local_hook_file_exists: fs.existsSync(localHook),
  };
}

const hookTarget = fs.existsSync(portableShim) ? portableShim : null;
if (hookTarget) {
  const hookInput = JSON.stringify({
    tool_name: 'Write',
    tool_input: { path: '.cursor/hooks.json' },
    workspace_folder: projectDir,
  });
  const hookResult = spawnSync('node', [hookTarget], {
    input: hookInput,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_PROJECT_DIR: projectDir },
    cwd: projectDir,
  });
  report.hook_decision = {
    exit_code: hookResult.status,
    stdout: JSON.parse(hookResult.stdout || '{}'),
    authority: POLICY_AUTHORITY,
  };
}

report.single_authority =
  report.hook_chain?.uses_portable_shim === true &&
  report.hook_chain?.uses_absolute_dev_path === false &&
  report.hook_chain?.uses_legacy_local_hook === false &&
  report.hook_decision?.stdout?.permission === 'deny' &&
  report.policy_authority === POLICY_AUTHORITY;

report.verdict = report.single_authority ? 'ONE_AUTHORITATIVE_DECISION' : 'DUAL_AUTHORITY_RISK';

console.log(JSON.stringify(report, null, 2));
process.exit(report.single_authority ? 0 : 1);
