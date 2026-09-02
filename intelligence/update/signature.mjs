/**
 * Release signature verification abstraction
 * Minimum documented mode: checksum-only when signing unavailable
 */
import { verifySha256 } from '../../scripts/security/checksum.mjs';

export function verifyReleaseSignature(manifest, options = {}) {
  const mode = options.signing_key ? 'signature' : 'checksum-only';

  if (options.signing_key && options.signature) {
    return {
      verified: false,
      mode: 'signature',
      reason: 'signature_verification_not_implemented',
      note: 'Provide signing infrastructure to enable full signature verification',
    };
  }

  const artifacts = manifest?.release?.artifacts || manifest?.artifacts || [];
  if (artifacts.length === 0) {
    return {
      verified: false,
      mode,
      reason: 'no_artifacts',
      checksum_only: true,
    };
  }

  const checksumResults = [];
  let allValid = true;
  for (const artifact of artifacts) {
    if (!artifact.sha256) {
      checksumResults.push({ name: artifact.name, valid: false, reason: 'missing_sha256' });
      allValid = false;
      continue;
    }
    if (options.artifact_path) {
      const result = verifySha256(options.artifact_path, artifact.sha256);
      checksumResults.push({ name: artifact.name, ...result });
      if (!result.valid) allValid = false;
    } else if (options.skip_file_check) {
      checksumResults.push({ name: artifact.name, valid: true, reason: 'manifest_only' });
    } else {
      checksumResults.push({ name: artifact.name, valid: false, reason: 'artifact_path_required' });
      allValid = false;
    }
  }

  return {
    verified: allValid,
    mode,
    checksum_only: mode === 'checksum-only',
    results: checksumResults,
    note: mode === 'checksum-only'
      ? 'Signature verification unavailable — checksum-only integrity applied'
      : undefined,
  };
}
