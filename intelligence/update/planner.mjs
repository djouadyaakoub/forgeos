/**
 * Compatibility classification for updates
 */
import { checkCompatibility, MIGRATION_MODES } from '../compatibility/adapter.mjs';
import { classifyVersionBump } from '../../policy/version.mjs';
import { loadProjectManifest } from '../../policy/project-adapter.mjs';

export function classifyProjectCompatibility(projectDir, options = {}) {
  const fromVersion = options.from_version || '1.0.0';
  const toVersion = options.to_version || '1.0.0';
  const bump = classifyVersionBump(fromVersion, toVersion);
  const compat = checkCompatibility(projectDir, { osVersion: toVersion, ...options });
  const { data: manifest } = loadProjectManifest(projectDir);

  let status = MIGRATION_MODES.AUTO_SAFE;
  const reasons = [];

  if (!compat.compatible) {
    status = MIGRATION_MODES.INCOMPATIBLE;
    reasons.push(compat.reason || 'incompatible');
  } else if (bump === 'MAJOR' || compat.migration_mode === MIGRATION_MODES.INCOMPATIBLE) {
    status = MIGRATION_MODES.REVIEW_REQUIRED;
    reasons.push('major_version_bump');
  } else if (compat.migration_required && compat.migration_mode === MIGRATION_MODES.REVIEW_REQUIRED) {
    status = MIGRATION_MODES.REVIEW_REQUIRED;
    reasons.push('adapter_migration_required');
  } else if (compat.missing_features?.length) {
    status = MIGRATION_MODES.MANUAL;
    reasons.push('missing_required_features');
  } else if (bump === 'MINOR' && compat.migration_required && compat.migration_mode !== MIGRATION_MODES.AUTO_SAFE) {
    status = MIGRATION_MODES.REVIEW_REQUIRED;
    reasons.push('minor_with_migration');
  } else if (bump === 'PATCH') {
    status = MIGRATION_MODES.AUTO_SAFE;
    reasons.push('patch_update');
  }

  return {
    compatibility: {
      current_os_version: fromVersion,
      target_os_version: toVersion,
      current_adapter_schema: compat.adapter_schema_version ?? manifest?.schema_version ?? 1,
      target_adapter_schema: options.target_adapter_schema ?? 1,
      status,
      reasons,
      migrations: compat.migration_required ? ['adapter_schema_update'] : [],
      project_id: manifest?.project?.id || null,
    },
    compat,
  };
}

export { MIGRATION_MODES };
