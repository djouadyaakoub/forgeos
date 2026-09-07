import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRODUCT_HOST_IDS, getProductHost } from '../host/catalog.mjs';
import { listHostAdapters, getHostAdapter, detectHostAdapter } from '../runtime/host-registry.mjs';
import { defaultRuntimeRegistry } from '../runtime/registry.mjs';
import { selectHost, getHostExecutionAdapter } from '../host/discovery.mjs';
import { readHostConfiguration, setProjectHost } from '../host/configuration.mjs';
import { prepareHostProject, CLAUDE_FACADE } from '../host/preparation.mjs';
import { diagnoseHost } from '../host/doctor.mjs';
import { runForgeOsHostCli } from '../cli/host.mjs';
import { runForgeOsTaskCli } from '../cli/task.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createHostHandoff, loadHostHandoff, requestHostTaskVerification } from '../intelligence/orchestrator/host-handoff.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { checkInvariantRegistry } from '../scripts/release/invariant-enforcer-registry.mjs';
import { assertPermanentAgentFreeze } from '../intelligence/capability/permanent-agent-freeze.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = 'contract:\n  version: 1\nproject:\n  id: s24\n  name: s24\ncapabilities: []\nagents: {}\nownership: []\nverification:\n  commands: []\n';
function fixture(t, manifest = MANIFEST) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s24-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (manifest !== null) { fs.mkdirSync(path.join(root, '.agent-os')); fs.writeFileSync(path.join(root, '.agent-os/project.yaml'), manifest); }
  return root;
}
const candidate = () => createTaskCandidate({ task_id: 'S24-doc', capability_id: 'documentation-sync',
  objective: 'Provide bounded documentation', allowed_paths: ['docs/**'], forbidden_paths: ['policy/**'],
  verification_strategy: 'presence', verification_presence: ['docs/proof.md'] }).candidate;
const handoff = (root, extras = {}) => createHostHandoff({ project_dir: root, host_id: 'codex', candidate: candidate(), persist: true, ...extras });
const complete = (root, extras = {}) => requestHostTaskVerification({ project_dir: root, task_id: 'S24-doc', persist: false, rescan: false, ...extras });
function task(root, ...flags) {
  return runForgeOsTaskCli(['node', 'task', 'S24-doc', '--project', root, '--no-persist', ...flags],
    { print: false, assessment: { canvas: { task_candidates: [candidate()] } } });
}

test('one product identity catalog feeds inventory, adapters and discovery; no backend registration', () => {
  assert.deepEqual(listHostAdapters().filter(h => h.product_host).map(h => h.id).sort(), [...PRODUCT_HOST_IDS].sort());
  for (const id of PRODUCT_HOST_IDS) {
    assert.equal(getHostAdapter(id).name, getProductHost(id).name);
    assert.equal(getHostExecutionAdapter(id).id, id);
    assert.equal(defaultRuntimeRegistry.get(id), null);
    assert.equal(getHostExecutionAdapter(id).start().started, false);
  }
  assert.equal(getHostAdapter('__proto__').valid, false);
});

test('explicit > project preference > declared active > fallback; inventory follows same choice', (t) => {
  const root = fixture(t);
  assert.equal(selectHost({ project_dir: root, env: {} }).source, 'legacy_default');
  assert.equal(selectHost({ project_dir: root, env: { FORGEOS_ACTIVE_HOST: 'codex' } }).host_id, 'codex');
  setProjectHost(root, 'claude-code', { apply: true });
  assert.equal(selectHost({ project_dir: root, env: { FORGEOS_ACTIVE_HOST: 'codex' } }).host_id, 'claude-code');
  assert.equal(selectHost({ project_dir: root, host_id: 'cursor', env: {} }).host_id, 'cursor');
  assert.equal(detectHostAdapter({ project_dir: root, env: {} }).id, 'claude-code');
  assert.equal(selectHost({ project_dir: root, host_id: '../bad' }).ok, false);
});

