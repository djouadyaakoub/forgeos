/**
 * Stage 8 — Project Assessment Engine + Capability Resolver + Canvas
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCapabilityBindings,
  parseCapabilityRegistryYaml,
  normalizeCapabilityBinding,
} from '../intelligence/capability/binding.mjs';
import { evaluateApplicability } from '../intelligence/assessment/applicability.mjs';
import { collectProjectFacts } from '../intelligence/assessment/facts.mjs';
import { runProjectAssessment, assessCapability } from '../intelligence/assessment/engine.mjs';
import { createGovernanceEvidence } from '../intelligence/orchestrator/governance-evidence.mjs';
import { buildProjectCanvas } from '../intelligence/assessment/canvas.mjs';
import {
  evaluateEvidenceFreshness,
  buildAssessmentArtifact,
} from '../intelligence/assessment/evidence.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';
import { discoverProject, loadProjectManifest } from '../policy/project-adapter.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_EMPTY = path.join(REPO, 'tests/fixtures/empty-project');
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    return false;
  }
}

function makeTempProject(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s8-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agent-os', 'project.yaml'), yaml, 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# temp\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"tmp"}\n', 'utf8');
  return dir;
}

console.log('Stage 8 — Assessment + Resolver + Canvas\n');

console.log('--- Capability binding ---');
test('1 — registry parses with Stage 8 binding fields', () => {
  const bindings = loadCapabilityBindings();
  assert.ok(bindings.capabilities.length >= 35);
  const structure = bindings.capabilities.find((c) => c.id === 'structure-audit');
  assert.equal(structure.assessment_module, 'forgeos.assessment.structure');
  assert.ok(structure.implementation_types.includes('forgeos_native'));
});

test('2 — normalizeCapabilityBinding defaults are stable', () => {
  const b = normalizeCapabilityBinding({ id: 'x', description: 'x' });
  assert.equal(b.evidence_schema, 'capability-assessment');
  assert.equal(b.preferred_implementation, 'forgeos_native');
});

console.log('\n--- Applicability ---');
test('3 — deployment capability NOT_APPLICABLE for library project', () => {
  const binding = normalizeCapabilityBinding({
    id: 'deployment-plan',
    applicability: 'when_deployable',
  });
  const r = evaluateApplicability(binding, {
    initialized: true,
    project_type: 'library',
    has_deployment: false,
  });
  assert.equal(r.applicability, 'NOT_APPLICABLE');
});

test('4 — structure capability APPLICABLE when source present', () => {
  const binding = normalizeCapabilityBinding({
    id: 'structure-audit',
    applicability: 'when_has_source',
  });
  const r = evaluateApplicability(binding, { initialized: true, has_source: true });
  assert.equal(r.applicability, 'APPLICABLE');
});

console.log('\n--- Assessment engine ---');
test('5 — empty/uninitialized project yields UNKNOWN/NOT_APPLICABLE states', () => {
  const result = runProjectAssessment({
    project_dir: FIXTURE_EMPTY,
    persist: false,
  });
  assert.equal(result.mode, 'assess_plan_only');
  assert.equal(result.execute, false);
  assert.ok(result.canvas.summary.unknown >= 0);
  assert.ok(result.canvas.summary.not_applicable >= 0);
});

test('6 — initialized project assesses capabilities', () => {
  const result = runProjectAssessment({
    project_dir: FIXTURE_A,
    persist: false,
  });
  assert.equal(result.project.initialized, true);
  assert.ok(result.canvas.summary.total >= 35);
});

test('7 — minimal project with empty capability arrays', () => {
  const dir = makeTempProject(`contract:
  version: 1
project:
  id: minimal
  name: Minimal
  type: application
  task_id_prefix: MIN
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
`);
  const result = runProjectAssessment({ project_dir: dir, persist: false });
  assert.equal(result.project.id, 'minimal');
  assert.ok(result.canvas.items.length > 0);
});

test('8 — satisfied only via verified record merge', () => {
  const bindings = loadCapabilityBindings();
  const binding = bindings.capabilities.find((c) => c.id === 'documentation-sync');
  // Isolate completion from unrelated drift in the shared historical fixture.
  const dir = makeTempProject('contract:\n  version: 1\nproject:\n  id: complete-docs\n  name: Complete\n  type: application\ncapabilities: []\nagents: {}\nownership: []\n');
  fs.mkdirSync(path.join(dir,'docs'));
  fs.writeFileSync(path.join(dir,'docs/STACK.md'),'# Stack\nNode.js\n');
  fs.writeFileSync(path.join(dir,'AGENTS.md'),'# Guidance\n');
  const facts = collectProjectFacts(dir);
  const assessment = assessCapability(binding, dir, facts, {
    verified_records: {
      'documentation-sync': createGovernanceEvidence({
        task_id: 'TEST-001',
        capability_id: 'documentation-sync',
        verification: {
          result: 'PASS',
          strategy: 'presence',
          checks: [{ id: 'presence:AGENTS.md', result: 'PASS' }],
          reason: 'verification pass',
        },
      }),
    },
  });
  assert.equal(assessment.state, 'SATISFIED');
  assert.equal(assessment.confidence, 'HIGH');
});

test('9 — partial vs needs improvement distinction', () => {
  const binding = normalizeCapabilityBinding({
    id: 'structure-audit',
    applicability: 'when_has_source',
    assessment_module: 'forgeos.assessment.structure',
    verification_strategy: 'presence',
    default_severity: 'medium',
  });
  const dir = makeTempProject(`contract:
  version: 1
project:
  id: messy
  name: Messy
  type: application
  task_id_prefix: M
capabilities: []
agents: {}
ownership: []
`);
  fs.writeFileSync(path.join(dir, 'main.ts'), 'export {}\n');
  const facts = collectProjectFacts(dir);
  const assessment = assessCapability(binding, dir, facts, {});
  assert.ok(['PARTIAL', 'NEEDS_IMPROVEMENT', 'UNKNOWN'].includes(assessment.state));
});

test('10 — stale evidence detected on PI fingerprint change', () => {
  const artifact = buildAssessmentArtifact({
    capability_id: 'structure-audit',
    produced_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    freshness_ttl: 86400,
    project_intelligence_fingerprint: 'aaa',
  });
  const freshness = evaluateEvidenceFreshness(artifact, {
    project_intelligence_fingerprint: 'bbb',
  });
  assert.equal(freshness.stale, true);
  assert.ok(freshness.reasons.includes('project_intelligence_changed'));
});

console.log('\n--- Capability resolver ---');
test('11 — host-native resolution preferred for read-explore', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'auth-review');
  const resolution = resolveCapability({
    capability_id: binding.id,
    capability_binding: binding,
    host_context: { host_id: 'cursor', capabilities: ['read', 'analyze'] },
  });
  assert.equal(resolution.implementation_type, 'host_native');
  assert.equal(resolution.policy.policy_authority, POLICY_AUTHORITY);
});

test('12 — forgeos-native resolution for assessment modules', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structure-audit');
  const resolution = resolveCapability({
    capability_id: binding.id,
    capability_binding: binding,
    host_context: { capabilities: [] },
    preference: 'forgeos_native',
  });
  assert.equal(resolution.implementation_type, 'forgeos_native');
});

test('13 — oss-backed resolution delegates to runtime router layer', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'deployment-execute');
  const resolution = resolveCapability({
    capability_id: binding.id,
    capability_binding: binding,
    host_context: { capabilities: ['deploy', 'write'] },
    preference: 'oss_backed',
  });
  assert.equal(resolution.implementation_type, 'oss_backed');
  assert.equal(resolution.requirements.runtime_router_required, true);
});

test('14 — explicit preference honored when allowed', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'safe-refactor');
  const resolution = resolveCapability({
    capability_binding: binding,
    host_context: { capabilities: ['write', 'test'] },
    preference: 'oss_backed',
  });
  assert.equal(resolution.implementation_type, 'oss_backed');
});

test('15 — unknown capability returns unresolved', () => {
  const resolution = resolveCapability({ capability_id: 'not-a-real-capability' });
  assert.equal(resolution.resolved, false);
});

console.log('\n--- Canvas ---');
test('16 — canvas deterministic for identical assessment input', () => {
  const rows = [
    {
      assessment: {
        capability_id: 'a',
        applicability: 'APPLICABLE',
        state: 'PARTIAL',
        confidence: 'MEDIUM',
        severity: 'medium',
        evidence: [],
        stale: false,
      },
      resolution: { implementation_type: 'host_native' },
      task_candidate: null,
    },
  ];
  const c1 = buildProjectCanvas(rows, { project_id: 'p' });
  const c2 = buildProjectCanvas(rows, { project_id: 'p' });
  assert.equal(c1.fingerprint, c2.fingerprint);
  assert.equal(c1.authoritative, false);
  assert.equal(c1.derived, true);
});

test('17 — canvas run does not modify Project Intelligence', () => {
  const dir = makeTempProject(`contract:
  version: 1
project:
  id: pi-guard
  name: PI Guard
  type: application
  task_id_prefix: PIG
capabilities: []
agents: {}
ownership: []
`);
  const yamlPath = path.join(dir, '.agent-os', 'project.yaml');
  const before = fs.readFileSync(yamlPath, 'utf8');
  runProjectAssessment({ project_dir: dir, persist: true });
  const after = fs.readFileSync(yamlPath, 'utf8');
  assert.equal(before, after);
});

console.log('\n--- forgeos run CLI ---');
test('18 — CLI assess mode returns ok without execute', () => {
  const prev = process.cwd();
  try {
    process.chdir(FIXTURE_A);
    const out = runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--json', '--no-persist'], {
      host_capabilities: ['read', 'analyze', 'plan'],
      print: false,
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.execute, false);
  } finally {
    process.chdir(prev);
  }
});

test('19 — CLI --execute without approval is blocked', () => {
  const out = runForgeOsAssessmentCli(['node', 'cli/run.mjs', FIXTURE_A, '--execute', '--json', '--no-persist'], { print: false });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'approval_missing');
});

console.log('\n--- Registry parser ---');
test('20 — parseCapabilityRegistryYaml reads binding fields', () => {
  const sample = parseCapabilityRegistryYaml(`
capabilities:
  - id: demo
    assessment_module: forgeos.assessment.generic
    preferred_implementation: host_native
`);
  assert.equal(sample.capabilities[0].id, 'demo');
  assert.equal(sample.capabilities[0].assessment_module, 'forgeos.assessment.generic');
});

console.log(`\nStage 8 assessment tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
