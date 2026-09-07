#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 2 — Policy Authority consolidation tests
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PolicyAuthority,
  evaluate,
  evaluatePreToolUse,
  evaluateShell,
  evaluateApprovalForOperation,
  dryRunScenario,
  clearSession,
  saveSession,
  POLICY_AUTHORITY,
} from '../policy/authority.mjs';
import {
  installPortablePolicyHooks,
  classifyHookAuthority,
  buildPortableHooksJson,
} from '../policy/portable-hooks.mjs';
import { loadEffectiveRules } from '../policy/project-adapter.mjs';
import { evaluateCursorHook } from '../adapters/cursor/integration.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_A = path.join(ROOT, 'tests/fixtures/project-a');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('Policy Authority Consolidation Tests\n');

test('A — safe read ALLOW with forgeos authority', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  const d = evaluatePreToolUse({ tool_name: 'Read', tool_input: { path: 'README.md' } });
  assert(d.permission === 'allow', `expected allow got ${d.permission}`);
  assert(d.authority === POLICY_AUTHORITY, `authority ${d.authority}`);
  assert(PolicyAuthority.id === 'forgeos');
});

test('B — git push DENY without approval', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  clearSession();
  saveSession({ subagent_type: 'orchestrator', task_id: 'PROJ-A-NO-APPROVAL' });
  const d = evaluateShell('git push origin main');
  assert(d.permission === 'deny', `expected deny got ${d.permission}`);
  assert(d.authority === POLICY_AUTHORITY);
});

test('C — cross-task approval isolation', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  const a = evaluateApprovalForOperation('git_push', 'TASK-AAAA');
  const b = evaluateApprovalForOperation('git_push', 'TASK-BBBB');
  assert(a.permission === 'deny' && b.permission === 'deny', 'both deny without approvals');
  assert(a.authority === POLICY_AUTHORITY && b.authority === POLICY_AUTHORITY);
});

test('D — protected path DENY', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  clearSession();
  const d = dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' });
  assert(d.permission === 'deny', 'protected path must deny');
  assert(d.reason === 'protected_path' || d.permission === 'deny');
  assert(d.authority === POLICY_AUTHORITY);
});

test('E — project cannot weaken global protected paths', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  const rules = loadEffectiveRules(FIXTURE_A);
  assert(rules._source === 'global_plus_project' || rules._source === 'global_only', rules._source);
  assert(
    (rules.protected_path_exact || []).includes('.cursor/hooks.json') ||
      (rules.protected_path_prefixes || []).some((p) => p.includes('.cursor')),
    'global protected paths must remain'
  );
});

test('F — PolicyAuthority.evaluate unknown kind fail-closed', () => {
  const d = evaluate({ kind: 'not-a-real-kind' });
  assert(d.permission === 'deny');
  assert(d.authority === POLICY_AUTHORITY);
});

test('G — portable hooks classify as single authority wiring', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-pa-'));
  fs.mkdirSync(path.join(tmp, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.agent-os/project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: tmp\n  name: tmp\n',
    'utf8'
  );
  installPortablePolicyHooks(tmp, { integrated_by: 'tests/policy-authority.test.mjs' });
  const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.cursor/hooks.json'), 'utf8'));
  const c = classifyHookAuthority(hooks);
  assert(c.classification === 'PORTABLE_FORGEOS_AUTHORITY', c.classification);
  assert(hooks._forgeos?.policy_authority === POLICY_AUTHORITY);
  assert(!JSON.stringify(hooks).includes('C:/Apps/ForgeOS'));
});

test('H — host translation does not change decision', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  clearSession();
  const viaAuthority = evaluatePreToolUse({
    tool_name: 'Write',
    tool_input: { path: '.cursor/hooks.json' },
  });
  const viaCursor = evaluateCursorHook({
    tool_name: 'Write',
    tool_input: { path: '.cursor/hooks.json' },
  });
  assert(viaAuthority.permission === viaCursor.permission);
  assert(viaCursor.authority === POLICY_AUTHORITY);
});

test('I — absolute path wiring classified (not portable)', () => {
  const fake = buildPortableHooksJson();
  fake.hooks.preToolUse[0].command =
    'node "C:/Apps/ForgeOS/policy/hooks/policy-pre-tool.mjs"';
  const c = classifyHookAuthority(fake);
  assert(c.classification === 'NON_PORTABLE_SAME_ENGINE', c.classification);
});

test('J — prove-policy-authority on portable temp project', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-prove-'));
  fs.mkdirSync(path.join(tmp, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.agent-os/project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: prove\n  name: prove\ncapabilities: []\nagents: {}\nownership: []\n',
    'utf8'
  );
  installPortablePolicyHooks(tmp);
  // Ensure install manifest / env can resolve ForgeOS for shim
  process.env.FORGEOS_ROOT = ROOT;
  process.env.CURSOR_AGENT_OS_PLUGIN_ROOT = ROOT;
  const r = spawnSync(
    'node',
    [path.join(ROOT, 'bootstrap/prove-policy-authority.mjs'), '--project-dir', tmp],
    { encoding: 'utf8', env: { ...process.env, FORGEOS_ROOT: ROOT, CURSOR_AGENT_OS_PLUGIN_ROOT: ROOT } }
  );
  assert(r.status === 0, `prove failed: ${r.stdout}\n${r.stderr}`);
  const report = JSON.parse(r.stdout);
  assert(report.verdict === 'ONE_AUTHORITATIVE_DECISION', report.verdict);
  assert(report.dual_authority_class == null);
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
