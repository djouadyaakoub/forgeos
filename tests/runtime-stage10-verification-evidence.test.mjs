/**
 * Stage 10 — Verification, evidence, freshness, rescan, canvas delta
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import {
  executeApprovedCandidate,
  rescanProject,
  formatLoopOutcome,
} from '../intelligence/orchestrator/approved-execution.mjs';
import {
  assessCapabilityVerification,
  runPolicyBoundedCommand,
  authorizedProjectVerificationCommands,
} from '../intelligence/orchestrator/capability-verification.mjs';
import {
  createGovernanceEvidence,
  validateGovernanceEvidence,
  listGovernanceEvidence,
  computeEvidenceIntegrity,
} from '../intelligence/orchestrator/governance-evidence.mjs';
import { buildCanvasDelta } from '../intelligence/orchestrator/canvas-delta.mjs';
import { computeEvidenceFingerprint } from '../intelligence/orchestrator/fingerprints.mjs';
import { collectProjectFacts, fingerprintText } from '../intelligence/assessment/facts.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  createLocalExecutorBackend,
  clearLocalExecutorRuns,
} from '../runtime/adapters/local-executor.mjs';
import { clearLifecycleStore } from '../runtime/execution.mjs';
import { clearSession } from '../policy/authority.mjs';

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

function writePi(dir, commands = []) {
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  const commandBlock = commands.length
    ? commands.map((c) => `    - ${c}`).join('\n')
    : '    []';
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage10
  name: Stage10
  type: application
  task_id_prefix: S10
capabilities: []
agents: {}
ownership: []
verification:
  commands:
${commandBlock}
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
}

function makeDocGapProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s10-'));
  writePi(dir);
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Stage10\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# Stack\n\nnode\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# Arch\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s10"}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function makeCommandProject(scriptName, scriptBody) {
  const dir = makeDocGapProject();
  fs.writeFileSync(path.join(dir, scriptName), scriptBody);
  writePi(dir, [`node ${scriptName}`]);
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

function approve(candidate) {
  return createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    approved_by: 's10',
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
}

console.log('Stage 10 — Verification and evidence\n');

test('1 — verification PASS (presence)', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate } = docsCandidate(dir);
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
  });
  assert.equal(loop.verification.result, 'PASS');
  assert.ok(Array.isArray(loop.verification.checks));
  assert.ok(loop.verification.checks.every((c) => c.result === 'PASS'));
  assert.equal(loop.capability_satisfied, true);
});

test('2 — verification FAIL (presence missing)', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate: base } = docsCandidate(dir);
  const candidate = { ...base, verification_presence: ['AGENTS.md', 'missing.md'] };
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: false,
    before_assessment: assessment,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'FAIL');
  assert.equal(loop.capability_satisfied, false);
});

test('3/6 — verification UNKNOWN for strategy none', () => {
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED', execution_id: 'e1' },
    candidate: {
      task_id: 'T',
      capability_id: 'documentation-sync',
      verification_strategy: 'none',
    },
    project_dir: os.tmpdir(),
  });
  assert.equal(v.result, 'UNKNOWN');
  assert.equal(v.strategy, 'none');
  assert.notEqual(v.result, 'PASS');
});

test('4 — presence strategy checks filesystem', () => {
  const dir = makeDocGapProject();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# a\n');
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      task_id: 'T',
      capability_id: 'documentation-sync',
      verification_strategy: 'presence',
      verification_presence: ['AGENTS.md', 'README.md'],
    },
    project_dir: dir,
  });
  assert.equal(v.result, 'PASS');
  assert.equal(v.checks.length, 2);
});

test('5/8/9 — command strategy exit zero with output capture', () => {
  const dir = makeCommandProject('verify-hello.mjs', 'console.log("hello-verify");\n');
  const cmd = 'node verify-hello.mjs';
  const facts = collectProjectFacts(dir);
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      task_id: 'T',
      capability_id: 'documentation-sync',
      verification_strategy: 'project_verification_commands',
      verification_commands: [cmd],
    },
    project_dir: dir,
    facts,
  });
  assert.equal(v.result, 'PASS', JSON.stringify(v.checks));
  assert.match(v.checks[0].stdout || '', /hello-verify/);
});

test('8 — command non-zero exit is FAIL', () => {
  const dir = makeCommandProject('verify-fail.mjs', 'process.exit(2);\n');
  const cmd = 'node verify-fail.mjs';
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      verification_strategy: 'project_verification_commands',
      verification_commands: [cmd],
    },
    project_dir: dir,
    facts: collectProjectFacts(dir),
  });
  assert.equal(v.result, 'FAIL');
  assert.equal(v.checks[0].exit_code, 2);
});

test('7 — command timeout is FAIL', () => {
  const dir = makeCommandProject(
    'verify-timeout.mjs',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000);\n'
  );
  const cmd = 'node verify-timeout.mjs';
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      verification_strategy: 'project_verification_commands',
      verification_commands: [cmd],
    },
    project_dir: dir,
    facts: collectProjectFacts(dir),
    timeout_ms: 200,
  });
  assert.equal(v.result, 'FAIL');
  assert.equal(v.checks[0].reason, 'timeout');
});

test('10 — secret redaction in command output', () => {
  const dir = makeDocGapProject();
  const fakeJwt = ['eyJ', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'aaa', '.', 'bbb'].join('');
  const secretLine = ['Bear', 'er ', fakeJwt].join('');
  fs.writeFileSync(
    path.join(dir, 'print-secret.mjs'),
    `console.log(${JSON.stringify(secretLine)});\n`
  );
  const ran = runPolicyBoundedCommand('node print-secret.mjs', dir, { timeout_ms: 10000 });
  assert.equal(ran.result, 'PASS');
  assert.doesNotMatch(ran.stdout, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
  assert.match(ran.stdout, /REDACTED/);
});

test('unauthorized command is not executed', () => {
  const dir = makeCommandProject('verify-ok.mjs', 'process.exit(0);\n');
  const facts = collectProjectFacts(dir);
  const auth = authorizedProjectVerificationCommands(facts, {
    verification_commands: ['node verify-ok.mjs', 'rm -rf /tmp/not-authorized'],
  });
  assert.ok(auth.rejected.length >= 1);
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: {
      verification_strategy: 'project_verification_commands',
      verification_commands: ['rm -rf /tmp/not-authorized'],
    },
    project_dir: dir,
    facts,
  });
  assert.notEqual(v.result, 'PASS');
  assert.ok(v.checks.some((c) => c.reason === 'not_in_project_verification_contract' && c.executed === false));
});

test('11 — project fingerprint composite is stable for same state', () => {
  const dir = makeDocGapProject();
  const facts = collectProjectFacts(dir);
  const a = computeEvidenceFingerprint(facts, {
    project_dir: dir,
    verification_strategy: 'presence',
    verification_presence: ['README.md'],
  });
  const b = computeEvidenceFingerprint(facts, {
    project_dir: dir,
    verification_strategy: 'presence',
    verification_presence: ['README.md'],
  });
  assert.equal(a.composite, b.composite);
  assert.ok(a.project_intelligence_fingerprint);
});

test('12 — evidence schema and integrity', () => {
  const record = createGovernanceEvidence({
    task_id: 'S10-documentation-sync',
    capability_id: 'documentation-sync',
    execution_id: 'exec-1',
    verification: {
      result: 'PASS',
      strategy: 'presence',
      checks: [{ id: 'presence:AGENTS.md', result: 'PASS' }],
      reason: 'presence_confirmed',
    },
    project_fingerprint: { composite: fingerprintText('x') },
  });
  assert.equal(record.schema, 'forgeos-governance-evidence');
  assert.equal(record.evidence_class, 'FORGEOS_GOVERNANCE_EVIDENCE');
  assert.equal(record.integrity, computeEvidenceIntegrity(record));
  assert.equal(validateGovernanceEvidence(record).ok, true);
});

test('13 — evidence immutability (append, no rewrite)', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate } = docsCandidate(dir);
  executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
    execution_id: 's10-imm-1',
  });
  const first = listGovernanceEvidence(dir);
  assert.ok(first.length >= 1);
  const original = fs.readFileSync(path.join(dir, 'docs/project/assessments', first[0].file), 'utf8');
  executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    execution_id: 's10-imm-1',
  });
  const after = fs.readFileSync(path.join(dir, 'docs/project/assessments', first[0].file), 'utf8');
  assert.equal(original, after);
  assert.ok(listGovernanceEvidence(dir).length >= 1);
});

test('19/20 — successful rescan is reproducible', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate } = docsCandidate(dir);
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
  });
  assert.equal(loop.capability_satisfied, true);
  const a = rescanProject(dir, { persist: false });
  const b = rescanProject(dir, { persist: false });
  const stateA = a.canvas.items.find((i) => i.capability_id === 'documentation-sync').state;
  const stateB = b.canvas.items.find((i) => i.capability_id === 'documentation-sync').state;
  assert.equal(stateA, 'SATISFIED');
  assert.equal(stateB, stateA);
});

test('21 — Canvas delta PASS', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate } = docsCandidate(dir);
  const before = assessment.canvas.items.find((i) => i.capability_id === 'documentation-sync').state;
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: false,
    before_assessment: assessment,
  });
  const change = loop.canvas_delta.changes.find((c) => c.capability_id === 'documentation-sync');
  assert.equal(change.before_state, before);
  assert.equal(change.after_state, 'SATISFIED');
  assert.equal(change.verified_transition, true);
  assert.ok(change.evidence_id);
});

test('22 — Canvas delta FAIL does not claim SATISFIED', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate: base } = docsCandidate(dir);
  const candidate = { ...base, verification_presence: ['AGENTS.md', 'nope.md'] };
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: false,
    before_assessment: assessment,
  });
  const item = loop.canvas_after.items.find((i) => i.capability_id === 'documentation-sync');
  assert.notEqual(item.state, 'SATISFIED');
  assert.equal(loop.verification.result, 'FAIL');
});

test('23 — Canvas delta UNKNOWN is not SATISFIED', () => {
  const delta = buildCanvasDelta(
    { items: [{ capability_id: 'documentation-sync', state: 'NEEDS_IMPROVEMENT' }] },
    { items: [{ capability_id: 'documentation-sync', state: 'PARTIAL' }] },
    { verification: { result: 'UNKNOWN' }, evidence_id: 'e' }
  );
  assert.equal(delta.changes[0].verified_transition, false);
  assert.match(delta.changes[0].reason, /UNKNOWN/);
});

test('14/15/16 — stale PASS is not SATISFIED after project change', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate } = docsCandidate(dir);
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
  });
  assert.equal(loop.capability_satisfied, true);
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  const after = rescanProject(dir, { persist: false });
  const item = after.canvas.items.find((i) => i.capability_id === 'documentation-sync');
  assert.notEqual(item.state, 'SATISFIED');
  assert.ok(item.stale === true || item.state !== 'SATISFIED');
  assert.ok(listGovernanceEvidence(dir).length >= 1, 'historical evidence retained');
});

test('17 — changed capability binding fingerprint is detected', () => {
  const record = createGovernanceEvidence({
    task_id: 'T',
    capability_id: 'documentation-sync',
    verification: {
      result: 'PASS',
      strategy: 'presence',
      checks: [{ id: 'p', result: 'PASS' }],
    },
    project_fingerprint: {
      composite: 'aaa',
      capability_binding_fingerprint: 'old',
    },
  });
  const v = validateGovernanceEvidence(record, {
    fingerprints: { composite: 'bbb', capability_binding_fingerprint: 'new' },
  });
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('project_fingerprint_mismatch'));
});

test('18 — changed verification strategy rejected', () => {
  const record = createGovernanceEvidence({
    task_id: 'T',
    capability_id: 'documentation-sync',
    verification: {
      result: 'PASS',
      strategy: 'presence',
      checks: [{ id: 'p', result: 'PASS' }],
    },
  });
  const v = validateGovernanceEvidence(record, { expected_strategy: 'none' });
  assert.equal(v.accept_satisfied, false);
  assert.ok(v.reasons.includes('verification_strategy_changed'));
});

test('28 — runtime COMPLETED without verification is not SATISFIED', () => {
  const v = assessCapabilityVerification({
    governed: { status: 'COMPLETED' },
    candidate: { verification_strategy: 'none' },
    project_dir: os.tmpdir(),
  });
  assert.equal(v.result, 'UNKNOWN');
});

test('CLI distinguishes execution vs verification vs capability', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const out = runForgeOsAssessmentCli([
    'node', 'cli/run.mjs', dir,
    '--execute', '--capability', 'documentation-sync',
    '--approve-task', candidate.task_id, '--json', '--no-persist',
  ], { runtime_registry: registry(), print: false });
  assert.equal(out.verification.result, 'PASS');
  assert.equal(out.evidence.evidence_class, 'FORGEOS_GOVERNANCE_EVIDENCE');
  assert.ok(out.delta);
  assert.ok(out.canvas);
  const text = formatLoopOutcome(out.execution);
  assert.match(text, /EXECUTION:/);
  assert.match(text, /VERIFICATION:/);
  assert.doesNotMatch(text, /^SUCCESS$/m);
});

test('29 — Stage 9 successful E2E regression', () => {
  const dir = makeDocGapProject();
  const yamlBefore = fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8');
  const { assessment, candidate } = docsCandidate(dir);
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: true,
    before_assessment: assessment,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'PASS');
  assert.equal(loop.capability_satisfied, true);
  assert.equal(fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8'), yamlBefore);
});

test('30 — Stage 9 failed E2E regression', () => {
  const dir = makeDocGapProject();
  const { assessment, candidate: base } = docsCandidate(dir);
  const candidate = {
    ...base,
    verification_strategy: 'presence',
    verification_presence: ['AGENTS.md', 'docs/DOES-NOT-EXIST.md'],
  };
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval: approve(candidate),
    runtime_registry: registry(),
    persist: false,
    before_assessment: assessment,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'FAIL');
  assert.equal(loop.capability_satisfied, false);
});

test('determinism — same project yields same capability states', () => {
  const dir = makeDocGapProject();
  const a = runProjectAssessment({ project_dir: dir, persist: false });
  const b = runProjectAssessment({ project_dir: dir, persist: false });
  const statesA = a.canvas.items.map((i) => `${i.capability_id}:${i.state}`).join('|');
  const statesB = b.canvas.items.map((i) => `${i.capability_id}:${i.state}`).join('|');
  assert.equal(statesA, statesB);
});

test('no second execution path in verification module', () => {
  const src = fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/capability-verification.mjs'), 'utf8');
  assert.ok(!/executeGoverned|backend\.start\(/.test(src));
});

console.log(`\nStage 10 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
