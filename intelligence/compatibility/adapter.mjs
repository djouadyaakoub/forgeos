/**
 * Universal OS ↔ Project adapter compatibility and migration detection
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadGlobalRules, loadProjectManifest, getForgeOsBlock } from '../../policy/project-adapter.mjs';

import { getCanonicalVersion, CURRENT_ADAPTER_SCHEMA as ADAPTER_SCHEMA } from '../../policy/version.mjs';

export const MIGRATION_MODES = {
  AUTO_SAFE: 'AUTO_SAFE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  MANUAL: 'MANUAL',
  INCOMPATIBLE: 'INCOMPATIBLE',
};

const CURRENT_OS_VERSION = getCanonicalVersion();
const CURRENT_ADAPTER_SCHEMA = ADAPTER_SCHEMA;

function parseVersionRange(range) {
  if (!range || typeof range !== 'string') return { min: 1, maxMajor: 2 };
  const minMatch = range.match(/>=\s*([\d.]+)/);
  const maxMatch = range.match(/<\s*([\d.]+)/);
  const min = minMatch ? minMatch[1].split('.').map(Number)[0] : 1;
  const maxMajor = maxMatch ? maxMatch[1].split('.').map(Number)[0] : 99;
  return { min, maxMajor };
}

export function checkCompatibility(projectDir, options = {}) {
  const global = loadGlobalRules();
  const { data: manifest } = loadProjectManifest(projectDir);
  const osVersion = options.osVersion || global.agent_os_version || CURRENT_OS_VERSION;
  const adapterBlock = getForgeOsBlock(manifest) || manifest?.agent_os || {};

  const result = {
    project_path: projectDir,
    installed_agent_os_version: osVersion,
    adapter_schema_version: adapterBlock.adapter_schema_version ?? manifest?.schema_version ?? null,
    required_agent_os_version: adapterBlock.version || manifest?.agent_os_version || null,
    compatible: true,
    migration_required: false,
    migration_mode: null,
    missing_features: [],
    warnings: [],
  };

  if (!manifest) {
    result.compatible = true;
    result.reason = 'no_adapter';
    return result;
  }

  const [curMajor] = osVersion.split('.').map(Number);
  const required = result.required_agent_os_version;
  if (required) {
    const { min, maxMajor } = parseVersionRange(required);
    if (curMajor < min || curMajor >= maxMajor) {
      result.compatible = false;
      result.migration_mode = MIGRATION_MODES.INCOMPATIBLE;
      result.reason = 'agent_os_version_out_of_range';
      return result;
    }
  }

  const adapterSchema = result.adapter_schema_version;
  if (adapterSchema != null && adapterSchema < CURRENT_ADAPTER_SCHEMA) {
    result.migration_required = true;
    const autoMigrate = adapterBlock.compatibility?.auto_migrate === true;
    result.migration_mode = autoMigrate ? MIGRATION_MODES.AUTO_SAFE : MIGRATION_MODES.REVIEW_REQUIRED;
  }

  const requiredFeatures = adapterBlock.compatibility?.required_features || [];
  const available = options.availableFeatures || [
    'structure-audit', 'solution-research', 'change-impact', 'architecture-guard',
    'dependency-audit', 'dead-code-analysis', 'duplication-analysis',
    'documentation-drift', 'test-coverage-strategy', 'safe-refactor',
    'performance-investigation', 'knowledge-curation', 'project-archaeology',
    'release-readiness',
  ];
  for (const feat of requiredFeatures) {
    if (!available.includes(feat)) {
      result.missing_features.push(feat);
      result.compatible = false;
    }
  }

  if (result.missing_features.length) {
    result.migration_mode = MIGRATION_MODES.MANUAL;
  }

  return result;
}

export function planUniversalOsUpdate(projects = [], options = {}) {
  const newVersion = options.newVersion || CURRENT_OS_VERSION;
  const proposals = [];

  for (const p of projects) {
    const projectDir = typeof p === 'string' ? p : p.path;
    const compat = checkCompatibility(projectDir, { osVersion: newVersion });
    proposals.push({
      path: projectDir,
      status: compat.compatible
        ? compat.migration_required ? 'migration_available' : 'compatible'
        : 'incompatible',
      migration_mode: compat.migration_mode,
      migration_required: compat.migration_required,
      adapter_schema_version: compat.adapter_schema_version,
      auto_modify_project: false,
      protected_from_auto_update: [
        'architecture', 'contracts', 'adrs', 'business_rules', 'database_schema',
      ],
    });
  }

  return {
    universal_os_update: {
      from_version: options.fromVersion || CURRENT_OS_VERSION,
      to_version: newVersion,
      discovered_projects: proposals.length,
      proposals,
      auto_upgrade_business_knowledge: false,
    },
  };
}

export { CURRENT_OS_VERSION, CURRENT_ADAPTER_SCHEMA };
