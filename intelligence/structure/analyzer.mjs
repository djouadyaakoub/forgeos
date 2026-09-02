/**
 * Codebase structure analysis — generic heuristics, project-knowledge aware
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', '__pycache__',
]);

const ROOT_FILE_PATTERNS = [
  { pattern: /\.go$/, suggested: 'internal/' },
  { pattern: /\.tsx?$/, suggested: 'src/' },
  { pattern: /\.jsx?$/, suggested: 'src/' },
];

export function walkProject(root, options = {}) {
  const maxFiles = options.maxFiles || 5000;
  const files = [];
  const dirs = new Set();

  function walk(dir, depth = 0) {
    if (depth > 12 || files.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (e.isDirectory()) {
        dirs.add(rel);
        walk(full, depth + 1);
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  }

  walk(root);
  return { files, dirs: [...dirs] };
}

export function detectMisplacedFiles(files, conventions = {}) {
  const issues = [];
  for (const f of files) {
    const base = path.basename(f);
    const dir = path.dirname(f).replace(/\\/g, '/');
    if (dir === '.' || dir === '') {
      for (const { pattern, suggested } of ROOT_FILE_PATTERNS) {
        if (pattern.test(base) && !base.startsWith('main.')) {
          issues.push({
            type: 'misplaced_file',
            path: f,
            reason: `Source file at repository root; consider ${suggested}`,
            severity: 'medium',
          });
        }
      }
      if (/\.(test|spec)\./i.test(base)) {
        issues.push({ type: 'misplaced_test', path: f, reason: 'Test file at root', severity: 'low' });
      }
    }
    if (conventions.forbidden_root_files?.includes(base)) {
      issues.push({ type: 'convention_violation', path: f, reason: 'Forbidden at root per project conventions', severity: 'high' });
    }
  }
  return issues;
}

export function detectMixedResponsibilityDirs(files) {
  const byDir = new Map();
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length < 2) continue;
    const top = parts[0];
    const ext = path.extname(f).toLowerCase();
    if (!byDir.has(top)) byDir.set(top, new Set());
    byDir.get(top).add(ext);
  }
  const issues = [];
  for (const [dir, exts] of byDir) {
    const hasGo = exts.has('.go');
    const hasTs = exts.has('.ts') || exts.has('.tsx');
    const hasDart = exts.has('.dart');
    const kinds = [hasGo, hasTs, hasDart].filter(Boolean).length;
    if (kinds >= 2 && !['docs', 'scripts', 'tools'].includes(dir)) {
      issues.push({
        type: 'mixed_stack_directory',
        path: dir,
        extensions: [...exts],
        reason: 'Directory mixes multiple language ecosystems',
        severity: 'medium',
      });
    }
  }
  return issues;
}

export function detectOversizedModules(files, threshold = 80) {
  const byDir = new Map();
  for (const f of files) {
    const d = path.dirname(f).replace(/\\/g, '/');
    byDir.set(d, (byDir.get(d) || 0) + 1);
  }
  return [...byDir.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([dir, count]) => ({
      type: 'oversized_module',
      path: dir,
      file_count: count,
      reason: `Directory has ${count} files (threshold ${threshold})`,
      severity: 'medium',
    }));
}

export function detectOrphanCandidates(files) {
  const codeExts = new Set(['.go', '.ts', '.tsx', '.js', '.jsx', '.py', '.dart']);
  return files
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      if (!codeExts.has(ext)) return false;
      const base = path.basename(f).toLowerCase();
      return base.includes('orphan') || base.includes('deprecated') || base.includes('old_');
    })
    .map((f) => ({
      type: 'orphan_candidate',
      path: f,
      reason: 'Filename suggests orphan/deprecated content',
      severity: 'low',
      confidence: 0.6,
    }));
}

export function resolveOwnership(filePath, ownershipRules = []) {
  for (const rule of ownershipRules) {
    const patterns = rule.paths || rule.writable || [];
    for (const p of patterns) {
      const regex = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      if (new RegExp(`^${regex}$`, 'i').test(filePath.replace(/\\/g, '/'))) {
        return rule.agent;
      }
    }
  }
  return null;
}

export function analyzeStructure(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const { files, dirs } = walkProject(root, options);
  const ownership = options.ownership || [];
  const conventions = options.conventions || {};

  const misplaced = detectMisplacedFiles(files, conventions);
  const mixed = detectMixedResponsibilityDirs(files);
  const oversized = detectOversizedModules(files, options.oversizedThreshold);
  const orphans = detectOrphanCandidates(files);

  const unclearOwnership = dirs
    .filter((d) => d.split('/').length <= 2)
    .filter((d) => !resolveOwnership(`${d}/`, ownership) && !['docs', 'scripts', '.github'].includes(d.split('/')[0]))
    .slice(0, 20)
    .map((d) => ({
      type: 'unclear_ownership',
      path: d,
      reason: 'No agent ownership mapping for top-level area',
      severity: 'low',
    }));

  const issues = [...misplaced, ...mixed, ...oversized, ...orphans, ...unclearOwnership];
  const health = Math.max(0, 100 - issues.filter((i) => i.severity === 'high').length * 15
    - issues.filter((i) => i.severity === 'medium').length * 5
    - issues.filter((i) => i.severity === 'low').length * 1);

  return {
    project: path.basename(root),
    file_count: files.length,
    directory_count: dirs.length,
    health_score: health,
    structure_issues: issues,
    misplaced_files: misplaced,
    mixed_responsibilities: mixed,
    duplicate_structure: [],
    recommended_actions: issues.slice(0, 10).map((i) => ({
      action: i.type === 'misplaced_file' ? 'move' : 'review',
      path: i.path,
      reason: i.reason,
      risk: i.severity === 'high' ? 'HIGH' : i.severity === 'medium' ? 'MEDIUM' : 'LOW',
    })),
  };
}

export function structureAudit(projectDir, options = {}) {
  const analysis = analyzeStructure(projectDir, options);
  return {
    capability: 'structure-audit',
    health_score: analysis.health_score,
    structure_issues: analysis.structure_issues,
    misplaced_files: analysis.misplaced_files,
    mixed_responsibilities: analysis.mixed_responsibilities,
    duplicate_structure: analysis.duplicate_structure,
    recommended_actions: analysis.recommended_actions,
    risk: analysis.health_score >= 80 ? 'LOW' : analysis.health_score >= 60 ? 'MEDIUM' : 'HIGH',
  };
}
