/**
 * Artifact verification before deployment
 */
export function verifyArtifacts(buildEvidence = {}, context = {}) {
  const artifacts = buildEvidence.build_evidence?.artifacts || buildEvidence.artifacts || [];
  const issues = [];

  if (!artifacts.length && context.build_required !== false) {
    issues.push({ type: 'missing_artifact', message: 'No artifacts produced' });
  }

  for (const art of artifacts) {
    if (!art.path) issues.push({ type: 'invalid_artifact', message: 'Artifact missing path' });
    if (context.require_checksum && !art.checksum && !art.verified) {
      issues.push({ type: 'missing_checksum', path: art.path });
    }
    if (art.revision && context.expected_revision && art.revision !== context.expected_revision) {
      issues.push({ type: 'revision_mismatch', expected: context.expected_revision, got: art.revision });
    }
  }

  if (context.build_failed || buildEvidence.status === 'BUILD_FAILED') {
    issues.push({ type: 'build_failed', message: 'Build did not complete successfully' });
  }

  if (context.tests_passed === false) {
    issues.push({ type: 'tests_failed', message: 'Tests did not pass before deployment' });
  }

  return {
    capability: 'artifact-verification',
    valid: issues.length === 0,
    issues,
    artifacts_checked: artifacts.length,
  };
}
