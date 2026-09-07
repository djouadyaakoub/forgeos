import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInvariantRegistry, validateInvariantRegistry, INVARIANT_MANIFEST }
  from '../scripts/release/invariant-enforcer-registry.mjs';
import { assertPermanentAgentFreeze } from '../intelligence/capability/permanent-agent-freeze.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const record = (id = 'test-contract', enforcers = ['enforcer.mjs']) =>
  ({ id, description: 'A test contract', enforcers });
function fixture(t, invariants = [record()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s22-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts/release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'enforcer.mjs'), 'throw new Error("must not execute");');
  fs.writeFileSync(path.join(root, INVARIANT_MANIFEST), JSON.stringify({ schema_version: 1, invariants }));
  return root;
}
const writeManifest = (root, value) => fs.writeFileSync(path.join(root, INVARIANT_MANIFEST), JSON.stringify(value));

test('actual ForgeOS manifest is valid with ten high-confidence invariants', () => {
  const r = checkInvariantRegistry(ROOT);
  assert.equal(r.status, 'pass', JSON.stringify(r));
  assert.equal(r.details.checked_invariant_ids.length, 10);
  assert.equal(r.details.implementation_kind, 'FORGEOS_NATIVE');
});
test('valid manifest passes without executing the enforcer', (t) => {
  const r = validateInvariantRegistry(fixture(t));
  assert.equal(r.valid, true);
  assert.deepEqual(r.checked_invariant_ids, ['test-contract']);
});
test('missing enforcer fails even when another enforcer is live', (t) => {
  const r = validateInvariantRegistry(fixture(t, [record('test-contract', ['enforcer.mjs', 'missing.mjs'])]));
  assert.equal(r.valid, false);
  assert.deepEqual(r.missing_enforcers, [{ id: 'test-contract', path: 'missing.mjs' }]);
});
test('duplicate invariant IDs fail', (t) => {
  const r = validateInvariantRegistry(fixture(t, [record(), record()]));
  assert.equal(r.valid, false);
  assert.deepEqual(r.duplicate_invariant_ids, ['test-contract']);
});
test('invalid records fail safely', (t) => {
  for (const entry of [null, [], {}, { ...record(), description: '' },
    { ...record(), enforcers: [] }, { ...record(), enforcers: 'enforcer.mjs' },
    { ...record(), enforcers: [null] }, { ...record(), execute: 'command' }]) {
    const r = validateInvariantRegistry(fixture(t, [entry]));
    assert.equal(r.valid, false, JSON.stringify(entry));
    assert.ok(r.invalid_records.length);
  }
});
test('malformed JSON, unsupported schema, and empty registry fail', (t) => {
  const root = fixture(t);
  for (const input of ['{', 'null', '[]', '{"schema_version":2,"invariants":[]}',
    '{"schema_version":1,"invariants":[]}']) {
    fs.writeFileSync(path.join(root, INVARIANT_MANIFEST), input);
    assert.equal(checkInvariantRegistry(root).status, 'fail');
  }
});
test('missing manifest fails through the canonical release check', (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, INVARIANT_MANIFEST));
  const r = checkInvariantRegistry(root);
  assert.equal(r.check, 'invariant_enforcer_registry');
  assert.equal(r.status, 'fail');
  assert.ok(r.details.invalid_records.some((d) => d.reason === 'manifest_missing_file'));
  const release = fs.readFileSync(path.join(ROOT, 'scripts/release/validate-release.mjs'), 'utf8');
  assert.match(release, /const checks = \[\s*checkInvariantRegistry\(ROOT\)/);
  assert.match(release, /checks.filter\(\(c\) => c.status === 'fail'\)/);
});
test('fingerprint stable across order, keys, path separators and unrelated changes', (t) => {
  const root = fixture(t, [record('b-contract'), record('a-contract', ['enforcer.mjs', 'scripts/../enforcer.mjs'])]);
  const a = validateInvariantRegistry(root).fingerprint;
  writeManifest(root, { invariants: [
    { enforcers: ['.\\enforcer.mjs'], description: 'A test contract', id: 'a-contract' }, record('b-contract')], schema_version: 1 });
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'not a dependency');
  assert.equal(validateInvariantRegistry(root).fingerprint, a);
  assert.equal(validateInvariantRegistry(root).fingerprint, a);
  fs.writeFileSync(path.join(root, 'enforcer.mjs'), 'changed');
  assert.notEqual(validateInvariantRegistry(root).fingerprint, a);
});
test('traversal, absolute, drive, UNC and alternate stream paths rejected', (t) => {
  for (const ref of ['../outside', 'scripts/../../outside', '/etc/passwd', 'C:\\outside',
    'C:outside', '\\\\server\\share', 'enforcer.mjs:stream', '\0bad']) {
    const r = validateInvariantRegistry(fixture(t, [record('test-contract', [ref])]));
    assert.equal(r.valid, false, ref);
    assert.ok(r.invalid_records.length, ref);
  }
});
test('outside symlink/junction target rejected including missing leaf and manifest', (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const ref of ['linked/enforcer.mjs', 'linked/missing.mjs']) {
    writeManifest(root, { schema_version: 1, invariants: [record('test-contract', [ref])] });
    assert.ok(validateInvariantRegistry(root).invalid_records.some((d) => d.reason === 'path_escape'));
  }
  assert.equal(checkInvariantRegistry(root, { manifest_path: `linked/${INVARIANT_MANIFEST}` }).status, 'fail');
});
test('directory is not an enforcer; missing root is safe', (t) => {
  const root = fixture(t, [record('test-contract', ['scripts'])]);
  assert.equal(validateInvariantRegistry(root).valid, false);
  assert.equal(validateInvariantRegistry(path.join(root, 'absent')).valid, false);
});
test('no task, approval, verification or Canvas mutation; no runtime or dependencies', (t) => {
  const root = fixture(t);
  for (const file of ['task.json', 'approval.json', 'canvas.json']) {
    fs.writeFileSync(path.join(root, file), '{"state":"UNKNOWN"}');
  }
  const before = fs.readdirSync(root).sort();
  const r = validateInvariantRegistry(root);
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  for (const file of ['task.json', 'approval.json', 'canvas.json']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), '{"state":"UNKNOWN"}');
  }
  for (const key of ['permission', 'approval', 'verification_result', 'canvas', 'state']) assert.equal(key in r, false);
  assert.equal(r.launches_external_runtime, false);
  assert.equal(r.requires_docker, false);
  assert.equal(r.requires_llm, false);
  const source = fs.readFileSync(path.join(ROOT, 'scripts/release/invariant-enforcer-registry.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|\beval\s*\(|\bfetch\s*\(|\bimport\s*\(|executeGoverned|writeFile|appendFile/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.optionalDependencies, { '@babel/parser': '7.29.8' });
  assert.equal(pkg.dependencies, undefined);
  assert.equal(assertPermanentAgentFreeze().ok, true);
});
