/**
 * Update discovery — local + remote GitHub with cache and rate limiting
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanonicalVersion, compareSemver, classifyVersionBump } from '../../policy/version.mjs';
import { getInstallManifestPath } from '../../policy/plugin-root.mjs';
import { loadDistributionConfig } from '../../policy/distribution.mjs';
import { discoverLatestGithubRelease } from './github.mjs';
import { shouldRefreshCache, readUpdateCache, updateCacheEntry } from './cache.mjs';
import { verifySourceAuthenticity } from './authenticity.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function readReleaseManifest(manifestPath) {
  const local = manifestPath || path.join(REPO_ROOT, 'release', 'release-manifest.json');
  if (!fs.existsSync(local)) return null;
  try {
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  } catch {
    return null;
  }
}

export function getInstalledVersionSync() {
  const manifestPath = getInstallManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return { version: null, source: 'not_installed' };
  }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { version: data.version ?? null, source: 'user_install_manifest', installed_at: data.installed_at };
  } catch {
    return { version: null, source: 'corrupt_install_manifest' };
  }
}

export function buildDiscoveryResult(installed, latestInfo, options = {}) {
  const installedVersion = installed.version ?? options.installed_version ?? getCanonicalVersion();
  const latestVersion = latestInfo.version ?? getCanonicalVersion();
  const latestManifest = latestInfo.manifest || latestInfo.release_manifest;
  const cmp = compareSemver(installedVersion, latestVersion);
  const updateAvailable = cmp < 0;
  const bump = classifyVersionBump(installedVersion, latestVersion);
  const securityAdvisory = latestManifest?.security?.advisory === true;

  return {
    capability: 'update-discovery',
    installed: {
      version: installedVersion,
      source: installed.source,
    },
    latest: {
      version: latestVersion,
      source: latestInfo.source || 'release_manifest',
      manifest: latestManifest,
      tag: latestInfo.tag,
      published_at: latestInfo.published_at,
      release_url: latestInfo.release_url,
    },
    update_available: updateAvailable,
    version_bump: bump,
    channel: latestInfo.channel || options.channel || 'stable',
    adapter_requirements: {
      min_adapter_schema_version: latestManifest?.adapter?.min_schema
        ?? latestManifest?.min_adapter_schema_version ?? 1,
      required_features: latestManifest?.required_features || [],
    },
    breaking: latestManifest?.breaking === true || bump === 'MAJOR',
    security_update: securityAdvisory,
    security_review: latestManifest?.security?.requires_manual_review === true || securityAdvisory,
    security_severity: latestManifest?.security?.severity || (securityAdvisory ? 'HIGH' : null),
    from_cache: options.from_cache === true,
    remote_state: latestInfo.remote_state || null,
    update_status: {
      installed: installedVersion,
      latest: latestVersion,
      update_available: updateAvailable,
      channel: latestInfo.channel || 'stable',
      security_update: securityAdvisory,
    },
  };
}

export function discoverUniversalOsUpdate(options = {}) {
  const installed = getInstalledVersionSync();
  const latestManifest = options.release_manifest || readReleaseManifest(options.manifest_path);
  const latestVersion = options.latest_version ?? latestManifest?.release?.version ?? getCanonicalVersion();

  return buildDiscoveryResult(installed, {
    version: latestVersion,
    manifest: latestManifest?.release || null,
    source: latestManifest ? 'release_manifest' : 'canonical',
  }, options);
}

export async function discoverUniversalOsUpdateRemote(options = {}) {
  const config = options.config || loadDistributionConfig(options.config_path);
  const installed = getInstalledVersionSync();

  if (!shouldRefreshCache(config, options) && !options.force_check && !options.refresh) {
    const cache = readUpdateCache(options.cache_path);
    if (cache.last_known_release?.version) {
      return buildDiscoveryResult(installed, {
        version: cache.last_known_release.version,
        tag: cache.last_known_release.tag,
        channel: cache.last_known_release.channel,
        source: 'cache',
        remote_state: 'cached',
      }, { ...options, from_cache: true });
    }
  }

  if (options.manifest_path && !options.fixture_path) {
    return discoverUniversalOsUpdate(options);
  }

  const remote = await discoverLatestGithubRelease(config, options);
  if (!remote.found) {
    if (remote.reason === 'remote_unavailable' || remote.state === 'UNKNOWN') {
      return {
        ...discoverUniversalOsUpdate(options),
        remote_state: 'UNKNOWN',
        status: { state: 'UNKNOWN', reason: 'remote_unavailable' },
        update_status: {
          installed: installed.version || getCanonicalVersion(),
          latest: null,
          update_available: false,
          channel: config.release_channel,
          security_update: false,
          state: 'UNKNOWN',
          reason: 'remote_unavailable',
        },
      };
    }
    return discoverUniversalOsUpdate(options);
  }

  const auth = verifySourceAuthenticity(config, remote, options);
  if (!auth.authentic) {
    return {
      capability: 'update-discovery',
      blocked: true,
      reason: 'source_not_authentic',
      issues: auth.issues,
      remote_state: 'BLOCKED',
    };
  }

  updateCacheEntry(remote, options);
  return buildDiscoveryResult(installed, {
    version: remote.version,
    manifest: remote.release_manifest,
    tag: remote.tag,
    published_at: remote.published_at,
    release_url: remote.release_url,
    channel: remote.channel,
    source: remote.source || 'github',
  }, options);
}

export async function checkForUpdate(options = {}) {
  const config = options.config || loadDistributionConfig(options.config_path);
  if (config.update?.enabled === false) {
    return discoverUniversalOsUpdate(options);
  }
  if (options.local_only) {
    return discoverUniversalOsUpdate(options);
  }
  return discoverUniversalOsUpdateRemote(options);
}
