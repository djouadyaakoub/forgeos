/**
 * Stage 14 — Security / architecture boundary tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapabilityOperation } from '../intelligence/capability/operation.mjs';
import {
  getOperation,
  registerExternalOperation,
  clearOperationRegistryCache,
  loadOperationRegistry,
} from '../intelligence/capability/operations.mjs';
import { selectOperationsForFindings } from '../intelligence/capability/operation-selection.mjs';
import { resolveCapability, resolveCapabilityOperation } from '../intelligence/capability/resolver.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearOperationRegistryCache();
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s14n-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: s14n\n  name: s14n\n  type: application\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

console.log('Stage 14 — Negative / security\n');

test('operation cannot authorize', () => {
  const op = getOperation('create-missing-project-docs');
  assert.equal(op.may_authorize, false);
  assert.equal(op.claims_policy_authority, false);
  assert.equal(
    validateCapabilityOperation({ ...op, claims_policy_authority: true }).valid,
    false
  );
});

test('operation cannot execute / auto_execute', () => {
  const op = getOperation('propose-module-reorganization');
  assert.equal(op.may_execute, false);
  assert.equal(op.auto_execute, false);
  assert.equal(validateCapabilityOperation({ ...op, may_execute: true }).valid, false);
  assert.equal(validateCapabilityOperation({ ...op, auto_execute: true }).valid, false);
});

test('operation modules do not call backend.start / host.start / executeGoverned', () => {
  const files = [
    'intelligence/capability/operation.mjs',
    'intelligence/capability/operations.mjs',
    'intelligence/capability/operation-selection.mjs',
  ];
  for (const rel of files) {
    const src = strip(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bexecuteGoverned\b/.test(src), rel);
    assert.ok(!/backend\.start/.test(src), rel);
    assert.ok(!/getHostExecutionAdapter/.test(src), rel);
    assert.ok(!/from ['"].*runtime\/execution/.test(src), rel);
  }
});

test('operation cannot expand scope silently', () => {
  const op = getOperation('propose-module-reorganization');
  const selection = selectOperationsForFindings({
    capability_id: 'codebase-organization',
    findings: [{ type: 'misplaced_source_root', path: 'orphan.mjs' }],
    facts: { initialized: true, has_source: true },
    assessment: {},
  });
  const cand = selection.candidates[0];
  assert.deepEqual(cand.scope.allowed_paths, op.scope.allowed_paths);
  // Task cannot widen beyond operation allowed paths via createTaskCandidate defaults
  const task = createTaskCandidate({
    task_id: 'T',
    capability_id: 'codebase-organization',
    capability_operation: { ...op, scope: cand.scope },
    allowed_paths: op.scope.allowed_paths,
    verification_strategy: op.verification_strategy,
  }).candidate;
  assert.deepEqual(task.policy_context.allowed_paths, op.scope.allowed_paths);
});

test('operation cannot mutate Project Intelligence', () => {
  const dir = makeDir();
  const yaml = path.join(dir, '.agent-os', 'project.yaml');
  const before = fs.readFileSync(yaml, 'utf8');
  selectOperationsForFindings({
    capability_id: 'structure-audit',
    findings: [{ type: 'structure_issue' }],
    facts: { initialized: true, has_source: true, project_dir: dir },
    assessment: {},
  });
  loadOperationRegistry({ fresh: true });
  assert.equal(fs.readFileSync(yaml, 'utf8'), before);
});

test('operation cannot mark PASS / SATISFIED', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/capability/operations.mjs'), 'utf8'));
  assert.ok(!/SATISFIED|verification\.result\s*=\s*['"]PASS['"]/.test(src));
  const op = getOperation('create-missing-project-docs');
  assert.ok(!('verification_result' in op));
});

test('Main Agent remains plan-only', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/main-agent.mjs'), 'utf8'));
  assert.ok(!/\bexecuteGoverned\b/.test(src));
  assert.ok(!/backend\.start/.test(src));
  const plan = planFromRequest({
    request: 'Improve documentation',
    project_dir: makeDir(),
    persist: false,
  });
  assert.equal(plan.execute, false);
  assert.equal(plan.plan.execution_status, 'NOT_STARTED');
});

test('Resolver never executes even with operation', () => {
  const r = resolveCapabilityOperation({
    operation_id: 'create-missing-project-docs',
  });
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('Policy DENY still blocks with operation resolution', () => {
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    operation_id: 'create-missing-project-docs',
    policy_context: { permission: 'deny' },
  });
  assert.equal(r.resolved, false);
  assert.equal(r.executable, false);
});

test('capability mismatch rejected', () => {
  const op = getOperation('create-missing-project-docs');
  const r = resolveCapability({
    capability_id: 'structure-audit',
    capability_operation: op,
  });
  assert.equal(r.resolved, false);
  assert.ok(r.reasons.includes('operation_capability_mismatch'));
});

test('assessment does not auto-execute operations', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  const result = runProjectAssessment({ project_dir: dir, persist: false });
  assert.equal(result.execute, false);
  for (const row of result.assessments) {
    if (row.task_candidate) {
      assert.equal(row.task_candidate.execute, false);
      assert.equal(row.task_candidate.auto_execute, false);
    }
  }
});

test('host-specific Cursor instructions are not canonical in operations', () => {
  const reg = loadOperationRegistry({ fresh: true });
  for (const op of reg.operations) {
    assert.doesNotMatch(op.description, /Ask Cursor|Cursor Agent/i);
    assert.doesNotMatch(op.name, /Cursor/i);
  }
});

test('external ops not trusted', () => {
  assert.equal(registerExternalOperation({ id: 'evil' }).ok, false);
});

console.log(`\nStage 14 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