test('configuration preview and apply preserve unrelated YAML bytes/comments', (t) => {
  const root = fixture(t, MANIFEST + '# retained\n');
  const file = path.join(root, '.agent-os/project.yaml');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(setProjectHost(root, 'codex').applied, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(setProjectHost(root, 'codex', { apply: true }).ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before + 'host:\n  preferred: codex\n');
  setProjectHost(root, 'cursor', { apply: true });
  assert.equal(fs.readFileSync(file, 'utf8'), before + 'host:\n  preferred: cursor\n');
  assert.equal(setProjectHost(root, 'cursor', { apply: true }).changed, false);
});

test('invalid and ambiguous configuration fails closed without overwrite', (t) => {
  for (const block of ['host:\n  preferred: malicious\n', 'host: codex\n', 'host:\n  preferred: codex\n  preferred: cursor\n',
    'host:\n  preferred: codex\nhost:\n  preferred: cursor\n', '"host":\n  preferred: codex\n']) {
    const root = fixture(t, MANIFEST + block);
    assert.equal(readHostConfiguration(root).ok, false);
    assert.equal(diagnoseHost({ project_dir: root }).ok, false);
    assert.equal(setProjectHost(root, 'codex', { apply: true }).ok, false);
    assert.equal(fs.readFileSync(path.join(root, '.agent-os/project.yaml'), 'utf8'), MANIFEST + block);
  }
});

test('JSON fallback preference preserves unrelated manifest data', (t) => {
  const root = fixture(t, null);
  fs.mkdirSync(path.join(root, '.agent-os'));
  fs.writeFileSync(path.join(root, '.agent-os/project.json'), JSON.stringify({ project: { id: 'json' }, custom: ['kept'] }));
  assert.equal(setProjectHost(root, 'codex', { apply: true }).ok, true);
  assert.equal(readHostConfiguration(root).configured_host, 'codex');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.agent-os/project.json'))).custom, ['kept']);
});

for (const host_id of PRODUCT_HOST_IDS) {
  test(`${host_id}: preparation preview/apply/idempotence, no second workspace or hooks`, (t) => {
    const root = fixture(t, null);
    assert.equal(prepareHostProject({ project_dir: root, host_id }).ok, true);
    assert.deepEqual(fs.readdirSync(root), []);
    const r = prepareHostProject({ project_dir: root, host_id, apply: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.requires_docker, false);
    assert.equal(r.launches_external_runtime, false);
    assert.equal(fs.existsSync(path.join(root, '.cursor')), false);
    assert.equal(readHostConfiguration(root).configured_host, host_id);
    assert.equal(prepareHostProject({ project_dir: root, host_id, apply: true }).created.length, 0);
    assert.equal(diagnoseHost({ project_dir: root }).handoff_ready, true);
    assert.equal(task(root).host.host_id, host_id);
  });
}

test('canonical instructions preserved; thin Claude facade never copies guidance', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# canonical custom guide');
  prepareHostProject({ project_dir: root, host_id: 'claude-code', apply: true });
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# canonical custom guide');
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), CLAUDE_FACADE);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# user-specific instructions');
  const conflict = prepareHostProject({ project_dir: root, host_id: 'claude-code', apply: true });
  assert.equal(conflict.reason, 'instruction_facade_conflict');
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# user-specific instructions');
});

test('doctor separates support/configuration/detection/live and returns deterministic diagnostics', (t) => {
  const root = fixture(t);
  const opts = { project_dir: root, host_id: 'codex', detected_host_ids: PRODUCT_HOST_IDS, env: {} };
  const d = diagnoseHost(opts);
  assert.deepEqual(d, diagnoseHost(opts));
  assert.equal(d.adapter_available, true);
  assert.equal(d.handoff_ready, false);
  assert.equal(d.installed, null);
  assert.equal(d.live_verified, false);
  assert.equal(d.health.status, 'unknown');
  assert.ok(d.inventory.every(h => h.detected === true && h.active === null));
  assert.equal(diagnoseHost({ ...opts, host_id: 'generic' }).reason, 'unsupported_host');
});

