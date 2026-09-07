/** Narrow project-local file boundary. No symlink/junction traversal, even within root. */
import fs from 'node:fs';
import path from 'node:path';

export function projectRoot(dir) {
  const root = fs.realpathSync(dir);
  if (!fs.statSync(root).isDirectory()) throw new Error('workspace_missing');
  return root;
}
export function projectPath(dir, relative) {
  const root = projectRoot(dir);
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f:]/.test(relative)) throw new Error('unsafe_project_path');
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some(p => !p || p === '..' || p === '.' || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('unsafe_project_path');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('project_symlink_forbidden'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
export function readProjectText(dir, relative) {
  const file = projectPath(dir, relative);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('invalid_project_file');
  return fs.readFileSync(file, 'utf8');
}
export function writeProjectText(dir, relative, text, { createOnly = false } = {}) {
  const file = projectPath(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  projectPath(dir, relative);
  fs.writeFileSync(file, text, { encoding: 'utf8', flag: createOnly ? 'wx' : 'w' });
  return relative;
}
