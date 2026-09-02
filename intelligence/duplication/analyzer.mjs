/**
 * Duplication analysis — heuristic duplicate detection
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { walkProject } from '../structure/analyzer.mjs';

function fileHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

export function analyzeDuplication(projectDir, options = {}) {
  const { files } = walkProject(projectDir, { ...options, maxFiles: 2000 });
  const byHash = new Map();
  const byBasename = new Map();

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!['.go', '.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;
    const full = path.join(projectDir, f);
    let content = '';
    try {
      const stat = fs.statSync(full);
      if (stat.size > 50000) continue;
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const h = fileHash(content);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);

    const base = path.basename(f);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(f);
  }

  const exactDuplicates = [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([hash, paths]) => ({ type: 'exact_duplicate', hash, paths, severity: 'high' }));

  const nameDuplicates = [...byBasename.entries()]
    .filter(([, paths]) => paths.length > 1 && paths.every((p) => path.basename(p) === path.basename(paths[0])))
    .filter(([, paths]) => new Set(paths.map((p) => path.dirname(p))).size > 1)
    .map(([name, paths]) => ({ type: 'duplicate_filename', name, paths, severity: 'medium' }));

  return {
    capability: 'duplication-analysis',
    exact_duplicates: exactDuplicates,
    duplicate_filenames: nameDuplicates,
    consolidation_proposals: exactDuplicates.map((d) => ({
      action: 'consolidate',
      paths: d.paths,
      requires_behavior_verification: true,
      auto_merge: false,
    })),
  };
}
