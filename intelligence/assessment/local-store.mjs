/** Bounded local metadata, serialized writers and atomic replacement. Not an authentication boundary. */
import fs from 'node:fs';
import path from 'node:path';
import { projectPath, readProjectText } from '../../host/project-files.mjs';
export function safeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) throw new Error('invalid_id');
  return value;
}
export function compactText(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error('invalid_compact_text');
  if (/PRIVATE KEY|\b(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}|```|<think>|chain.of.thought/i.test(value)
    || (value.match(/^(?:user|assistant|system):/gmi) || []).length > 1) throw new Error('unsafe_knowledge_content');
  return value.trim();
}
export function readLocalStore(root, relative) {
  const raw = readProjectText(root, relative);
  const rows = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 256) throw new Error('invalid_local_store');
  return rows;
}
export function updateLocalStore(root, relative, update) {
  const target = projectPath(root, relative), lock = projectPath(root, relative + '.lock');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  projectPath(root, relative);
  const fd = fs.openSync(lock, 'wx');
  const temporary = relative + '.pending';
  let created = false;
  try {
    const rows = update(readLocalStore(root, relative));
    const serialized = JSON.stringify(rows, null, 2) + '\n';
    if (rows.length > 256 || Buffer.byteLength(serialized) > 1048576) throw new Error('local_store_limit');
    fs.writeFileSync(projectPath(root, temporary), serialized, { flag: 'wx' }); created = true;
    fs.renameSync(projectPath(root, temporary), projectPath(root, relative));
    created = false;
    return rows;
  } finally {
    fs.closeSync(fd);
    if (created) fs.unlinkSync(projectPath(root, temporary));
    fs.unlinkSync(projectPath(root, relative + '.lock'));
  }
}
