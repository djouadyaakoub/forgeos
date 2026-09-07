/**
 * Stage 14 — Capability operations & remediation intelligence
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCapabilityOperation,
  createCapabilityOperation,
  fingerprintCapabilityOperation,
  fingerprintOperationBinding,
} from '../intelligence/capability/operation.mjs';
import {
  loadOperationRegistry,
  getOperation,
  listOperationsForCapability,
  registerExternalOperation,
  clearOperationRegistryCache,
} from '../intelligence/capability/operations.mjs';
import {
  selectOperationsForFindings,
  pickPreferredOperationCandidate,
} from '../intelligence/capability/operation-selection.mjs';
import { resolveCapability, resolveCapabilityOperation } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { createTaskCandidate, buildTaskCandidateFromAssessment } from '../intelligence/assessment/task-candidate.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';

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

function makeDocProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s14-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage14
  name: Stage14
  type: application
  task_id_prefix: S14
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# s14\n');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# s\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# a\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s14"}\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export const x = 1;\n');
  // Missing AGENTS.md → documentation-sync finding
  return dir;
}

console.log('Stage 14 — Capability operations\n');

test('valid operation contract', () => {
  const created = createCapabilityOperation({
    id: 'create-missing-project-docs',
    capability_id: 'documentation-sync',
    name: 'Create missing project documentation',
    description: 'Create docs',
    operation_type: 'documentation',
    applies_to_finding_types: ['missing_agents_md'],
    scope: { allowed_paths: ['AGENTS.md'] },
    risk: 'LOW',
    prerequisites: ['assessment_available'],
    expected_effects: ['file exists'],
    verification_strategy: 'presence',
    implementation_types: ['forgeos_native', 'host_native'],
    preferred_implementation: 'forgeos_native',
  });
  assert.equal(created.valid, true);
  assert.ok(created.operation.operation_fingerprint);
});

test('invalid operation — missing verification rejected', () => {
  const v = validateCapabilityOperation({
    id: 'x',
    capability_id: 'documentation-sync',
    name: 'x',
    description: 'x',
    operation_type: 'documentation',
    risk: 'LOW',
    scope: { allowed_paths: ['docs/**'] },
    prerequisites: [],
    expected_effects: [],
    implementation_types: ['forgeos_native'],
    applies_to_finding_types: ['missing_agents_md'],
  });
  assert.equal(v.valid, false);
  assert.ok(v.reasons.includes('missing_or_invalid_verification_strategy'));
});

test('unknown capability rejected', () => {
  const created = createCapabilityOperation({
    id: 'op-x',
    capability_id: 'not-a-real-capability',
    name: 'x',
    description: 'x',
    operation_type: 'planning',
    risk: 'LOW',
    scope: { allowed_paths: ['docs/**'] },
    prerequisites: [],
    expected_effects: ['x'],
    verification_strategy: 'none',
    implementation_types: ['forgeos_native'],
    applies_to_finding_types: ['x'],
  }, { known_capability_ids: new Set(['documentation-sync']) });
  assert.equal(created.valid, false);
  assert.ok(created.reasons.includes('unknown_capability'));
});

test('invalid scope rejected', () => {
  const v = validateCapabilityOperation({
    id: 'x',
    capability_id: 'documentation-sync',
    name: 'x',
    description: 'x',
    operation_type: 'documentation',
    risk: 'LOW',
    scope: { allowed_paths: 'docs/**' },
    prerequisites: [],
    expected_effects: [],
    verification_strategy: 'none',
    implementation_types: ['forgeos_native'],
    applies_to_finding_types: [],
  });
  assert.equal(v.valid, false);
  assert.ok(v.reasons.includes('invalid_scope_allowed_paths'));
});

test('registry deterministic + loads', () => {
  const a = loadOperationRegistry({ fresh: true });
  const b = loadOperationRegistry({ fresh: true });
  assert.equal(a.registry_fingerprint, b.registry_fingerprint);
  assert.ok(a.count >= 8);
  assert.equal(a.errors.length, 0);
  assert.ok(getOperation('create-missing-project-docs'));
});

test('duplicate operation rejected at build', () => {
  const defs = [
    {
      id: 'dup-op',
      capability_id: 'documentation-sync',
      name: 'a',
      description: 'a',
      operation_type: 'documentation',
      risk: 'LOW',
      scope: { allowed_paths: ['docs/**'] },
      prerequisites: [],
      expected_effects: ['x'],
      verification_strategy: 'none',
      implementation_types: ['forgeos_native'],
      applies_to_finding_types: ['missing_agents_md'],
    },
    {
      id: 'dup-op',
      capability_id: 'documentation-sync',
      name: 'b',
      description: 'b',
      operation_type: 'documentation',
      risk: 'LOW',
      scope: { allowed_paths: ['docs/**'] },
      prerequisites: [],
      expected_effects: ['y'],
      verification_strategy: 'none',
      implementation_types: ['forgeos_native'],
      applies_to_finding_types: ['missing_readme'],
    },
  ];
  const reg = loadOperationRegistry({ fresh: true, definitions: defs });
  assert.ok(reg.errors.some((e) => e.reasons.includes('duplicate_operation_id')));
  assert.equal(reg.count, 1);
});

test('external registration not auto-trusted', () => {
  const r = registerExternalOperation();
  assert.equal(r.ok, false);
});

test('finding → operation deterministic mapping', () => {
  const s1 = selectOperationsForFindings({
    capability_id: 'documentation-sync',
    findings: [{ type: 'missing_agents_md', message: 'missing' }],
    facts: { initialized: true },
    assessment: { state: 'PARTIAL' },
  });
  const s2 = selectOperationsForFindings({
    capability_id: 'documentation-sync',
    findings: [{ type: 'missing_agents_md', message: 'missing' }],
    facts: { initialized: true },
    assessment: { state: 'PARTIAL' },
  });
  assert.ok(s1.candidates.length >= 1);
  assert.equal(s1.candidates[0].operation_id, 'create-missing-project-docs');
  assert.equal(
    s1.candidates[0].operation_binding_fingerprint,
    s2.candidates[0].operation_binding_fingerprint
  );
});

test('unsupported finding produces no fake operation', () => {
  const s = selectOperationsForFindings({
    capability_id: 'documentation-sync',
    findings: [{ type: 'totally_unknown_finding_xyz', message: 'x' }],
    facts: { initialized: true },
    assessment: {},
  });
  assert.equal(s.candidates.length, 0);
  assert.ok(s.unmatched_findings.some((u) => u.type === 'totally_unknown_finding_xyz'));
});

test('operation requires appropriate evidence / prerequisites', () => {
  const s = selectOperationsForFindings({
    capability_id: 'change-impact',
    findings: [{ type: 'change_impact_set', message: 'impact' }],
    facts: { initialized: true, has_source: true, changed_files: [] },
    assessment: {},
  });
  assert.equal(s.candidates.length, 0);
  assert.ok(s.unresolved.some((u) => u.reason === 'prerequisites_missing'));
});

test('task includes operation binding + fingerprints', () => {
  const dir = makeDocProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  const row = assessment.assessments.find((a) => a.binding.id === 'documentation-sync');
  assert.ok(row.task_candidate);
  assert.equal(row.task_candidate.operation_id, 'create-missing-project-docs');
  assert.ok(row.task_candidate.operation_binding_fingerprint);
  assert.ok(row.task_candidate.finding_ids.length);
  assert.equal(row.task_candidate.risk, 'LOW');
  assert.equal(row.task_candidate.verification_strategy, 'presence');
  assert.equal(row.task_candidate.execute, false);
  // Stage 9 write_files payload preserved
  assert.equal(row.task_candidate.operation?.type, 'write_files');
});

test('scope preserved on task', () => {
  const op = getOperation('propose-module-reorganization');
  const created = createTaskCandidate({
    task_id: 'T1',
    capability_id: 'codebase-organization',
    operation_id: op.id,
    capability_operation: op,
    allowed_paths: op.scope.allowed_paths,
    forbidden_paths: op.scope.forbidden_paths,
    verification_strategy: op.verification_strategy,
  });
  assert.deepEqual(created.candidate.policy_context.allowed_paths, op.scope.allowed_paths);
});

test('resolver host-native operation', () => {
  const r = resolveCapabilityOperation({
    operation_id: 'propose-module-reorganization',
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'write', 'edit', 'documentation'],
    },
  });
  assert.equal(r.operation.operation_id, 'propose-module-reorganization');
  assert.equal(r.implementation_type, 'host_native');
  assert.equal(r.executable, false);
  assert.equal(r.invocation, 'interactive');
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('resolver forgeos-native operation', () => {
  const r = resolveCapabilityOperation({
    operation_id: 'create-missing-project-docs',
    host_context: { host_id: 'cli', capabilities: ['read'] },
    preference: 'forgeos_native',
  });
  assert.equal(r.implementation_type, 'forgeos_native');
  assert.equal(r.executable, true);
  assert.equal(r.invocation, 'programmatic');
});

test('resolver oss_backed remains selectable', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'codebase-organization');
  const r = resolveCapability({
    capability_id: 'codebase-organization',
    capability_binding: binding,
    operation_id: 'propose-module-reorganization',
    preference: 'oss_backed',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  assert.equal(r.implementation_type, 'oss_backed');
  assert.equal(r.executable, true);
});

test('unavailable implementation / unknown operation', () => {
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    operation_id: 'does-not-exist',
  });
  assert.equal(r.resolved, false);
  assert.ok(r.reasons.includes('unknown_operation'));
});

test('Canvas exposes recommended_operation', () => {
  const dir = makeDocProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  assert.equal(assessment.canvas.derived, true);
  const item = assessment.canvas.items.find((i) => i.capability_id === 'documentation-sync');
  assert.ok(item.recommended_operation);
  assert.equal(item.recommended_operation.operation_id, 'create-missing-project-docs');
});

test('Main Agent plan includes operation_id', () => {
  const dir = makeDocProject();
  const plan = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  assert.equal(plan.execute, false);
  const docs = plan.plan.task_candidates.find((t) => t.capability_id === 'documentation-sync');
  assert.ok(docs);
  assert.equal(docs.operation_id, 'create-missing-project-docs');
});

test('operation fingerprint deterministic', () => {
  const op = getOperation('create-missing-project-docs');
  assert.equal(fingerprintCapabilityOperation(op), op.operation_fingerprint);
  const fp1 = fingerprintOperationBinding({
    operation_id: op.id,
    operation_fingerprint: op.operation_fingerprint,
    capability_id: op.capability_id,
    allowed_paths: op.scope.allowed_paths,
    finding_ids: ['a'],
    verification_strategy: op.verification_strategy,
  });
  const fp2 = fingerprintOperationBinding({
    operation_id: op.id,
    operation_fingerprint: op.operation_fingerprint,
    capability_id: op.capability_id,
    allowed_paths: op.scope.allowed_paths,
    finding_ids: ['a'],
    verification_strategy: op.verification_strategy,
  });
  assert.equal(fp1, fp2);
});

test('list operations for capability', () => {
  const ops = listOperationsForCapability('dead-code-analysis');
  assert.ok(ops.some((o) => o.id === 'generate-dead-code-removal-candidates'));
});

test('Stage 8–13 scripts exist', () => {
  for (const n of [8, 9, 10, 11, 12, 13]) {
    assert.ok(fs.existsSync(path.join(REPO, `tests/runtime-stage${n}-negative.test.mjs`)));
  }
});

console.log(`\nStage 14 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
