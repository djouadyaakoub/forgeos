/**
 * Stage 9 — Governed execution loop tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createTaskApproval, validateTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { executeApprovedCandidate } from '../intelligence/orchestrator/approved-execution.mjs';
import { assessCapabilityVerification } from '../intelligence/orchestrator/capability-verification.mjs';
import { buildCanvasDelta } from '../intelligence/orchestrator/canvas-delta.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  createLocalExecutorBackend,
  clearLocalExecutorRuns,
} from '../runtime/adapters/local-executor.mjs';
import { clearLifecycleStore } from '../runtime/execution.mjs';
import { clearSession } from '../policy/authority.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s9-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage9-docgap
  name: Stage9 Doc Gap
  type: application
  task_id_prefix: S9
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
  fs.writeFileSync(path.join(dir, 'README.md'), '# Stage9\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# Stack\n\nnode\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# Arch\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s9"}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function registry() {
  const r = createRuntimeRegistry();
  r.register(createLocalExecutorBackend());
  return r;
}

function docsCandidate(projectDir) {
  const assessment = runProjectAssessment({ project_dir: projectDir, persist: false });
  const row = assessment.assessments.find((a) => a.binding.id === 'documentation-sync');
  return { assessment, candidate: row?.task_candidate, binding: row?.binding };
}

console.log('Stage 9 — Governed execution loop\n');

test('A — task candidate contract', () => {
  const created = createTaskCandidate({
    task_id: 'S9-1',
    capability_id: 'documentation-sync',
    objective: 'add agents md',
    operation: { type: 'write_files', writes: [{ path: 'AGENTS.md', content: 'x' }] },
  });
  assert.equal(created.valid, true);
  assert.equal(created.candidate.auto_execute, false);
  assert.ok(created.candidate.operation_fingerprint);
  assert.equal(created.candidate.policy_context.project_id, null);
});

test('B — approval contract', () => {
  const a = createTaskApproval({
    task_id: 'S9-1',
    capability_id: 'documentation-sync',
    approved: true,
    approved_by: 'tester',
  });
  assert.equal(a.valid, true);
  assert.equal(a.approval.transferable, false);
  assert.equal(a.approval.blanket, false);
});

test('C — task-scoped approval mismatch', () => {
  const candidate = createTaskCandidate({
    task_id: 'TASK-A',
    capability_id: 'documentation-sync',
    approved: true,
  }).candidate;
  const approval = createTaskApproval({
    task_id: 'TASK-B',
    capability_id: 'documentation-sync',
    approved: true,
  }).approval;
  const v = validateTaskApproval(approval, candidate);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'approval_task_mismatch');
});

test('D — missing approval blocks execution', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  assert.ok(candidate);
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: null,
    runtime_registry: registry(),
    persist: false,
  });
  assert.equal(loop.executed, false);
  assert.equal(loop.reason, 'approval_missing');
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
});

test('E — wrong task approval blocks execution', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const approval = createTaskApproval({
    task_id: 'OTHER-TASK',
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: false,
  });
  assert.equal(loop.executed, false);
  assert.equal(loop.reason, 'approval_invalid');
});

test('F — policy DENY with approval still DENY', () => {
  const dir = makeDocGapProject();
  const { candidate: base } = docsCandidate(dir);
  const candidate = {
    ...base,
    operation: { type: 'write_files', writes: [{ path: '.agent-os/project.yaml', content: 'hacked' }] },
    policy_context: {
      ...base.policy_context,
      allowed_paths: ['.agent-os/**'],
    },
  };
  candidate.operation_fingerprint = createTaskCandidate(candidate).candidate.operation_fingerprint;
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
    persist: false,
  });
  assert.equal(loop.governed.status, 'POLICY_DENIED');
  assert.equal(loop.capability_satisfied, false);
  assert.equal(loop.governed.policy_decision.authority, POLICY_AUTHORITY);
});

test('G — resolver does not execute', () => {
  const src = fs.readFileSync(path.join(REPO, 'intelligence/capability/resolver.mjs'), 'utf8');
  assert.ok(!/executeGoverned/.test(src));
});

test('H/J/N/O/T — successful E2E with verification PASS and canvas delta', () => {
  const dir = makeDocGapProject();
  const yamlBefore = fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8');
  const { assessment, candidate } = docsCandidate(dir);
  assert.ok(candidate?.operation, 'expected documentation-sync operation');
  const beforeState = assessment.canvas.items.find((i) => i.capability_id === 'documentation-sync').state;
  assert.notEqual(beforeState, 'SATISFIED');

  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    approved_by: 'e2e',
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;

  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
  });

  assert.equal(loop.governed.status, 'COMPLETED', JSON.stringify(loop.governed.error));
  assert.equal(loop.verification.result, 'PASS');
  assert.equal(loop.capability_satisfied, true);
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), true);
  assert.equal(loop.canvas_after.items.find((i) => i.capability_id === 'documentation-sync').state, 'SATISFIED');
  const change = loop.canvas_delta.changes.find((c) => c.capability_id === 'documentation-sync');
  assert.ok(change);
  assert.equal(change.after_state, 'SATISFIED');
  const yamlAfter = fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8');
  assert.equal(yamlBefore, yamlAfter);
});

test('U — failure E2E: runtime writes, verification FAIL, not SATISFIED', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate: base } = docsCandidate(dir);
  const candidate = {
    ...base,
    verification_strategy: 'presence',
    verification_presence: ['AGENTS.md', 'docs/DOES-NOT-EXIST.md'],
  };
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
    persist: false,
    before_assessment: assessment,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'FAIL');
  assert.equal(loop.capability_satisfied, false);
  assert.notEqual(
    loop.canvas_after.items.find((i) => i.capability_id === 'documentation-sync').state,
    'SATISFIED'
  );
});

test('L — verification UNKNOWN does not satisfy', () => {
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: { verification_strategy: 'none' },
    project_dir: os.tmpdir(),
  });
  assert.equal(v.result, 'UNKNOWN');
});

test('P — idempotency: second execute is ALREADY_COMPLETED', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const input = {
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: false,
    execution_id: `s9-idem-${candidate.task_id}`,
  };
  const first = executeApprovedCandidate(input);
  assert.equal(first.governed.status, 'COMPLETED');
  const second = executeApprovedCandidate(input);
  assert.equal(second.governed.status, 'ALREADY_COMPLETED');
});

test('Q — evidence(task-A) cannot satisfy task-B capability isolation', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
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

test('R — CLI assess-only does not execute', () => {
  const dir = makeDocGapProject();
  const out = runForgeOsAssessmentCli(['node', 'cli/run.mjs', dir, '--json', '--no-persist'], { print: false });
  assert.equal(out.ok, true);
  assert.equal(out.result.execute, false);
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
});

test('S — CLI execute requires approve-task', () => {
  const dir = makeDocGapProject();
  const out = runForgeOsAssessmentCli([
    'node', 'cli/run.mjs', dir, '--execute', '--capability', 'documentation-sync', '--json', '--no-persist',
  ], { print: false });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'approval_missing');
});

test('CLI execute with matching approval succeeds', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const out = runForgeOsAssessmentCli([
    'node', 'cli/run.mjs', dir,
    '--execute',
    '--capability', 'documentation-sync',
    '--approve-task', candidate.task_id,
    '--approve-by', 'cli-test',
    '--json',
  ], { runtime_registry: registry(), print: false });
  assert.equal(out.ok, true, JSON.stringify(out.execution?.governed?.error));
  assert.equal(out.execution.verification.result, 'PASS');
});

test('no --yes bypass', () => {
  const out = runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--yes', '--json'], { print: false });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'forbidden_global_bypass');
});

test('no --force bypass', () => {
  const out = runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--force', '--json'], { print: false });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'forbidden_global_bypass');
});

test('M — governance evidence distinct from runtime', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
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
    persist: false,
  });
  assert.equal(loop.governance_evidence.kind, 'FORGEOS_GOVERNANCE_EVIDENCE');
  assert.equal(loop.governance_evidence.authority, POLICY_AUTHORITY);
  assert.ok(loop.governed.runtime_evidence);
  assert.notEqual(loop.governance_evidence.kind, loop.governed.runtime_evidence.kind);
});

test('delta helper', () => {
  const delta = buildCanvasDelta(
    { items: [{ capability_id: 'documentation-sync', state: 'PARTIAL' }] },
    { items: [{ capability_id: 'documentation-sync', state: 'SATISFIED' }] },
    { task_id: 'T' }
  );
  assert.equal(delta.changes[0].after_state, 'SATISFIED');
});

console.log(`\nStage 9 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
