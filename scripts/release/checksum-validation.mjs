import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseProcessJson } from './process-json.mjs';

export function checkReleaseChecksums(root, options = {}) {
  const fail = (reason, detail = {}) => ({ check: 'checksums_manifest', status: 'fail', reason, ...detail });
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'release/checksums.json'), 'utf8')); }
  catch (e) { return fail('unreadable_checksum_manifest', { detail: e.message }); }
  const archive = Array.isArray(manifest?.artifacts) && manifest.artifacts.find(a => typeof a?.name === 'string' && a.name.endsWith('.zip'));
  if (!archive) return fail('no_archive_entry');
  if (path.basename(archive.name) !== archive.name) return fail('invalid_archive_name');
  if (typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(archive.sha256)) return fail('malformed_checksum');
  const archivePath = path.join(root, 'release', archive.name);
  if (!fs.existsSync(archivePath)) return fail('archive_not_found');
  // Explicit ESM on every supported Node version. Values travel as argv, never inline code.
  const code = 'const {verifySha256}=await import(process.argv[1]); const r=verifySha256(process.argv[2],process.argv[3]); console.log(JSON.stringify(r)); process.exitCode=r.valid?0:1;';
  const moduleUrl = options.moduleUrl || new URL('../security/checksum.mjs', import.meta.url).href;
  const args = ['--input-type=module', '-e', code, moduleUrl, archivePath, archive.sha256];
  const child = spawnSync(options.nodePath || process.execPath, args, { cwd: root, encoding: 'utf8' });
  const detail = { exit_code: child.status, stderr: child.stderr || '', stdout: child.stdout || '' };
  try {
    const result = parseProcessJson(child, 'checksum validator', child.status === 1 ? 1 : 0);
    if (child.status !== 0 || result.valid !== true) return fail(result.reason || 'checksum_validation_failed', { ...detail, result });
    return { check: 'checksums_manifest', status: 'pass', ...detail, result };
  } catch (e) { return fail('checksum_subprocess_failed', { ...detail, detail: e.message }); }
}