test('bootstrap --prepare-host and CLI config integrate without vendor installation', (t) => {
  const root = fixture(t, null);
  const r = spawnSync(process.execPath, ['bootstrap/initialize.mjs', '--prepare-host', '--host', 'codex', '--project-dir', root, '--apply'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const c = runForgeOsHostCli(['node', 'host', 'config', 'set', 'cursor', '--project', root, '--apply'], { print: false });
  assert.equal(c.applied, true);
  assert.equal(selectHost({ project_dir: root }).host_id, 'cursor');
  assert.equal(fs.existsSync(path.join(root, '.cursor')), false);
});

test('stale manifest snapshot blocks display/completion until explicit safe regeneration', (t) => {
  const root = fixture(t);
  assert.equal(handoff(root).ok, true);
  fs.appendFileSync(path.join(root, '.agent-os/project.yaml'), '# changed governance context\n');
  assert.equal(complete(root).reason, 'stale_handoff');
  assert.equal(task(root).reason, 'stale_handoff');
  assert.equal(task(root, '--host', 'codex', '--regenerate').ok, true);
});

test('stale scope cannot regenerate without a current authoritative candidate', (t) => {
  const root = fixture(t);
  handoff(root);
  fs.appendFileSync(path.join(root, '.agent-os/project.yaml'), '# changed context\n');
  const result = runForgeOsTaskCli(['node', 'task', 'S24-doc', '--project', root, '--regenerate', '--no-persist'],
    { print: false, assessment: { canvas: { task_candidates: [] } } });
  assert.equal(result.reason, 'regeneration_requires_current_candidate');
  assert.equal(runForgeOsHostCli(['node', 'host', 'prepare', 'surprise', '--project', root, '--apply'], { print: false }).reason, 'unexpected_argument');
});

test('tampered cached handoff and Policy DENY cannot be laundered through regeneration', (t) => {
  const root = fixture(t);
  handoff(root, { policy_decision: 'deny' });
  assert.equal(fs.existsSync(path.join(root, 'docs/project/tasks')), false);
  handoff(root);
  const file = path.join(root, 'docs/project/tasks/S24-doc.handoff.json');
  const h = JSON.parse(fs.readFileSync(file));
  h.objective = 'tampered';
  fs.writeFileSync(file, JSON.stringify(h));
  assert.equal(task(root, '--regenerate').ok, false);
  assert.equal(complete(root).ok, false);
});

test('host switch is explicit, context stays scoped, and other workspace replay fails', (t) => {
  const root = fixture(t), other = fixture(t);
  const h = handoff(root).handoff;
  assert.equal(task(root, '--host', 'cursor').ok, false);
  const switched = task(root, '--host', 'cursor', '--regenerate');
  assert.equal(switched.ok, true);
  assert.equal(switched.host.host_id, 'cursor');
  assert.deepEqual(switched.handoff.constraints, h.constraints);
  assert.equal(complete(other, { handoff: h }).ok, false);
});

test('completion always re-verifies current state, never promotes stale PASS', (t) => {
  const root = fixture(t);
  handoff(root);
  assert.equal(complete(root, { persist: true }).verification_status, 'FAIL');
  fs.writeFileSync(path.join(root, 'docs/proof.md'), '# scoped evidence');
  const pass = complete(root, { persist: true });
  assert.equal(pass.verification_status, 'PASS');
  assert.equal(pass.evidence.evidence_class, 'FORGEOS_GOVERNANCE_EVIDENCE');
  assert.notEqual(pass.capability_satisfied, true); // no rescan requested
  fs.unlinkSync(path.join(root, 'docs/proof.md'));
  const fail = complete(root, { persist: true, rescan: true });
  assert.equal(fail.verification_status, 'FAIL');
  assert.equal(fail.capability_satisfied, false);
  assert.equal(complete(root, { policy_decision: 'deny' }).reason, 'policy_deny');
});

test('path-like task IDs and unsafe verification references fail safely', (t) => {
  const root = fixture(t);
  for (const id of ['../outside', 'a/b', 'bad:id', 'NUL', 'x.']) {
    assert.equal(handoff(root, { candidate: { ...candidate(), task_id: id } }).ok, false);
  }
  const h = handoff(root, { candidate: { ...candidate(), verification_presence: ['../outside'] } }).handoff;
  assert.equal(complete(root, { handoff: h }).ok, false);
});

test('junctions in metadata, handoff storage and evidence paths are refused', (t) => {
  for (const relative of ['.agent-os', 'docs/project/tasks', 'docs/project/assessments']) {
    const root = fixture(t, null), outside = fixture(t, null);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
    if (relative === '.agent-os') {
      assert.equal(prepareHostProject({ project_dir: root, host_id: 'codex', apply: true }).ok, false);
      assert.equal(readHostConfiguration(root).ok, false);
    } else if (relative.endsWith('tasks')) assert.equal(handoff(root).ok, false);
    else {
      handoff(root);
      assert.equal(complete(root, { persist: true }).ok, false);
    }
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test('malformed stored handoff is not treated as missing or overwritten', (t) => {
  const root = fixture(t);
  handoff(root);
  const file = path.join(root, 'docs/project/tasks/S24-doc.handoff.json');
  fs.writeFileSync(file, '{');
  assert.equal(loadHostHandoff(root, 'S24-doc').schema, 'invalid-handoff');
  assert.equal(task(root, '--regenerate').ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
});

test('unknown host CLI returns failing process exit status', (t) => {
  const root = fixture(t);
  for (const args of [['cli/host.mjs', 'doctor', '--host', '../x'], ['cli/task.mjs', 'T', '--host', '../x']]) {
    const r = spawnSync(process.execPath, [...args, '--project', root, '--json'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
  }
});

test('boundaries, canonical facade, invariants, freeze and dependencies preserved', () => {
  for (const id of PRODUCT_HOST_IDS) {
    const r = resolveCapability({ capability_id: 'documentation-sync', host_id: id });
    assert.equal(r.execution_boundary, 'resolver_does_not_execute');
    assert.equal(r.launches_external_runtime, false);
  }
  for (const file of ['catalog', 'configuration', 'doctor', 'preparation', 'discovery', 'interactive', 'project-files']) {
    const source = fs.readFileSync(path.join(ROOT, `host/${file}.mjs`), 'utf8');
    assert.doesNotMatch(source, /child_process|\beval\s*\(|\bimport\s*\(|\bfetch\s*\(|registerRuntimeBackend/);
  }
  assert.equal(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').trim(), CLAUDE_FACADE.trim());
  assert.equal(checkInvariantRegistry(ROOT).status, 'pass');
  assert.equal(assertPermanentAgentFreeze().ok, true);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.optionalDependencies, { '@babel/parser': '7.29.8' });
});
