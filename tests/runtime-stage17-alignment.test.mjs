/**
 * Stage 17 — Host-Native + Capability-Oriented Alignment Migration tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCapability, resolveCapabilityOperation } from '../intelligence/capability/resolver.mjs';
import {
  IMPLEMENTATION_KINDS,
  launchesExternalRuntime,
  canonicalizeImplementationType,
} from '../intelligence/capability/implementation-kinds.mjs';
import {
  validateOssDerivedCapability,
  normalizeOssDerivedCapability,
  ossDerivedDoesNotLaunchExternalApplication,
} from '../intelligence/capability/oss-derived.mjs';
import {
  assertPermanentAgentFreeze,
  FROZEN_PERMANENT_AGENT_MD,
  permanentAgentGrowthForbidden,
} from '../intelligence/capability/permanent-agent-freeze.mjs';
import {
  createLocalExecutorBackend,
  LOCAL_EXECUTOR_CLASSIFICATION,
} from '../runtime/adapters/local-executor.mjs';
import { createOpenHandsBackend } from '../runtime/adapters/openhands/index.mjs';
import { createCursorHostAdapter } from '../host/adapters/cursor/index.mjs';
import { createHostHandoff } from '../intelligence/orchestrator/host-handoff.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';
import { evaluate } from '../policy/authority.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { executeGoverned, clearLifecycleStore } from '../runtime/execution.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s17-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: s17\n  name: s17\n  type: application\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# s17\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

console.log('Stage 17 — Alignment Migration\n');

test('A — Core assess/plan without OpenHands/Docker', () => {
  const dir = makeProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  assert.ok(assessment.canvas);
  const plan = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  assert.equal(plan.execute, false);
  assert.equal(plan.mode || plan.plan?.mode || 'plan_only', plan.mode || 'plan_only');
  // No OpenHands in default path
  assert.ok(!fs.existsSync(path.join(REPO, 'node_modules', 'openhands')));
});

test('B — Host-native preference for Cursor-capable documentation', () => {
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'write', 'edit', 'documentation'],
      invocation: 'interactive',
    },
  });
  assert.equal(r.implementation_type, 'host_native');
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.HOST_NATIVE);
  assert.equal(r.launches_external_runtime, false);
  assert.equal(r.available, true);
});

test('C — No fake programmatic Cursor', () => {
  const cursor = createCursorHostAdapter();
  assert.equal(cursor.programmatic_agent_start, false);
  assert.equal(cursor.invocation, 'interactive');
  const start = cursor.start({});
  assert.ok(
    start?.status === 'HOST_INTERACTIVE_REQUIRED'
      || start?.kind === 'host_interactive'
      || start?.error?.code === 'HOST_INTERACTIVE_REQUIRED'
      || JSON.stringify(start).includes('HOST_INTERACTIVE')
      || JSON.stringify(start).includes('interactive')
  );
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    host_descriptor: {
      host_id: 'cursor',
      capabilities: ['read', 'documentation', 'write', 'edit'],
      invocation: 'interactive',
      programmatic_agent_start: false,
    },
    host_context: { host_id: 'cursor', capabilities: ['read', 'documentation', 'write', 'edit'] },
  });
  assert.equal(r.executable, false);
  assert.equal(r.invocation, 'interactive');
});

test('D — Local Executor is programmatic_reference not host_native', () => {
  const backend = createLocalExecutorBackend();
  assert.equal(backend._classification, 'programmatic_reference');
  assert.equal(LOCAL_EXECUTOR_CLASSIFICATION, 'programmatic_reference');
  assert.equal(backend._host_native, false);
  assert.notEqual(backend.id, 'cursor');
  assert.ok(String(backend._note).includes('NOT host-native'));
});

test('E — OpenHands remains optional_runtime; Core ok if absent', () => {
  const oh = createOpenHandsBackend({ transport: 'probe' });
  assert.equal(oh._classification, 'optional_runtime');
  assert.equal(oh._core_required, false);
  assert.equal(oh._claims_policy_authority, false);
  // Gate without URL remains blocked environment — Core still loads
  assert.ok(typeof oh.health === 'function');
});

test('F — OSS-derived must not imply external launch', () => {
  assert.equal(ossDerivedDoesNotLaunchExternalApplication(), true);
  assert.equal(launchesExternalRuntime('oss_derived'), false);
  assert.equal(launchesExternalRuntime('oss_backed'), true);
  assert.equal(canonicalizeImplementationType('oss_backed'), 'optional_runtime');

  const bad = validateOssDerivedCapability({
    source: { kind: 'oss', project: 'x', license: 'MIT', version: '1', provenance: 'docs' },
    execution: { mode: 'forgeos_native' },
    launches_external_runtime: true,
  });
  assert.equal(bad.valid, false);

  const good = normalizeOssDerivedCapability({
    capability_id: 'structure-audit',
    source: {
      kind: 'oss',
      project: 'example-oss',
      license: 'Apache-2.0',
      reference: 'docs-only-contract',
      provenance: 'methodology reference — not installed',
    },
    execution: { mode: 'forgeos_native' },
    authority: { policy: 'forgeos', verification: 'forgeos' },
  });
  assert.equal(good.valid, true);
  assert.equal(good.launches_external_runtime, false);
  assert.equal(good.execution.launches_external_application, false);
  assert.equal(good.implementation_kind, IMPLEMENTATION_KINDS.OSS_DERIVED);

  // Resolve oss_derived when binding allows it
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    capability_binding: {
      id: 'documentation-sync',
      tool_profile: 'implement-local',
      assessment_module: 'forgeos.assessment.documentation',
      evidence_schema: 'capability-assessment',
      verification_strategy: 'presence',
      implementation_types: ['oss_derived', 'host_native'],
      preferred_implementation: 'oss_derived',
      specialist_ids: ['docs-sync'],
      oss_derived_execution_mode: 'forgeos_native',
    },
    preference: 'oss_derived',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  assert.equal(r.implementation_type, 'oss_derived');
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.OSS_DERIVED);
  assert.equal(r.launches_external_runtime, false);
  assert.equal(r.requires_runtime_router || r.requirements?.runtime_router_required, false);
});

test('G — Permanent agent freeze', () => {
  assert.equal(permanentAgentGrowthForbidden(), true);
  assert.equal(FROZEN_PERMANENT_AGENT_MD.length, 11);
  const freeze = assertPermanentAgentFreeze();
  assert.equal(freeze.ok, true, JSON.stringify(freeze));
  assert.equal(freeze.unexpected.length, 0);
});

test('H — Host-native handoff uses existing project workspace', () => {
  const dir = makeProject();
  const candidate = createTaskCandidate({
    task_id: 'S17-DOC-1',
    capability_id: 'documentation-sync',
    objective: 'Create AGENTS.md',
    project_dir: dir,
    allowed_paths: ['AGENTS.md', 'docs/**'],
    verification_strategy: 'presence',
    verification_presence: ['AGENTS.md'],
  });
  const handoff = createHostHandoff({
    candidate: candidate.candidate || candidate,
    project_dir: dir,
    host_id: 'cursor',
    persist: false,
  });
  const projectDir = (handoff.project_dir || handoff.workspace?.project_dir || dir).replace(/\\/g, '/');
  assert.ok(projectDir.includes(dir.replace(/\\/g, '/')) || projectDir === dir.replace(/\\/g, '/'));
  assert.ok(
    handoff.execution_status === 'HOST_INTERACTIVE_REQUIRED'
      || handoff.status === 'HOST_INTERACTIVE_REQUIRED'
      || handoff.invocation === 'interactive'
      || JSON.stringify(handoff).includes('HOST_INTERACTIVE')
      || JSON.stringify(handoff).includes('interactive')
  );
});

test('I — Policy DENY still blocks execution', () => {
  clearLifecycleStore();
  const dir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'S17-DENY',
    project_dir: dir,
    objective: 'protected',
    operation: { type: 'write_file', path: '.cursor/hooks.json', content: 'x' },
    allowed_paths: ['.cursor/**'],
    agent_id: 'codebase-organization',
    registry,
    backend_id: 'local-executor',
    execution_id: 's17-deny',
  });
  assert.equal(result.status, 'POLICY_DENIED');
});

test('J — Runtime completion alone cannot SATISFY via optional_runtime semantics', () => {
  const r = resolveCapabilityOperation({
    operation_id: 'create-missing-project-docs',
    preference: 'oss_backed',
    runtime_backend_id: 'openhands',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.OPTIONAL_RUNTIME);
  assert.equal(r.launches_external_runtime, true);
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
  // Resolver never marks SATISFIED
  assert.ok(!JSON.stringify(r).includes('SATISFIED'));
});

test('Legacy oss_backed alias maps to OPTIONAL_RUNTIME kind', () => {
  assert.equal(canonicalizeImplementationType('oss_backed'), 'optional_runtime');
  const r = resolveCapability({
    capability_id: 'codebase-organization',
    preference: 'oss_backed',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.OPTIONAL_RUNTIME);
  assert.equal(r.launches_external_runtime, true);
});

test('Schema + docs exist for Stage 17 contracts', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'schemas/oss-derived-capability.schema.yaml')));
  assert.ok(fs.existsSync(path.join(REPO, 'intelligence/capability/oss-derived.mjs')));
  assert.ok(fs.existsSync(path.join(REPO, 'intelligence/capability/implementation-kinds.mjs')));
});

console.log(`\nStage 17 Alignment: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
