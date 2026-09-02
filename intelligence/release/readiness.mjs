/**
 * Release readiness assessment
 */
import fs from 'node:fs';
import path from 'node:path';

export function assessReleaseReadiness(projectDir, evidence = {}) {
  const blockers = [];
  const warnings = [];
  const ev = [];

  if (evidence.tests_passed === false) blockers.push('Tests failing');
  if (evidence.tests_passed === true) ev.push('tests: pass');

  if (evidence.build_passed === false) blockers.push('Build failing');
  if (evidence.build_passed === true) ev.push('build: pass');

  if (evidence.security_review === 'required' && !evidence.security_review_done) {
    blockers.push('Security review required but not completed');
  }
  if (evidence.security_review_done) ev.push('security: reviewed');

  if (evidence.migrations_pending) warnings.push('Pending migrations detected');
  if (evidence.docs_drift) warnings.push('Documentation drift detected');

  const migrationsDir = path.join(projectDir, 'supabase/migrations');
  if (fs.existsSync(migrationsDir) && evidence.migrations_reviewed !== true) {
    warnings.push('Database migrations exist — verify before release');
  }

  let status = 'READY';
  if (blockers.length) status = 'BLOCKED';
  else if (warnings.length) status = 'NOT_READY';

  return {
    release_readiness: {
      status,
      blockers,
      warnings,
      evidence: ev,
      assessed_at: new Date().toISOString(),
    },
  };
}
