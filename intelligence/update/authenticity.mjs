/**
 * Source authenticity — reject arbitrary owner/repo/branch
 */
import { loadDistributionConfig } from '../../policy/distribution.mjs';

export function verifySourceAuthenticity(config, release, options = {}) {
  const cfg = config || loadDistributionConfig(options.config_path);
  const source = cfg.source || {};
  const issues = [];

  if (release.owner && source.owner && release.owner !== source.owner) {
    issues.push({ check: 'owner', expected: source.owner, got: release.owner });
  }
  if (release.repository && source.repository && release.repository !== source.repository) {
    issues.push({ check: 'repository', expected: source.repository, got: release.repository });
  }
  if (release.plugin_id && source.plugin_id && release.plugin_id !== source.plugin_id) {
    issues.push({ check: 'plugin_id', expected: source.plugin_id, got: release.plugin_id });
  }

  const manifest = release.release_manifest || release.manifest;
  if (manifest?.plugin_id && source.plugin_id && manifest.plugin_id !== source.plugin_id) {
    issues.push({ check: 'manifest_plugin_id', expected: source.plugin_id, got: manifest.plugin_id });
  }

  if (options.reject_branch && release.source_type === 'branch') {
    issues.push({ check: 'source_type', reason: 'branch_not_trusted' });
  }

  const authentic = issues.length === 0;
  return {
    authentic,
    blocked: !authentic,
    issues,
    trust_model: {
      authenticity: authentic ? 'verified' : 'rejected',
      note: 'Arbitrary owner/repository/branch releases are not accepted',
    },
  };
}

export function validateReleaseManifest(manifest, options = {}) {
  const rel = manifest?.release || manifest;
  const issues = [];
  if (!rel?.version) issues.push('missing_version');
  if (!rel?.plugin_id) issues.push('missing_plugin_id');
  const minSchema = rel?.adapter?.min_schema ?? rel?.min_adapter_schema_version;
  if (minSchema == null) issues.push('missing_adapter_schema');
  if (options.expected_version && rel?.version !== options.expected_version) {
    issues.push('version_mismatch');
  }
  return {
    valid: issues.length === 0,
    blocked: issues.length > 0,
    issues,
    manifest: rel,
  };
}
