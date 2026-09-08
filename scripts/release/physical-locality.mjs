/** Release validation only: existing physical containment, never authorization. */
import fs from 'node:fs';
import path from 'node:path';

export function isContainedRelative(relative, paths = path, allowRoot = false) {
  return (relative !== '' || allowRoot) && relative !== '..'
    && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}

export function checkPhysicalLocality(root, target, { realpath = fs.realpathSync } = {}) {
  const result = { ok: false, platform: process.platform, reason: 'REALPATH_ERROR',
    root_realpath: false, target_realpath: false };
  let canonicalRoot, canonicalTarget;
  try {
    canonicalRoot = realpath(root); result.root_realpath = true;
    canonicalTarget = realpath(target); result.target_realpath = true;
  } catch (error) {
    result.reason = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'BROKEN_PATH' : 'REALPATH_ERROR';
    result.error_code = /^[A-Z_]{1,40}$/.test(error.code || '') ? error.code : 'UNKNOWN';
    return result; // No lexical fallback; do not expose absolute paths or error messages.
  }
  const relative = path.relative(canonicalRoot, canonicalTarget);
  result.ok = isContainedRelative(relative);
  result.reason = result.ok
    ? (isContainedRelative(path.relative(path.resolve(root), path.resolve(target))) ? 'LOCAL' : 'TEXT_ALIAS')
    : 'EXTERNAL_DEPENDENCY';
  // Only a bounded status is public; callers cannot persist unrelated absolute paths.
  result.canonical_comparison = result.ok ? 'DESCENDANT' : (relative === '' ? 'EXACT_ROOT' : 'OUTSIDE');
  result.dependency_tree = result.ok && relative.split(path.sep)[0] === 'node_modules';
  return result;
}

export function assertParserLocality(root, target) {
  const result = checkPhysicalLocality(root, target);
  if (!result.ok || !result.dependency_tree) {
    if (result.ok) { result.ok = false; result.reason = 'OUTSIDE_DEPENDENCY_TREE'; }
    throw new Error(`parser_not_local_to_extracted_package:${JSON.stringify(result)}`);
  }
  return result;
}
