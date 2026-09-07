/**
 * Stage 10 negative / tamper-resistance tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { executeApprovedCandidate } from '../intelligence/orchestrator/approved-execution.mjs';
import { assessCapabilityVerification } from '../intelligence/orchestrator/capability-verification.mjs';
import {
  createGovernanceEvidence,
  validateGovernanceEvidence,
  computeEvidenceIntegrity,
} from '../intelligence/orchestrator/governance-evidence.mjs';
import { mergeVerifiedState } from '../intelligence/assessment/evidence.mjs';
import { buildProjectCanvas } from '../intelligence/assessment/canvas.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  createLocalExecutorBackend,
  clearLocalExecutorRuns,
} from '../runtime/adapters/local-executor.mjs';
import { clearLifecycleStore } from '../runtime/execution.mjs';
import { clearSession } from '../policy/authority.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearLifecycleStore();
    clearLocalExecutorRuns();
    clearSession();
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function makeDocGapProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s10n-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage10n
  name: Stage10N
  type: application
  task_id_prefix: S10N
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# n\n');
  // Complete Node fixture: presence cannot discharge a genuine stack-drift finding.
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# Stack\nNode.js\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# a\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s10n"}\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function registry() {
  const r = createRuntimeRegistry();
  r.register(createLocalExecutorBackend());
  return r;
}

function passRecord(overrides = {}) {
  const record = createGovernanceEvidence({
    task_id: 'S10N-documentation-sync',
    capability_id: 'documentation-sync',
    execution_id: 'exec-a',
    verification: {
      result: 'PASS',
      strategy: 'presence',
      checks: [{ id: 'presence:AGENTS.md', result: 'PASS' }],
    },
    project_fingerprint: { composite: 'fp-a' },
    ...overrides,
  });
  return record;
}

console.log('Stage 10 — Negative / tamper resistance\n');

test('1 — forged PASS without integrity is rejected', () => {
  const record = passRecord();
  delete record.integrity;
  const v = validateGovernanceEvidence(record);
  assert.equal(v.ok, false);
  assert.equal(v.accept_satisfied, false);
});

test('2 — wrong task_id rejected', () => {
  const v = validateGovernanceEvidence(passRecord(), { expected_task_id: 'OTHER' });
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('task_id_mismatch'));
});

test('3 — wrong capability_id rejected', () => {
  const v = validateGovernanceEvidence(passRecord(), { expected_capability_id: 'structure-audit' });
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('capability_id_mismatch'));
});

test('4 — wrong execution_id rejected', () => {
  const v = validateGovernanceEvidence(passRecord(), { expected_execution_id: 'exec-b' });
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('execution_id_mismatch'));
});

test('5 — mismatched project fingerprint rejected', () => {
  const v = validateGovernanceEvidence(passRecord(), { fingerprints: { composite: 'fp-other' } });
  assert.equal(v.accept_satisfied, false);
});

test('6 — stale PASS TTL rejected', () => {
  const record = passRecord();
  record.freshness.ttl_seconds = 1;
  record.timestamps.verified_at = new Date(Date.now() - 120_000).toISOString();
  record.integrity = computeEvidenceIntegrity(record);
  const v = validateGovernanceEvidence(record, { now: Date.now() });
  assert.equal(v.stale, true);
  assert.equal(v.accept_satisfied, false);
});

test('7 — changed verification strategy', () => {
  const v = validateGovernanceEvidence(passRecord(), { expected_strategy: 'project_verification_commands' });
  assert.equal(v.accept_satisfied, false);
});

test('8 — altered timestamp breaks integrity', () => {
  const record = passRecord();
  record.timestamps.verified_at = '1999-01-01T00:00:00.000Z';
  const v = validateGovernanceEvidence(record);
  assert.ok(v.reasons.includes('integrity_mismatch'));
  assert.equal(v.accept_satisfied, false);
});

test('9 — runtime COMPLETED without verification cannot SATISFY via merge', () => {
  const assessment = {
    capability_id: 'documentation-sync',
    state: 'PARTIAL',
    verification: { strategy: 'none' },
  };
  const merged = mergeVerifiedState(assessment, {
    schema: 'forgeos-governance-evidence',
    capability_id: 'documentation-sync',
    verification_result: 'UNKNOWN',
    verified: false,
    authority: 'forgeos',
  });
  assert.notEqual(merged.state, 'SATISFIED');
  assert.equal(merged.verification.status, 'not_verified');
});

test('10 — UNKNOWN cannot convert to PASS', () => {
  const record = createGovernanceEvidence({
    task_id: 'T',
    capability_id: 'documentation-sync',
    verification: { result: 'UNKNOWN', strategy: 'none', checks: [{ id: 's', result: 'UNKNOWN' }] },
  });
  record.verification_result = 'PASS';
  record.verified = true;
  record.integrity = computeEvidenceIntegrity(record);
  const v = validateGovernanceEvidence(record);
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('pass_with_none_strategy'));
});

test('11 — FAIL cannot convert to PASS when checks fail', () => {
  const record = createGovernanceEvidence({
    task_id: 'T',
    capability_id: 'documentation-sync',
    verification: {
      result: 'FAIL',
      strategy: 'presence',
      checks: [{ id: 'presence:x', result: 'FAIL' }],
    },
  });
  record.verification_result = 'PASS';
  record.verified = true;
  record.integrity = computeEvidenceIntegrity(record);
  const v = validateGovernanceEvidence(record);
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('pass_inconsistent_with_checks'));
});

test('12 — Canvas cannot claim SATISFIED without assessment merge', () => {
  const canvas = buildProjectCanvas([
    {
      assessment: { capability_id: 'documentation-sync', state: 'SATISFIED' },
      resolution: null,
      task_candidate: null,
    },
  ]);
  assert.equal(canvas.authoritative, false);
  const dir = makeDocGapProject();
  fs.mkdirSync(path.join(dir, 'docs/project'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/project/canvas.json'), JSON.stringify(canvas));
  const assessed = runProjectAssessment({ project_dir: dir, persist: false });
  const item = assessed.canvas.items.find((i) => i.capability_id === 'documentation-sync');
  assert.notEqual(item.state, 'SATISFIED');
});

test('13 — verified record for another project fingerprint ignored', () => {
  const dir = makeDocGapProject();
  const assessed = runProjectAssessment({ project_dir: dir, persist: false });
  const row = assessed.assessments.find((a) => a.binding.id === 'documentation-sync');
  const forged = passRecord({
    project_fingerprint: { composite: 'other-project' },
  });
  const merged = mergeVerifiedState(row.assessment, forged, {
    fingerprints: { composite: 'this-project' },
    expected_strategy: 'presence',
  });
  assert.notEqual(merged.state, 'SATISFIED');
});

test('14 — evidence from another task cannot satisfy', () => {
  const v = validateGovernanceEvidence(passRecord(), {
    expected_task_id: 'TASK-B',
    expected_capability_id: 'documentation-sync',
  });
  assert.equal(v.accept_satisfied, false);
});

test('15 — evidence from another capability cannot satisfy', () => {
  const dir = makeDocGapProject();
  const { candidate } = (() => {
    const assessment = runProjectAssessment({ project_dir: dir, persist: false });
    return { candidate: assessment.assessments.find((a) => a.binding.id === 'documentation-sync').task_candidate };
  })();
  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: true,
  });
  assert.equal(loop.capability_satisfied, true);
  const other = loop.canvas_after.items.find((i) => i.capability_id === 'structure-audit');
  assert.notEqual(other.state, 'SATISFIED');
});

test('policy deny verification command cannot PASS', () => {
  const dir = makeDocGapProject();
  const yaml = fs.readFileSync(path.join(dir, '.agent-os', 'project.yaml'), 'utf8')
    .replace('commands: []', 'commands:\n    - git push origin stage10-deny');
  fs.writeFileSync(path.join(dir, '.agent-os', 'project.yaml'), yaml);
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      verification_strategy: 'project_verification_commands',
      verification_commands: ['git push origin stage10-deny'],
    },
    project_dir: dir,
  });
  assert.equal(v.result, 'FAIL');
  assert.equal(v.checks[0].reason, 'policy_denied_verification_command');
  assert.equal(v.checks[0].executed, false);
});

test('CLI --execute without approval still blocked', () => {
  const dir = makeDocGapProject();
  const out = runForgeOsAssessmentCli([
    'node', 'cli/run.mjs', dir, '--execute', '--json', '--no-persist',
  ], { print: false });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'approval_missing');
});

test('no --yes / --force', () => {
  assert.equal(runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--yes', '--json'], { print: false }).reason, 'forbidden_global_bypass');
  assert.equal(runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--force', '--json'], { print: false }).reason, 'forbidden_global_bypass');
});

test('FAIL after SATISFIED does not keep SATISFIED from stale history as latest FAIL', () => {
  const dir = makeDocGapProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  const candidate = assessment.assessments.find((a) => a.binding.id === 'documentation-sync').task_candidate;
  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const okLoop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
    execution_id: 'ok-1',
  });
  assert.equal(okLoop.capability_satisfied, true);
  const failCandidate = {
    ...candidate,
    verification_presence: ['AGENTS.md', 'gone.md'],
  };
  failCandidate.operation_fingerprint = createTaskCandidate(failCandidate).candidate.operation_fingerprint;
  const failLoop = executeApprovedCandidate({
    project_dir: dir,
    candidate: failCandidate,
    approval: createTaskApproval({
      task_id: failCandidate.task_id,
      capability_id: failCandidate.capability_id,
      approved: true,
      operation_fingerprint: failCandidate.operation_fingerprint,
    }).approval,
    runtime_registry: registry(),
    persist: true,
    execution_id: 'fail-2',
  });
  assert.equal(failLoop.verification.result, 'FAIL');
  assert.notEqual(
    failLoop.canvas_after.items.find((i) => i.capability_id === 'documentation-sync').state,
    'SATISFIED'
  );
});

console.log(`\nStage 10 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
