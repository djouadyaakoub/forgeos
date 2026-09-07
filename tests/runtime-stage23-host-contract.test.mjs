import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_HOST_IDS, validateHostCapabilityDescriptor, validateHostExecutionAdapter } from '../host/adapter.mjs';
import { discoverHostCapabilities, discoverHosts, selectHost, getHostExecutionAdapter } from '../host/discovery.mjs';
import { createHostHandoff, requestHostTaskVerification, validateHostHandoff, computeHandoffIntegrity } from '../intelligence/orchestrator/host-handoff.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { runForgeOsTaskCli } from '../cli/task.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';
import { createRuntimeRegistry, defaultRuntimeRegistry } from '../runtime/registry.mjs';
import { assertPermanentAgentFreeze } from '../intelligence/capability/permanent-agent-freeze.mjs';
import { checkInvariantRegistry } from '../scripts/release/invariant-enforcer-registry.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s23-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"stage23"}');
  return root;
}
const candidate = () => createTaskCandidate({ task_id: 'S23-doc', capability_id: 'documentation-sync',
  objective: 'Document the project', allowed_paths: ['docs/**'], forbidden_paths: ['policy/**'],
  expected_effects: ['Documentation present'], finding_ids: ['missing-doc'],
  verification_strategy: 'presence', verification_presence: ['docs/proof.md'] }).candidate;
function handoff(root, host_id, extra = {}) {
  return createHostHandoff({ project_dir: root, candidate: candidate(), host_id,
    persist: false, created_at: '2026-09-05T00:00:00Z', ...extra });
}

for (const host_id of PRODUCT_HOST_IDS) {
  test(`${host_id}: canonical interactive contract and no launcher`, () => {
    const adapter = getHostExecutionAdapter(host_id);
    const d = discoverHostCapabilities({ host_id });
    assert.equal(validateHostExecutionAdapter(adapter).valid, true);
    assert.deepEqual(validateHostCapabilityDescriptor(d), { valid: true, reasons: [] });
    assert.equal(d.same_workspace, true);
    assert.equal(d.workspace_scope, 'existing_project');
    assert.equal(d.implementation_kind, 'HOST_NATIVE');
    assert.equal(d.requires_docker, false);
    assert.equal(d.launches_external_runtime, false);
    assert.equal(adapter.start({}).started, false);
    assert.equal(adapter.start({}).execution_status, 'HOST_INTERACTIVE_REQUIRED');
    assert.equal(adapter.collectEvidence({}).available, false);
    assert.equal(adapter.health().status, 'unknown');
    assert.equal(adapter.canHandle({}, null, { permission: 'deny' }).ok, false);
    assert.equal(adapter.canHandle({}, null, { policy_decision: { permission: 'deny' } }).ok, false);
    assert.equal(createRuntimeRegistry().get(host_id), null);
    assert.equal(defaultRuntimeRegistry.get(host_id), null);
  });

  test(`${host_id}: deterministic same-project handoff and ForgeOS-only completion`, (t) => {
    const root = fixture(t);
    const a = handoff(root, host_id);
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.deepEqual(a, handoff(root, host_id));
    const h = a.handoff;
    assert.equal(h.host.host_id, host_id);
    assert.equal(h.implementation.type, 'host_native');
    assert.equal(h.workspace.project_dir, fs.realpathSync(root).replace(/\\/g, '/'));
    assert.deepEqual(h.constraints.allowed_paths, ['docs/**']);
    assert.deepEqual(h.constraints.forbidden_paths, ['policy/**']);
    assert.deepEqual(h.expected_effects, ['Documentation present']);
    assert.equal(h.completion_requirements.forgeos_verification_required, true);
    assert.equal(h.verification_status, 'NOT_STARTED');
    assert.match(h.instructions, /Do not claim verification PASS/);
    const failed = requestHostTaskVerification({ project_dir: root, task_id: h.task_id, handoff: h, persist: false, rescan: false });
    assert.equal(failed.verification_status, 'FAIL');
    assert.equal(failed.capability_satisfied, false);
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/proof.md'), '# proof');
    const passed = requestHostTaskVerification({ project_dir: root, task_id: h.task_id, handoff: h, persist: false, rescan: false });
    assert.equal(passed.verification_status, 'PASS');
    assert.notEqual(passed.capability_satisfied, true); // no Canvas rescan, no automatic SATISFIED
  });

  test(`${host_id}: resolver selection does not become execution or accept fake start`, () => {
    const r = resolveCapability({ capability_id: 'documentation-sync', host_id,
      host_context: { host_id, programmatic_agent_start: true },
      host_descriptor: { host_id, invocation: 'programmatic', programmatic_agent_start: true } });
    assert.equal(r.implementation_id, host_id);
    assert.equal(r.implementation_type, 'host_native');
    assert.equal(r.executable, false);
    assert.equal(r.requirements.runtime_router_required, false);
    assert.equal(r.execution_boundary, 'resolver_does_not_execute');
  });
}

test('descriptor validation deterministic; malformed claims fail', () => {
  const d = discoverHostCapabilities({ host_id: 'codex' });
  for (const bad of [null, [], {}, { ...d, host_id: '../x' }, { ...d, requires_docker: true },
    { ...d, programmatic_execution: true }, { ...d, same_workspace: false }, { ...d, capabilities: [null] }]) {
    const a = validateHostCapabilityDescriptor(bad);
    assert.equal(a.valid, false);
    assert.deepEqual(a, validateHostCapabilityDescriptor(bad));
  }
  const reordered = Object.fromEntries(Object.entries(d).reverse());
  assert.deepEqual(validateHostCapabilityDescriptor(d), validateHostCapabilityDescriptor(reordered));
});

