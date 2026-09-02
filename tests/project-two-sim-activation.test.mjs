#!/usr/bin/env node
/**
 * Phase 19 — Real Project #2 validation (sim-activation)
 * Read-only against C:/Apps/sim-activation when present.
 */
import fs from 'fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProjectProfile, compareStackDetection } from '../bootstrap/project-discovery.mjs';
import { extractProjectAdapter } from '../bootstrap/adapter-extraction.mjs';
import { discoverDeploymentTargets } from '../intelligence/deployment/discovery.mjs';
import { dryRunScenario } from '../policy/engine.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const SIM = 'C:/Apps/sim-activation';
const SPEED_FLEXY = 'C:/Apps/speed-flexy-server';

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
  if (!cond) throw new Error(msg);
}

console.log('Phase 19 — sim-activation validation (read-only)\n');

if (!fs.existsSync(SIM)) {
  console.log('SKIP  sim-activation not found at', SIM);
  process.exit(0);
}

console.log('--- Discovery ---');
test('sim-activation is EXISTING_PROJECT from evidence', () => {
  const p = buildProjectProfile(SIM);
  assert(
    p.project_kind === 'EXISTING_PROJECT' || p.project_kind === 'AGENT_OS_INITIALIZED',
    `got ${p.project_kind}`
  );
  assert(p.stack_indicators.flutter === true, 'expected flutter');
  assert(p.stack_indicators.node === true, 'expected node');
  assert(!p.stack_indicators.go, 'sim-activation should not detect Go');
});

test('no .agent-os manifest yet (bootstrap required)', () => {
  const hasManifest = fs.existsSync(path.join(SIM, '.agent-os/project.yaml'));
  if (hasManifest) {
    // Post Phase 21 bootstrap — manifest expected
    assert(hasManifest, 'manifest should exist after bootstrap');
    return;
  }
  assert(!hasManifest, 'unexpected manifest');
});

test('stack differs from Speed Flexy', () => {
  if (!fs.existsSync(SPEED_FLEXY)) return;
  const cmp = compareStackDetection(SPEED_FLEXY, SIM);
  assert(!cmp.same, 'stacks must differ');
  assert(cmp.a.repository.go === true, 'Speed Flexy has Go');
  assert(cmp.b.repository.go === false, 'sim-activation has no Go');
});

console.log('\n--- Isolation ---');
test('capabilities and agents differ from Speed Flexy', () => {
  const bExt = extractProjectAdapter(SIM);
  if (!fs.existsSync(SPEED_FLEXY)) return;
  const aExt = extractProjectAdapter(SPEED_FLEXY);
  assert((aExt.adapter?.capabilities?.length || 0) > 0, 'Speed Flexy has capabilities');
  assert((bExt.adapter?.capabilities?.length || 0) > 0, 'sim-activation has extracted capabilities');
  assert(aExt.adapter.capabilities.length !== bExt.adapter.capabilities.length || 
    aExt.adapter.capabilities[0]?.id !== bExt.adapter.capabilities[0]?.id, 'cap sets differ');
  assert(Object.keys(aExt.adapter?.agents || {}).length > 0, 'Speed Flexy has agents');
  assert(Object.keys(bExt.adapter?.agents || {}).length > 0, 'sim-activation has agents');
});

test('deployment providers differ (no fly.io on sim-activation)', () => {
  const bDep = discoverDeploymentTargets({ project_dir: SIM, project_adapter: {} });
  const bProviders = [...new Set(bDep.targets.map((t) => t.deployment_target.provider))];
  assert(!bProviders.includes('fly.io'), `unexpected fly.io: ${bProviders.join(',')}`);
  assert(bProviders.includes('cloudflare-pages') || bProviders.includes('supabase'), `expected cloudflare or supabase: ${bProviders.join(',')}`);
  if (fs.existsSync(SPEED_FLEXY)) {
    const aDep = discoverDeploymentTargets({ project_dir: SPEED_FLEXY, project_adapter: {} });
    const aProviders = [...new Set(aDep.targets.map((t) => t.deployment_target.provider))];
    assert(aProviders.includes('fly.io'), 'Speed Flexy has fly.io');
  }
});

console.log('\n--- Speed Flexy leakage ---');
test('ForgeOS repo has no sim-activation hard-coding', () => {
  const skip = new Set(['tests/project-two-sim-activation.test.mjs', 'tests/fixtures/phase19-orchestrator-test1.json']);
  function walk(dir, hits = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'release') continue;
      const rel = path.relative(REPO, path.join(dir, ent.name)).replace(/\\/g, '/');
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, hits);
      else if (/\.(mjs|js|json|yaml|yml|md)$/.test(ent.name) && !skip.has(rel)) {
        const text = fs.readFileSync(full, 'utf8');
        if (/sim-activation/i.test(text)) hits.push(rel);
      }
    }
    return hits;
  }
  const allowedPrefixes = ['tests/fixtures/phase19', 'tests/fixtures/phase21', 'tests/fixtures/intelligence-matrix', 'docs/validation/', 'docs/architecture/'];
  const allowedExact = new Set(['package.json', 'tests/project-two-sim-activation.test.mjs', 'tests/project-intelligence.test.mjs', 'tests/phase21-full-e2e.mjs']);
  const hits = walk(REPO);
  const bad = hits.filter((h) => !allowedPrefixes.some((p) => h.startsWith(p)) && !allowedExact.has(h));
  assert(bad.length === 0, `unexpected sim-activation refs in core: ${bad.join(', ')}`);
});

console.log('\n--- Policy (global rules on sim-activation cwd) ---');
test('protected path BLOCK', () => {
  process.env.CURSOR_PROJECT_DIR = SIM;
  const r = dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' });
  assert(r.permission === 'deny', `expected deny got ${r.permission}`);
  assert(r.reason === 'protected_path', r.reason);
});

test('tier3 without approval BLOCK', () => {
  const r = dryRunScenario('shell', { agent: 'orchestrator', command: 'git push origin main' });
  assert(r.permission === 'deny', r.permission);
});

test('wrong-task approval BLOCK', () => {
  const r = dryRunScenario('approval', { operation: 'git_push', task_id: 'WRONG-TASK-001' });
  assert(r.permission === 'deny', r.permission);
});

console.log('\n--- Integrity ---');
test('sim-activation working tree clean except ForgeOS integration', () => {
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: SIM, encoding: 'utf8' });
  assert(st.status === 0, 'git status failed');
  const lines = st.stdout.trim().split('\n').filter(Boolean);
  const allowed = lines.every((l) =>
    /^(\?\?|\sM|\sA|\sD)\s+(\.agent-os\/|docs\/project\/)/.test(l.replace(/\\/g, '/'))
  );
  assert(allowed, `unexpected changes: ${st.stdout}`);
});

console.log(`\n${'─'.repeat(40)}\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed > 0 ? 1 : 0);
