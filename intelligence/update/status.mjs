/**
 * Update status — read-only `agent-os update status`
 */
import { discoverUniversalOsUpdate, checkForUpdate } from './checker.mjs';
import { planUniversalUpdate } from './manager.mjs';
import { discoverInstalledProjects, getProjectDashboard } from '../registry/projects.mjs';
import { getCanonicalVersion, validateVersionSync } from '../../policy/version.mjs';
import { resolvePluginRoot } from '../../policy/plugin-root.mjs';
import { CLI_COMMANDS } from '../../policy/identity.mjs';
import { loadDistributionConfig } from '../../policy/distribution.mjs';
import { readUpdateCache } from './cache.mjs';

export async function getUpdateStatusAsync(options = {}) {
  const config = options.config || loadDistributionConfig(options.config_path);
  const discovery = options.local_only
    ? discoverUniversalOsUpdate(options)
    : await checkForUpdate({ ...options, config });
  return buildStatusResponse(discovery, options);
}

export function getUpdateStatus(options = {}) {
  const discovery = options.discovery || discoverUniversalOsUpdate(options);
  return buildStatusResponse(discovery, options);
}

function buildStatusResponse(discovery, options = {}) {
  const plan = planUniversalUpdate({ ...options, discovery });
  const projects = discoverInstalledProjects(options.registry_path);
  const dashboard = getProjectDashboard({
    registry_path: options.registry_path,
    target_version: discovery.latest?.version,
    from_version: discovery.installed?.version,
  });
  const versionSync = validateVersionSync();
  const cache = readUpdateCache(options.cache_path);

  let plugin = { root: null, source: 'not_found' };
  try {
    plugin = resolvePluginRoot({ skipDevFallback: options.installed_mode });
  } catch {
    plugin = resolvePluginRoot();
  }

  const affected = plan.universal_os_update.proposals.filter((p) => p.classification !== 'INCOMPATIBLE');
  const migrationsRequired = plan.universal_os_update.proposals.filter(
    (p) => p.migration_plan?.actions?.length > 0
  ).length;

  return {
    command: options.refresh ? `${CLI_COMMANDS.update_status} --refresh` : CLI_COMMANDS.update_status,
    installed_version: discovery.installed?.version || getCanonicalVersion(),
    latest_version: discovery.latest?.version || null,
    update_available: discovery.update_available,
    version_bump: discovery.version_bump,
    breaking: discovery.breaking,
    channel: discovery.channel || configChannel(options),
    remote_state: discovery.remote_state || (discovery.from_cache ? 'cached' : 'local'),
    security_status: discovery.security_update ? 'advisory' : 'none',
    security_update: discovery.security_update === true,
    canonical_version: versionSync.canonical,
    version_in_sync: versionSync.in_sync,
    last_checked: cache.last_checked,
    plugin: {
      root: plugin.root,
      source: plugin.source,
      mode: plugin.source === 'development_checkout' ? 'DEV' : plugin.root ? 'INSTALLED' : 'NOT_FOUND',
    },
    projects_registered: projects.length,
    projects_affected: affected.length,
    migrations_required: migrationsRequired,
    projects: dashboard,
    security_advisories: discovery.security_update ? ['security_advisory'] : [],
    mutates_anything: false,
    trust_model: {
      authenticity: 'configured_source_only',
      integrity: 'checksum_verified_on_install',
      compatibility: 'per_project_classification',
      policy: 'approval_required_for_review',
    },
  };
}

function configChannel(options) {
  try {
    return loadDistributionConfig(options.config_path).release_channel || 'stable';
  } catch {
    return 'stable';
  }
}
