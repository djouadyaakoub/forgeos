/**
 * Dependency audit — generic manifest scanning
 */
import fs from 'node:fs';
import path from 'node:path';

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function findManifests(projectDir) {
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && (e.name === 'package.json' || e.name === 'go.mod')) {
        found.push(path.relative(projectDir, full).replace(/\\/g, '/'));
      }
      if (e.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(projectDir);
  return found;
}

export function auditDependencies(projectDir) {
  const manifests = findManifests(projectDir);
  const deps = new Map();
  const issues = [];

  for (const rel of manifests) {
    const full = path.join(projectDir, rel);
    if (rel.endsWith('package.json')) {
      const pkg = readJsonSafe(full);
      if (!pkg) continue;
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, ver] of Object.entries(all || {})) {
        if (!deps.has(name)) deps.set(name, []);
        deps.get(name).push({ manifest: rel, version: ver });
      }
    }
    if (rel.endsWith('go.mod')) {
      const content = fs.readFileSync(full, 'utf8');
      const requires = [...content.matchAll(/^\s+(\S+)\s+(\S+)/gm)];
      for (const [, name, ver] of requires) {
        if (!deps.has(name)) deps.set(name, []);
        deps.get(name).push({ manifest: rel, version: ver });
      }
    }
  }

  for (const [name, entries] of deps) {
    if (entries.length > 1) {
      const versions = new Set(entries.map((e) => e.version));
      if (versions.size > 1) {
        issues.push({
          type: 'version_conflict',
          dependency: name,
          entries,
          severity: 'medium',
        });
      }
    }
    if (/password|secret|crypto-miner|eval/i.test(name)) {
      issues.push({ type: 'security_sensitive', dependency: name, severity: 'high' });
    }
  }

  return {
    capability: 'dependency-audit',
    manifest_count: manifests.length,
    unique_dependencies: deps.size,
    issues,
    duplicate_libraries: issues.filter((i) => i.type === 'version_conflict'),
    security_sensitive: issues.filter((i) => i.type === 'security_sensitive'),
    removal_requires_impact_analysis: true,
  };
}
