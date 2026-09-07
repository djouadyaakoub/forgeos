/** Stage 22: framework enforcer liveness, not task authorization or verification. */
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintText } from '../../intelligence/assessment/facts.mjs';

export const INVARIANT_MANIFEST = 'scripts/release/invariants.json';
export const INVARIANT_CAPABILITY = Object.freeze({
  capability_id: 'invariant-enforcer-registry',
  implementation_kind: 'FORGEOS_NATIVE',
  execution_mode: 'forgeos_native',
  launches_external_runtime: false,
  requires_docker: false,
  requires_llm: false,
});

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

// Validate lexical AND real paths, including Windows junctions/symlinks.
function resolveFile(root, reference) {
  if (typeof reference !== 'string' || !reference.trim()
    || /[\x00-\x1f:]/.test(reference)) return { error: 'invalid_path' };
  const normalized = reference.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return { error: 'absolute_path' };
  }
  const rel = path.posix.normalize(normalized);
  const target = path.resolve(root, rel);
  if (!inside(root, target)) return { error: 'path_escape' };
  // Resolve existing ancestors as well: an outside junction with a missing leaf
  // must not become an ordinary missing-file diagnostic.
  let ancestor = target;
  while (!fs.existsSync(ancestor) && ancestor !== root) ancestor = path.dirname(ancestor);
  if (!inside(root, fs.realpathSync(ancestor))) return { error: 'path_escape' };
  try {
    const real = fs.realpathSync(target);
    if (!inside(root, real)) return { error: 'path_escape' };
    if (!fs.statSync(real).isFile()) return { error: 'not_file', path: rel };
    return { path: rel, real };
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'missing_file' : 'unreadable_file', path: rel };
  }
}

export function validateInvariantRegistry(repositoryRoot, options = {}) {
  const missing_enforcers = [];
  const invalid_records = [];
  const duplicates = new Set();
  const ids = new Set();
  const records = [];
  let manifestState = 'valid';
  const invalid = (id, reason, reference = null) => invalid_records.push({ id, reason, reference });
  try {
    const root = fs.realpathSync(repositoryRoot);
    const source = resolveFile(root, options.manifest_path ?? INVARIANT_MANIFEST);
    if (source.error) {
      manifestState = source.error;
      invalid(null, `manifest_${source.error}`);
    } else {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(source.real, 'utf8')); }
      catch { invalid(null, 'manifest_invalid_json'); manifestState = 'invalid_json'; }
      if (manifestState === 'valid') {
        if (!object(manifest) || manifest.schema_version !== 1
          || !Array.isArray(manifest.invariants) || manifest.invariants.length === 0
          || Object.keys(manifest).some((k) => !['schema_version', 'invariants'].includes(k))) {
          invalid(null, 'invalid_manifest');
        } else {
          for (const entry of manifest.invariants) {
            if (!object(entry) || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
              invalid(null, 'invalid_invariant_id');
              continue;
            }
            const id = entry.id;
            if (ids.has(id)) duplicates.add(id);
            ids.add(id);
            if (typeof entry.description !== 'string' || !entry.description.trim()
              || !Array.isArray(entry.enforcers) || entry.enforcers.length === 0
              || Object.keys(entry).some((k) => !['id', 'description', 'enforcers'].includes(k))) {
              invalid(id, 'invalid_record');
              continue;
            }
            const checked = [];
            for (const ref of entry.enforcers) {
              const result = resolveFile(root, ref);
              if (result.error) {
                if (result.error === 'missing_file') missing_enforcers.push({ id, path: result.path });
                else invalid(id, result.error, typeof ref === 'string' ? ref : null);
                checked.push({ path: result.path || null, status: result.error });
              } else {
                // Hash bytes via base64 using the existing ForgeOS fingerprint convention.
                checked.push({ path: result.path, status: 'live',
                  content_fingerprint: fingerprintText(fs.readFileSync(result.real).toString('base64')) });
              }
            }
            records.push({ id, description: entry.description.trim(),
              enforcers: [...new Map(checked.map((r) => [JSON.stringify(r), r])).values()]
                .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) });
          }
        }
      }
    }
  } catch {
    invalid(null, 'repository_or_enforcer_unreadable');
  }
  const sortRecords = (a, b) => compare(JSON.stringify(a), JSON.stringify(b));
  missing_enforcers.sort(sortRecords);
  invalid_records.sort(sortRecords);
  records.sort(sortRecords);
  const duplicate_invariant_ids = [...duplicates].sort();
  const checked_invariant_ids = [...ids].sort();
  return {
    ...INVARIANT_CAPABILITY,
    valid: !missing_enforcers.length && !invalid_records.length && !duplicates.size,
    checked_invariant_ids, missing_enforcers, duplicate_invariant_ids, invalid_records,
    checked_enforcers: records,
    fingerprint: fingerprintText(JSON.stringify({ schema_version: 1, manifestState,
      records, checked_invariant_ids, missing_enforcers, duplicate_invariant_ids, invalid_records })),
    semantics: 'Declared file liveness only; does not prove behavioral correctness',
  };
}

/** Canonical release check shape; callable without running release side effects. */
export function checkInvariantRegistry(repositoryRoot, options = {}) {
  const details = validateInvariantRegistry(repositoryRoot, options);
  return { check: 'invariant_enforcer_registry', status: details.valid ? 'pass' : 'fail', details };
}
