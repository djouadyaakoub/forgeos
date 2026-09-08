import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkPhysicalLocality, assertParserLocality, isContainedRelative } from '../scripts/release/physical-locality.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-rc4-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'package'), outside = path.join(base, 'package-evil');
  for (const p of [root, outside]) fs.mkdirSync(p);
  const child = path.join(root, 'child.js'); fs.writeFileSync(child, '');
  return { base, root, outside, child };
}
const link = (target, alias) => fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
test('direct child, exact root and dot-dot boundary', t => {
  const f = fixture(t);
  assert.equal(checkPhysicalLocality(f.root, f.child).ok, true);
  assert.equal(checkPhysicalLocality(f.root, f.root).ok, false);
  assert.equal(checkPhysicalLocality(f.root, path.join(f.root, '..')).ok, false);
});
test('alias root with same physical child (Windows junction / POSIX directory symlink)', t => {
  const f = fixture(t), alias = path.join(f.base, 'alias'); link(f.root, alias);
  const r = checkPhysicalLocality(alias, f.child);
  assert.equal(r.ok, true); assert.equal(r.reason, 'TEXT_ALIAS');
});
test('sibling-prefix trap is external', t => {
  const f = fixture(t); assert.equal(checkPhysicalLocality(f.root, f.outside).reason, 'EXTERNAL_DEPENDENCY');
});
test('textually internal symlink escaping package is rejected', t => {
  const f = fixture(t), alias = path.join(f.root, 'escape'); link(f.outside, alias);
  assert.equal(checkPhysicalLocality(f.root, alias).ok, false);
});
test('missing root, missing target and broken directory link fail closed', t => {
  const f = fixture(t), missing = path.join(f.base, 'missing'), broken = path.join(f.root, 'broken');
  link(missing, broken);
  for (const [root, target] of [[missing, f.child], [f.root, missing], [f.root, broken]])
    assert.equal(checkPhysicalLocality(root, target).reason, 'BROKEN_PATH');
});
test('realpath permission/error diagnostics are bounded and have no fallback', t => {
  const f = fixture(t);
  const r = checkPhysicalLocality(f.root, f.child, { realpath: () => { throw Object.assign(new Error(f.root), { code: 'EACCES' }); } });
  assert.equal(r.ok, false); assert.equal(r.reason, 'REALPATH_ERROR');
  assert.equal(JSON.stringify(r).includes(f.root), false);
});
test('Windows drive and separator semantics; POSIX dot-prefixed child', () => {
  assert.equal(isContainedRelative(path.win32.relative('C:\\package', 'D:\\package\\x'), path.win32), false);
  assert.equal(isContainedRelative('..\\package-evil', path.win32), false);
  assert.equal(isContainedRelative('node_modules\\parser', path.win32), true);
  assert.equal(isContainedRelative('..child', path.posix), true);
  assert.equal(isContainedRelative('../evil', path.posix), false);
});
test('real installed Babel local resolution passes; external resolution and symlink escape fail', t => {
  const f = fixture(t), req = createRequire(import.meta.url);
  const installed = path.dirname(req.resolve('@babel/parser/package.json'));
  const local = path.join(f.root, 'node_modules', '@babel', 'parser');
  fs.cpSync(installed, local, { recursive: true });
  const consumer = createRequire(path.join(f.root, 'package.json'));
  const resolved = consumer.resolve('@babel/parser');
  assert.equal(assertParserLocality(f.root, resolved).dependency_tree, true);
  const alias = path.join(f.base, 'alias'); link(f.root, alias);
  assert.equal(assertParserLocality(alias, resolved).reason, 'TEXT_ALIAS');
  const nested = path.join(f.root, 'consumer'); fs.mkdirSync(nested);
  const external = createRequire(path.join(nested, 'package.json')).resolve('@babel/parser');
  assert.throws(() => assertParserLocality(nested, external), /parser_not_local_to_extracted_package.*EXTERNAL_DEPENDENCY/);
  const escape = path.join(f.outside, 'node_modules'); link(path.join(f.root, 'node_modules'), escape);
  assert.throws(() => assertParserLocality(f.outside, path.join(escape, '@babel/parser/lib/index.js')), /EXTERNAL_DEPENDENCY/);
  assert.throws(() => assertParserLocality(f.root, f.child), /OUTSIDE_DEPENDENCY_TREE/);
});
