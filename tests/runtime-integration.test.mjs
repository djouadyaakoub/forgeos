#!/usr/bin/env node
/**
 * Phase 11 — Runtime integration tests + single policy authority proof
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveProjectDirFromCandidates,
  collectProjectCandidates,
  resetRuntimeCache,
  loadRuntimeConfig,
  POLICY_AUTHORITY,
  getPluginRoot,
} from '../policy/runtime.mjs';
import {
  loadEffectiveRules,
  loadProjectManifest,
  discoverProject,
} from '../policy/project-adapter.mjs';
import {
  dryRunScenario,
  clearSession,
  saveSession,
  evaluateShell,
  getPolicyAuthority,
  loadRules,
} from '../policy/engine.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');
const FIXTURE_B = path.join(REPO, 'tests/fixtures/project-b');
const SPEED_FLEXY = 'C:/Apps/speed-flexy-server';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    resetRuntimeCache();
    delete process.env.CURSOR_PROJECT_DIR;
    delete process.env.AGENT_OS_TEST_DIR;
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('Runtime Integration Tests\n');

console.log('--- Project resolution ---');
test('Walk-up finds .agent-os from nested cwd', () => {
  const nested = path.join(FIXTURE_A, 'db/nested');
  const resolved = resolveProjectDirFromCandidates([nested]);
  assert(resolved && path.basename(resolved) === 'project-a', `got ${resolved}`);
});

test('workspace_folder candidate resolves project', () => {
  const resolved = resolveProjectDirFromCandidates(
    collectProjectCandidates({ workspace_folder: path.join(FIXTURE_A, 'src') })
  );
  assert(resolved === FIXTURE_A, `expected ${FIXTURE_A} got ${resolved}`);
});

console.log('\n--- Cross-project isolation ---');
test('Project A and B adapters do not leak', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  const rulesA = loadEffectiveRules(FIXTURE_A);
  process.env.CURSOR_PROJECT_DIR = FIXTURE_B;
  const rulesB = loadEffectiveRules(FIXTURE_B);
  assert(rulesA.agents['postgres-specialist'], 'A missing postgres');
  assert(rulesB.agents['sqlite-specialist'], 'B missing sqlite');
  assert(!rulesA.agents['sqlite-specialist'], 'cross-project leak A←B');
  assert(!rulesB.agents['postgres-specialist'], 'cross-project leak B←A');
});

console.log('\n--- Policy authority ---');
test('Universal engine reports single authority', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  assert(getPolicyAuthority() === POLICY_AUTHORITY, 'authority mismatch');
  assert(loadRules()._source === 'global_plus_project', 'expected merged rules');
});

test('Speed Flexy loads project adapter not global-only', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml'))) {
    console.log('  SKIP  Speed Flexy adapter (not present)');
    return;
  }
  process.env.CURSOR_PROJECT_DIR = SPEED_FLEXY;
  const rules = loadEffectiveRules(SPEED_FLEXY);
  assert(rules._source === 'global_plus_project', `got ${rules._source}`);
  assert(rules.agents['backend-api'], 'missing backend-api from adapter');
  assert((rules.shell_rules || []).some((r) => r.operation === 'fly_deploy'), 'missing fly_deploy shell rule');
});

console.log('\n--- Live hook invocation (Universal runtime) ---');
test('Hook blocks protected path via Universal engine', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-pre-tool.mjs'))) {
    console.log('  SKIP  Speed Flexy portable shim not installed');
    return;
  }
  const hook = path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-pre-tool.mjs');
  const input = JSON.stringify({
    tool_name: 'Write',
    tool_input: { path: '.cursor/hooks.json' },
    workspace_folder: SPEED_FLEXY,
  });
  const r = spawnSync('node', [hook], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_PROJECT_DIR: SPEED_FLEXY },
    cwd: SPEED_FLEXY,
  });
  assert(r.status === 2, `expected exit 2 got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert(out.permission === 'deny', 'expected deny from universal hook');
});

test('Hook blocks fly_deploy without approval', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-shell.mjs'))) {
    console.log('  SKIP  Speed Flexy portable shim not installed');
    return;
  }
  const hook = path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-shell.mjs');
  const input = JSON.stringify({
    command: 'fly deploy',
    workspace_folder: SPEED_FLEXY,
  });
  const r = spawnSync('node', [hook], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_PROJECT_DIR: SPEED_FLEXY },
    cwd: SPEED_FLEXY,
  });
  assert(r.status === 2, `expected exit 2 got ${r.status}`);
  assert(JSON.parse(r.stdout).permission === 'deny', 'expected deny');
});

test('Single authority — hooks.json uses portable shims not local engine', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.cursor/hooks.json'))) {
    console.log('  SKIP  Speed Flexy hooks.json missing');
    return;
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(SPEED_FLEXY, '.cursor/hooks.json'), 'utf8'));
  const preTool = hooks.hooks?.preToolUse?.[0]?.command || '';
  assert(preTool.includes('.cursor/hooks/agent-os/'), 'must use portable shim');
  assert(!preTool.includes('C:/Apps/cursor-agent-os'), 'must not use absolute dev path (legacy folder)');
  assert(!preTool.includes('C:/Apps/ForgeOS'), 'must not use absolute dev path (ForgeOS folder)');
  assert(!preTool.includes('.cursor/hooks/policy-pre-tool'), 'must not use local hook');
  const shell = hooks.hooks?.beforeShellExecution?.[0]?.command || '';
  assert(shell.includes('.cursor/hooks/agent-os/'), 'shell shim required');
});

console.log('\n--- Tier 3 task-bound approval ---');
test('Approved task allows wrangler_deploy; wrong task denied', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml'))) {
    console.log('  SKIP  Speed Flexy not present');
    return;
  }
  process.env.CURSOR_PROJECT_DIR = SPEED_FLEXY;
  clearSession();
  saveSession({ subagent_type: 'devops-release', task_id: 'SF-20260901-013' });
  const allow = evaluateShell('wrangler pages deploy');
  assert(allow.permission === 'allow', `expected allow got ${allow.permission}`);
  clearSession();
  saveSession({ subagent_type: 'devops-release', task_id: 'SF-WRONG-TASK' });
  const deny = evaluateShell('wrangler pages deploy');
  assert(deny.permission === 'deny', 'cross-task must deny');
});

console.log('\n--- MCP metadata ---');
test('Adapter MCP section has no raw secrets', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml'))) {
    console.log('  SKIP  Speed Flexy not present');
    return;
  }
  const yaml = fs.readFileSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml'), 'utf8');
  assert(!/\bBearer\s+[A-Za-z0-9._-]{8,}\b/.test(yaml), 'bearer token in adapter');
  assert(!/api[_-]?key:\s*\S{12,}/i.test(yaml), 'api key in adapter');
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
