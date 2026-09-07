#!/usr/bin/env node
/**
 * Prove single ForgeOS policy authority for a project host path.
 *
 * Distinguishes:
 *   A. True duplicate authorization logic
 *   B. Missing host hook
 *   C. Non-portable wiring (absolute path to same engine)
 *   D. Legacy local project hook
 *   E. Portable ForgeOS shim → Policy Authority (desired)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { getPolicyAuthority, loadRules } from '../policy/engine.mjs';
import { classifyHookAuthority } from '../policy/portable-hooks.mjs';

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
  expected_authority: POLICY_AUTHORITY,
  rules_source: loadRules()._source,
  hooks_json_exists: fs.existsSync(hooksPath),
  portable_shim_exists: fs.existsSync(portableShim),
  hook_chain: null,
  hook_decision: null,
  dual_authority_class: null,
  single_authority: false,
};

if (fs.existsSync(hooksPath)) {
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const classified = classifyHookAuthority(hooks);
  report.hook_chain = {
    ...classified,
    legacy_local_hook_file_exists: fs.existsSync(localHook),
    hooks_meta_authority:
      hooks._forgeos?.policy_authority || hooks._agent_os?.policy_authority || null,
  };
  if (classified.classification === 'PORTABLE_FORGEOS_AUTHORITY') {
    report.dual_authority_class = null;
  } else if (classified.classification === 'MISSING_HOST_HOOK') {
    report.dual_authority_class = 'B_MISSING_HOST_HOOK';
  } else if (classified.classification === 'NON_PORTABLE_SAME_ENGINE') {
    report.dual_authority_class = 'C_NON_PORTABLE_WIRING';
  } else if (classified.classification === 'LEGACY_LOCAL_HOOK') {
    report.dual_authority_class = 'A_OR_D_LEGACY_LOCAL_HOOK';
  } else {
    report.dual_authority_class = 'E_OTHER';
  }
} else {
  report.dual_authority_class = 'B_MISSING_HOST_HOOK';
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
  let stdout = {};
  try {
    stdout = JSON.parse(hookResult.stdout || '{}');
  } catch {
    stdout = { parse_error: true, raw: hookResult.stdout };
  }
  report.hook_decision = {
    exit_code: hookResult.status,
    stdout,
    authority: stdout.authority || POLICY_AUTHORITY,
  };
}

report.single_authority =
  report.hook_chain?.uses_portable_shim === true &&
  report.hook_chain?.uses_absolute_dev_path === false &&
  report.hook_chain?.uses_legacy_local_hook === false &&
  report.hook_decision?.stdout?.permission === 'deny' &&
  report.policy_authority === POLICY_AUTHORITY &&
  (report.hook_decision?.stdout?.authority == null ||
    report.hook_decision.stdout.authority === POLICY_AUTHORITY);

report.verdict = report.single_authority ? 'ONE_AUTHORITATIVE_DECISION' : 'DUAL_AUTHORITY_RISK';

console.log(JSON.stringify(report, null, 2));
process.exit(report.single_authority ? 0 : 1);
