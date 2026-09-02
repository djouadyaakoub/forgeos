/**
 * Test coverage strategy — beyond pass/fail
 */
import fs from 'node:fs';
import path from 'node:path';

export function analyzeTestStrategy(projectDir, changedPaths = []) {
  const recommendations = [];
  for (const p of changedPaths) {
    const rel = p.replace(/\\/g, '/');
    const ext = path.extname(rel).toLowerCase();
    const isCode = ['.go', '.ts', '.tsx', '.js', '.jsx', '.dart'].includes(ext);
    if (!isCode || rel.includes('.test.') || rel.includes('.spec.')) continue;

    const dir = path.dirname(rel);
    const base = path.basename(rel, ext);
    const candidates = [
      `${dir}/${base}.test${ext}`,
      `${dir}/${base}.spec${ext}`,
      `${dir}/__tests__/${base}${ext}`,
    ];
    const hasTest = candidates.some((c) => fs.existsSync(path.join(projectDir, c)));

    recommendations.push({
      affected_behavior: rel,
      current_coverage: hasTest ? 'partial' : 'none_detected',
      missing_tests: hasTest ? [] : candidates,
      recommended_tests: hasTest ? ['extend_existing'] : ['unit_test_for_changed_behavior'],
      verification_priority: /auth|ledger|payment|tenant/i.test(rel) ? 'critical' : 'normal',
    });
  }

  return {
    capability: 'test-coverage-strategy',
    changed_paths: changedPaths,
    recommendations,
    summary: {
      paths_without_detected_tests: recommendations.filter((r) => r.current_coverage === 'none_detected').length,
    },
  };
}
