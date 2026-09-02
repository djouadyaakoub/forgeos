#!/usr/bin/env node
/**
 * Phase 21 — Full E2E validation harness (sim-activation with applied adapter + runtime)
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { coordinateDevelopmentWorkflow } from '../intelligence/orchestrator/coordinator.mjs';
import { buildCanonicalProjectProfile, profileToPlannerContext } from '../bootstrap/project-intelligence.mjs';
import { discoverDeploymentTargets } from '../intelligence/deployment/discovery.mjs';
import { dryRunScenario, saveSession, clearSession, evaluateApprovalForOperation } from '../policy/engine.mjs';
import { loadEffectiveRules } from '../policy/project-adapter.mjs';
import { detectDeploymentIntent } from '../intelligence/orchestrator/deployment-intent.mjs';
import { invalidateApprovalOnActionEscalation } from '../intelligence/orchestrator/risk-assessment.mjs';
import { getUpdateStatus } from '../intelligence/update/status.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const SIM = process.env.SIM_ACTIVATION_PATH || 'C:/Apps/sim-activation';
const SPEED = process.env.SPEED_FLEXY_PATH || 'C:/Apps/speed-flexy-server';

let passed = 0;
let failed = 0;
const evidence = [];

function test(id, name, fn) {
  const entry = { test_id: id, name, expected: '', actual: '', ok: false };
  try {
    const result = fn(entry);
    entry.ok = true;
    entry.actual = typeof result === 'string' ? result : 'PASS';
    passed++;
    console.log(`  PASS  ${id} ${name}`);
  } catch (err) {
    entry.ok = false;
    entry.actual = err.message;
    failed++;
    console.log(`  FAIL  ${id} ${name}: ${err.message}`);
  }
  evidence.push(entry);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

if (!fs.existsSync(SIM)) {
  console.log('SKIP sim-activation not found');
  process.exit(0);
}

process.env.CURSOR_PROJECT_DIR = SIM;

console.log('Phase 21 — sim-activation Full E2E harness\n');

console.log('--- Runtime & adapter ---');
test('T00', 'manifest and runtime yaml exist', () => {
  assert(fs.existsSync(path.join(SIM, '.agent-os/project.yaml')), 'missing manifest');
  assert(fs.existsSync(path.join(SIM, '.agent-os/runtime.yaml')), 'missing runtime');
  assert(fs.existsSync(path.join(SIM, '.cursor/hooks/agent-os/policy-pre-tool.mjs')), 'missing shim');
});

test('T01', 'canonical profile sim-specific', () => {
  const p = buildCanonicalProjectProfile(SIM);
  assert(p.identity.id === 'sim-activation', 'wrong id');
  assert(p.capabilities.length > 0, 'no caps');
  assert(!JSON.stringify(p).includes('speed-flexy'), 'leakage');
  return `caps=${p.capabilities.length}`;
});

console.log('\n--- Orchestrator scenarios ---');
const scenarios = [
  {
    id: 'T12',
    task: 'Analyze the sim-activation project. Identify major components, technologies, entrypoints, data layer, deployment surfaces, testing approach. Do not modify files.',
    expectNoDeploy: true,
  },
  {
    id: 'T13',
    task: 'Inspect the pdv/ component and explain its application entrypoint, architecture organization, and testing approach. Do not modify files.',
    expectNoDeploy: true,
  },
  {
    id: 'T15',
    task: 'Audit the structure of sim-activation and identify misplaced files or unclear boundaries. Do not move or modify anything.',
    expectNoDeploy: true,
  },
  {
    id: 'T16',
    task: 'Evaluate the maintainability of the current Supabase RLS approach and identify alternative patterns worth considering.',
    expectResearch: true,
  },
  {
    id: 'T17',
    task: 'Analyze the impact of modifying admin-web/src without changing any files.',
    expectNoDeploy: true,
  },
  {
    id: 'T18',
    task: 'Review the authorization and permission boundaries of the project without making changes.',
    expectSecurity: true,
  },
  {
    id: 'T19',
    task: 'Analyze how this project is deployed and list deployment targets. Do not deploy anything.',
    expectDiscoveryOnly: true,
  },
  {
    id: 'T20',
    task: 'Prepare a dry-run deployment plan for the admin-web component. Do not execute deployment.',
    expectPlan: true,
  },
];

for (const s of scenarios) {
  test(s.id, `orchestrator: ${s.task.slice(0, 50)}...`, (entry) => {
    const profile = buildCanonicalProjectProfile(SIM);
    const ctx = profileToPlannerContext(profile);
    const result = coordinateDevelopmentWorkflow({
      project_dir: SIM,
      objective: s.task,
      task_id: `SIMACT-20260902-${s.id.replace('T', '')}`,
      ...ctx,
    });
    const stages = result.plan.development_workflow.stages.map((x) => x.name);
    entry.expected = JSON.stringify({ expectNoDeploy: s.expectNoDeploy, stages });
    if (s.expectNoDeploy) {
      assert(!stages.includes('deployment-execute'), `unexpected deploy: ${stages.join(',')}`);
    }
    if (s.expectDiscoveryOnly) {
      assert(!stages.includes('deployment-build'), 'should not build');
    }
    if (s.expectSecurity) {
      assert(result.plan.development_workflow.security_review.required, 'security required');
    }
    if (s.expectResearch) {
      assert(result.plan.development_workflow.research.required, 'research required');
    }
    assert(result.project.mode === 'INITIALIZED', 'project initialized');
    return stages.join(' → ');
  });
}

console.log('\n--- Policy ---');
test('T21', 'protected path BLOCK via hook chain', () => {
  const r = dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' });
  assert(r.permission === 'deny', r.permission);
});

test('T22', 'tier3 git push BLOCK', () => {
  const r = dryRunScenario('shell', { agent: 'orchestrator', command: 'git push origin main' });
  assert(r.permission === 'deny', r.reason);
});

test('T23', 'wrong task approval BLOCK', () => {
  clearSession();
  saveSession({ subagent_type: 'orchestrator', task_id: 'SIMACT-20260902-001' });
  const r = evaluateApprovalForOperation('git_push', 'SIMACT-20260902-999');
  assert(r.permission === 'deny', r.reason);
});

console.log('\n--- Isolation ---');
test('T25', 'deployment targets differ from Speed Flexy', () => {
  if (!fs.existsSync(SPEED)) return 'skip speed flexy';
  const a = discoverDeploymentTargets({ project_dir: SPEED, project_adapter: {} });
  const b = discoverDeploymentTargets({ project_dir: SIM, project_adapter: {} });
  const pa = [...new Set(a.targets.map((t) => t.deployment_target.provider))];
  const pb = [...new Set(b.targets.map((t) => t.deployment_target.provider))];
  assert(!pb.includes('fly.io'), `fly on sim: ${pb.join(',')}`);
  assert(pa.includes('fly.io') || pa.some((p) => /fly/.test(p)), 'sf fly');
});

console.log('\n--- Deployment discovery ---');
test('T19b', 'CI cloudflare-pages on sim-activation', () => {
  const d = discoverDeploymentTargets({ project_dir: SIM, project_adapter: {} });
  const providers = d.targets.map((t) => t.deployment_target.provider);
  assert(providers.includes('cloudflare-pages') || providers.includes('supabase'), providers.join(','));
});

console.log('\n--- Replan ---');
test('T28', 'approval invalidation on action escalation', () => {
  assert(invalidateApprovalOnActionEscalation('READ', 'WRITE'), 'READ→WRITE');
  assert(invalidateApprovalOnActionEscalation('ANALYZE', 'DEPLOY'), 'ANALYZE→DEPLOY');
});

console.log('\n--- Update status ---');
test('T29', 'update status read-only', () => {
  const status = getUpdateStatus({ project_dirs: [SIM] });
  assert(status, 'status');
  return status.installed_version || 'ok';
});

const outPath = path.join(REPO, 'tests/fixtures/phase21-e2e-evidence.json');
fs.writeFileSync(outPath, JSON.stringify({ passed, failed, evidence }, null, 2));

console.log(`\n${'─'.repeat(40)}\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed > 0 ? 1 : 0);
