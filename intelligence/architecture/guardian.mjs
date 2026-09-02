/**
 * Architecture Guardian — layer boundary violations
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LAYERS = ['ui', 'service', 'repository', 'db'];

const VIOLATION_PATTERNS = [
  { from: /\/(pages|components|ui)\//i, to: /\/(db|migrations|store)\//i, rule: 'UI must not import DB layer directly' },
  { from: /\/web\//i, to: /supabase\/migrations/i, rule: 'Frontend must not reference migration files' },
  { from: /\/app\//i, to: /internal\/store/i, rule: 'UI app must not import store internals directly' },
];

export function loadArchitectureContext(projectDir, knowledge = {}) {
  const ctx = { layers: [...DEFAULT_LAYERS], rules: [], docs: [] };
  const archPath = knowledge.architecture ? path.join(projectDir, knowledge.architecture) : path.join(projectDir, 'docs/architecture');
  if (fs.existsSync(archPath)) {
    ctx.docs.push(archPath);
  }
  const adrPath = knowledge.adr ? path.join(projectDir, knowledge.adr) : path.join(projectDir, 'docs/adr');
  if (fs.existsSync(adrPath)) {
    ctx.docs.push(adrPath);
  }
  return ctx;
}

export function checkImportViolation(filePath, importPath, customRules = []) {
  const violations = [];
  const rules = [...VIOLATION_PATTERNS, ...customRules];
  for (const r of rules) {
    if (r.from.test(filePath) && r.to.test(importPath)) {
      violations.push({
        type: 'architecture_violation',
        file: filePath,
        import: importPath,
        rule: r.rule,
        severity: 'high',
      });
    }
  }
  return violations;
}

export function architectureGuard(projectDir, options = {}) {
  const knowledge = options.knowledge || {};
  const ctx = loadArchitectureContext(projectDir, knowledge);
  const violations = [];
  const proposedChanges = options.proposed_changes || [];

  for (const change of proposedChanges) {
    const from = String(change.from || '');
    const to = String(change.to || '');
    for (const r of VIOLATION_PATTERNS) {
      if (r.from.test(from) && r.to.test(to)) {
        violations.push({
          type: 'proposed_boundary_violation',
          change,
          rule: r.rule,
        });
      }
    }
  }

  return {
    capability: 'architecture-guard',
    layers: ctx.layers,
    architecture_docs: ctx.docs.map((d) => path.relative(projectDir, d).replace(/\\/g, '/')),
    violations,
    status: violations.length ? 'VIOLATIONS_FOUND' : 'PASS',
  };
}
