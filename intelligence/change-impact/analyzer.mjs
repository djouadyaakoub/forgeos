/**
 * Change impact analysis
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyStructureRisk } from '../risk.mjs';
import { resolveOwnership } from '../structure/analyzer.mjs';

export function analyzeChangeImpact(targetPath, projectDir, options = {}) {
  const ownership = options.ownership || [];
  const rel = targetPath.replace(/\\/g, '/');
  const owner = resolveOwnership(rel, ownership);
  const risk = classifyStructureRisk({
    from: rel,
    to: options.proposed_to || rel,
    reason: options.reason || '',
    imports_affected: options.imports_affected || 0,
    tests_affected: options.tests_affected || 0,
  });

  const affected = {
    paths: [rel],
    agents: owner ? [owner] : [],
    tests: [],
    docs: [],
    deployment: [],
  };

  if (/migration|schema/i.test(rel)) affected.deployment.push('database');
  if (/fly\.toml|wrangler\.toml/i.test(rel)) affected.deployment.push('hosting');
  if (/docs\//i.test(rel)) affected.docs.push(rel);
  if (/test|spec/i.test(rel)) affected.tests.push(rel);

  const dependents = options.dependents || [];
  const impactScore = Math.min(
    100,
    10 + (dependents.length * 5) + (options.imports_affected || 0) * 3 + (risk.level === 'CRITICAL' ? 40 : risk.level === 'HIGH' ? 25 : 0)
  );

  return {
    capability: 'change-impact',
    target: rel,
    impact_score: impactScore,
    affected_paths: [...new Set([...affected.paths, ...dependents])],
    affected_agents: affected.agents,
    affected_tests: affected.tests,
    affected_docs: affected.docs,
    deployment_impact: affected.deployment,
    risk_level: risk.level,
    requires_security_review: /auth|secret|tenant|ledger|migration|production/i.test(rel),
  };
}
