import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isExecutedAsMain } from '../cli/main.mjs';
import { checkReleaseChecksums } from '../scripts/release/checksum-validation.mjs';
import { parseProcessJson } from '../scripts/release/process-json.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-rc3-test-'));
const project = path.join(base, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'README.md'), '# Fixture\n');
const alias = path.join(base, 'alias');
fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
test.after(() => {
  // Only the task-created temporary tree; junction removal does not traverse its target.
  assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
  fs.rmSync(base, { recursive: true, force: true });
});
const run = (args, cwd = base) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(base, "checksum with ' quote-"));
  fs.mkdirSync(path.join(dir, 'release'));
  fs.writeFileSync(path.join(dir, 'release/product.zip'), 'fixture archive');
  const hash = crypto.createHash('sha256').update('fixture archive').digest('hex');
  const write = sha => fs.writeFileSync(path.join(dir, 'release/checksums.json'), JSON.stringify({ artifacts: [{ name: 'product.zip', sha256: sha }] }));
  write(hash); return { dir, hash, write };
};

test('checksum valid manifest uses explicit ESM subprocess and JSON evidence', () => {
  const f = fixture(), r = checkReleaseChecksums(f.dir);
  assert.equal(r.status, 'pass', JSON.stringify(r));
  assert.equal(r.result.reason, 'match'); assert.equal(r.result.actual, f.hash);
  assert.equal(r.stderr, ''); assert.equal(JSON.parse(r.stdout).valid, true);
});
test('checksum mismatch is a diagnostic failure', () => {
  const f = fixture(); f.write('0'.repeat(64)); const r = checkReleaseChecksums(f.dir);
  assert.equal(r.status, 'fail'); assert.equal(r.reason, 'checksum_mismatch');
  assert.equal(r.result.actual, f.hash); assert.equal(r.exit_code, 1);
});
test('missing artifact, malformed hash and malformed manifest fail closed', () => {
  const f = fixture(); f.write('not-a-sha');
  assert.equal(checkReleaseChecksums(f.dir).reason, 'malformed_checksum');
  f.write(f.hash); fs.unlinkSync(path.join(f.dir, 'release/product.zip'));
  assert.equal(checkReleaseChecksums(f.dir).reason, 'archive_not_found');
  fs.writeFileSync(path.join(f.dir, 'release/checksums.json'), '{');
  assert.equal(checkReleaseChecksums(f.dir).reason, 'unreadable_checksum_manifest');
  fs.writeFileSync(path.join(f.dir, 'release/checksums.json'), 'null');
  assert.equal(checkReleaseChecksums(f.dir).reason, 'no_archive_entry');
});
test('real child module failure preserves stderr and reason', () => {
  const f = fixture(); const r = checkReleaseChecksums(f.dir, { moduleUrl: pathToFileURL(path.join(base, 'missing.mjs')).href });
  assert.equal(r.status, 'fail'); assert.equal(r.reason, 'checksum_subprocess_failed');
  assert.match(r.stderr, /ERR_MODULE_NOT_FOUND/); assert.ok(r.detail.includes('checksum validator'));
});
test('JSON subprocess contract rejects nonzero, empty and malformed output', () => {
  for (const [r, reason] of [[{status:1,stdout:'{}',stderr:'diagnostic'},'subprocess_failed'],
    [{status:0,stdout:'',stderr:'empty diagnostic'},'empty_json_stdout'],
    [{status:0,stdout:'not json',stderr:'parse diagnostic'},'invalid_json_stdout']]) {
    assert.throws(() => parseProcessJson(r, 'fixture'), e => e.message.includes(reason) && e.message.includes(r.stderr));
  }
  assert.deepEqual(parseProcessJson({status:0,stdout:'{"ok":true}',stderr:''}, 'valid'), {ok:true});
});
test('main identity direct, relative, aliases and missing/unrelated arguments', () => {
  const url = pathToFileURL(path.join(root, 'cli/host.mjs'));
  assert.equal(isExecutedAsMain(url, fileURLToPath(url)), true);
  assert.equal(isExecutedAsMain(url, path.relative(process.cwd(), fileURLToPath(url))), true);
  assert.equal(isExecutedAsMain(url, path.join(alias, 'cli/host.mjs')), true);
  assert.equal(isExecutedAsMain(url, path.join(root, 'cli/task.mjs')), false);
  for (const arg of ['', null, undefined, path.join(base, 'missing.mjs')]) assert.equal(isExecutedAsMain(url, arg), false);
  if (process.platform === 'win32') {
    assert.equal(isExecutedAsMain(url, fileURLToPath(url).replace(/\\/g, '/')), true);
    assert.equal(isExecutedAsMain(url, fileURLToPath(url).toUpperCase()), true);
  }
});
test('host direct and directory-alias launch emit identical JSON exactly once', () => {
  const direct = parseProcessJson(run([path.join(root,'cli/host.mjs'),'list','--json']), 'direct');
  const linked = parseProcessJson(run([path.join(alias,'cli/host.mjs'),'list','--json']), 'alias');
  assert.deepEqual(linked, direct); assert.equal(direct.hosts.length, 3);
});
test('all executable CLIs preserve direct/alias output without duplicate execution', () => {
  for (const name of ['forgeos','inspect','plan','run','task','knowledge']) {
    const args = name === 'knowledge' ? ['--project',project,'--json'] : ['--help'];
    const a = run([path.join(root,`cli/${name}.mjs`),...args]);
    const b = run([path.join(alias,`cli/${name}.mjs`),...args]);
    assert.equal(a.status,0,`${name}: ${a.stderr}`); assert.equal(b.status,0,`${name}: ${b.stderr}`);
    assert.ok(a.stdout.trim(), name); assert.equal(b.stdout,a.stdout,name);
  }
});
test('all CLI library imports and unrelated wrapper stay silent', () => {
  const names = ['approve','forgeos','host','inspect','knowledge','main','plan','run','task'];
  const imports = names.map(n => `await import(${JSON.stringify(pathToFileURL(path.join(alias,`cli/${n}.mjs`)).href)});`).join('\n');
  const wrapper = path.join(base, 'wrapper.mjs');
  fs.writeFileSync(wrapper, imports+'\nconsole.log("IMPORT_ONLY");');
  const r = run([wrapper]); assert.equal(r.status,0,r.stderr); assert.equal(r.stdout.trim(),'IMPORT_ONLY');
});
test('POSIX file symlink invokes the physical CLI', {skip: process.platform === 'win32'}, () => {
  const link = path.join(base, 'host-link.mjs'); fs.symlinkSync(path.join(root,'cli/host.mjs'), link);
  assert.equal(parseProcessJson(run([link,'list','--json']), 'file symlink').ok,true);
});