test('selection distinguishes support, detection hints, declared active and legacy default', () => {
  assert.equal(selectHost({ env: { CURSOR_WORKSPACE: 'hint' } }).source, 'legacy_default');
  assert.equal(selectHost({ env: {} }).host_id, 'cursor');
  assert.equal(selectHost({ env: { FORGEOS_ACTIVE_HOST: 'codex' } }).host_id, 'codex');
  assert.equal(selectHost({ host_id: 'claude-code', active_host_id: 'codex', env: {} }).host_id, 'claude-code');
  const all = discoverHosts({ env: {}, detected_host_ids: PRODUCT_HOST_IDS });
  assert.equal(all.hosts.filter(h => h.detected).length, 3);
  assert.ok(all.hosts.every(h => h.active === null));
  assert.equal(selectHost({ env: { FORGEOS_ACTIVE_HOST: 'bad' } }).ok, false);
});

test('unknown and path-like IDs fail safely with no runtime fallback', (t) => {
  const root = fixture(t);
  for (const host_id of ['../codex', 'C:\\codex', '__proto__', 'toString', '', {}, 'CODEX']) {
    assert.equal(selectHost({ host_id }).ok, false);
    assert.equal(discoverHostCapabilities({ host_id }).valid, false);
    assert.equal(getHostExecutionAdapter(host_id).prepare({}).ok, false);
    assert.equal(handoff(root, host_id).ok, false);
    assert.equal(resolveCapability({ capability_id: 'documentation-sync', host_id }).resolved, false);
  }
  assert.equal(runForgeOsTaskCli(['node', 'task', 'T', '--host', '../x'], { print: false }).reason, 'unknown_host');
  assert.equal(runForgeOsTaskCli(['node', 'task', 'T', '--host'], { print: false }).reason, 'unknown_host');
  assert.equal(runForgeOsAssessmentCli(['node', 'run', '--host', '../x'], { print: false }).reason, 'unknown_host');
});

test('discovery returns isolated descriptors, not poisonable cached state', () => {
  const d = discoverHostCapabilities({ host_id: 'codex' });
  d.capabilities.push('launch');
  assert.equal(discoverHostCapabilities({ host_id: 'codex' }).capabilities.includes('launch'), false);
});

test('DENY in any supplied context blocks handoff before persistence', (t) => {
  const root = fixture(t);
  for (const host_id of PRODUCT_HOST_IDS) {
    for (const input of [{ policy_decision: 'deny' }, { policy_decision: { permission: 'deny' } },
      { policy_decision: 'allow', policy_context: { permission: 'deny' } }]) {
      assert.equal(handoff(root, host_id, { ...input, persist: true }).reason, 'policy_deny');
    }
  }
  assert.equal(fs.existsSync(path.join(root, 'docs/project/tasks')), false);
});

test('workspace, host and integrity checks reject replay/alteration', (t) => {
  const root = fixture(t), other = fixture(t);
  const h = handoff(root, 'codex').handoff;
  assert.equal(validateHostHandoff(h, { project_dir: other }).ok, false);
  assert.equal(requestHostTaskVerification({ project_dir: other, task_id: h.task_id, handoff: h, persist: false }).ok, false);
  assert.equal(validateHostHandoff(h, { expected_host_id: 'cursor' }).ok, false);
  const changed = { ...h, objective: 'outside scope' };
  assert.equal(validateHostHandoff(changed).ok, false);
  const denied = { ...h, policy_context: { ...h.policy_context, permission: 'deny' } };
  denied.integrity = computeHandoffIntegrity(denied);
  assert.equal(requestHostTaskVerification({ project_dir: root, task_id: h.task_id, handoff: denied, persist: false }).reason, 'policy_deny');
});

test('CLI selects each host; persisted handoff cannot silently override explicit selection', (t) => {
  const root = fixture(t);
  const assessment = { canvas: { task_candidates: [candidate()] } };
  for (const host_id of PRODUCT_HOST_IDS) {
    const r = runForgeOsTaskCli(['node', 'task', 'S23-doc', '--project', root, '--host', host_id, '--no-persist'], { print: false, assessment });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.host.host_id, host_id);
  }
  handoff(root, 'cursor', { persist: true });
  assert.equal(runForgeOsTaskCli(['node', 'task', 'S23-doc', '--project', root, '--host', 'codex'], { print: false, assessment }).ok, false);
  const regenerated = runForgeOsTaskCli(['node', 'task', 'S23-doc', '--project', root, '--host', 'codex', '--regenerate', '--no-persist'], { print: false, assessment });
  assert.equal(regenerated.ok, true);
  assert.equal(regenerated.host.host_id, 'codex');
});

test('source boundaries, contributor bootstrap, dependencies and Stage 22 remain intact', () => {
  for (const file of ['host/adapter.mjs', 'host/discovery.mjs', 'host/interactive.mjs',
    ...PRODUCT_HOST_IDS.map(id => `host/adapters/${id}/index.mjs`)]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /child_process|\beval\s*\(|\bimport\s*\(|\bfetch\s*\(|runtime\/router|executeGoverned|writeFile/);
  }
  const resolver = fs.readFileSync(path.join(ROOT, 'intelligence/capability/resolver.mjs'), 'utf8');
  assert.doesNotMatch(resolver.replace(/\/\*[\s\S]*?\*\//g, ''), /getHostExecutionAdapter|\.start\s*\(|\.prepare\s*\(/);
  const guidance = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(guidance.split('\n').length < 50);
  for (const text of ['Capability != Agent', 'DENY', 'Canvas', 'pre-existing', 'authorization', 'one report']) assert.ok(guidance.includes(text));
  assert.equal(assertPermanentAgentFreeze().ok, true);
  assert.equal(checkInvariantRegistry(ROOT).status, 'pass');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.optionalDependencies, { '@babel/parser': '7.29.8' });
});
