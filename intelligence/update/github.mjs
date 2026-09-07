/**
 * GitHub release discovery — stable/beta/alpha channels
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDistributionConfig } from '../../policy/distribution.mjs';
import { validateReleaseManifest } from './authenticity.mjs';
import { compareSemver, parseSemver } from '../../policy/version.mjs';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// GitHub tags permit exactly one lowercase v; internal versions remain strict SemVer.
function releaseVersion(raw) {
  const tag = raw.tag_name || raw.tag;
  return typeof tag === 'string' ? tag.replace(/^v/, '') : tag ?? raw.version;
}

function parseChannel(release, channel = 'stable') {
  const tag = release.tag_name || release.tag || '';
  const prerelease = release.prerelease === true;
  if (channel === 'stable') {
    if (prerelease) return null;
    if (/-alpha|-beta|rc/i.test(tag)) return null;
    return 'stable';
  }
  if (channel === 'beta' && /-beta|rc/i.test(tag)) return 'beta';
  if (channel === 'alpha' && /-alpha/i.test(tag)) return 'alpha';
  return prerelease ? 'prerelease' : 'stable';
}

function normalizeRelease(raw, config, options = {}) {
  const manifestAsset = (raw.assets || []).find((a) =>
    /release-manifest\.json$/i.test(a.name)
  );
  let release_manifest = raw.release_manifest || null;
  if (!release_manifest && raw.manifest) release_manifest = raw.manifest;
  if (!release_manifest && raw.local_manifest_path) {
    const repoRoot = options.repo_root || REPO_ROOT;
    const manifestPath = path.isAbsolute(raw.local_manifest_path)
      ? raw.local_manifest_path
      : path.join(repoRoot, raw.local_manifest_path);
    if (fs.existsSync(manifestPath)) {
      release_manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  }

  return {
    version: releaseVersion(raw),
    tag: raw.tag_name || raw.tag,
    published_at: raw.published_at || raw.publishedAt || null,
    release_url: raw.html_url || raw.release_url || null,
    assets: (raw.assets || []).map((a) => ({
      name: a.name,
      url: a.browser_download_url || a.url,
      size: a.size,
      content_type: a.content_type,
    })),
    release_manifest: release_manifest?.release || release_manifest,
    channel: raw.channel || parseChannel(raw, config?.release_channel || 'stable'),
    prerelease: raw.prerelease === true,
    owner: raw.owner || config?.source?.owner,
    repository: raw.repository || config?.source?.repository,
    plugin_id: release_manifest?.release?.plugin_id || release_manifest?.plugin_id || config?.source?.plugin_id,
    source_type: 'github_release',
  };
}

function filterByChannel(releases, channel) {
  return releases
    .map((r) => ({ ...r, channel: parseChannel(r, channel) }))
    .filter((r) => r.channel === channel);
}

function sortByVersion(releases) {
  const version = releaseVersion;
  // Invalid remote versions cannot win selection, including a one-element list.
  return releases.filter(r=>{try {parseSemver(version(r));return true;}catch {return false;}})
    .sort((a,b)=>compareSemver(version(b),version(a)));
}

export async function discoverLatestGithubRelease(config, options = {}) {
  const cfg = config || loadDistributionConfig(options.config_path);
  const channel = options.channel || cfg.release_channel || 'stable';

  if (options.fixture_path && fs.existsSync(options.fixture_path)) {
    const fixture = JSON.parse(fs.readFileSync(options.fixture_path, 'utf8'));
    const releases = Array.isArray(fixture) ? fixture : fixture.releases || [fixture];
    const filtered = filterByChannel(releases, channel);
    const latest = sortByVersion(filtered)[0];
    if (!latest) {
      return { found: false, reason: 'no_release_for_channel', channel, state: 'UNKNOWN' };
    }
    const normalized = normalizeRelease(latest, cfg, options);
    const validation = validateReleaseManifest({ release: normalized.release_manifest });
    return {
      found: true,
      ...normalized,
      manifest_valid: validation.valid,
      source: 'fixture',
      channel,
    };
  }

  if (options.mock_releases) {
    const filtered = filterByChannel(options.mock_releases, channel);
    const latest = sortByVersion(filtered)[0];
    if (!latest) return { found: false, reason: 'no_release_for_channel', channel };
    return { found: true, ...normalizeRelease(latest, cfg, options), source: 'mock', channel };
  }

  const owner = cfg.source?.owner;
  const repo = cfg.source?.repository;
  if (!repo) {
    return { found: false, reason: 'repository_not_configured', state: 'UNKNOWN' };
  }

  if (options.simulate_network_failure) {
    return {
      found: false,
      state: 'UNKNOWN',
      reason: 'remote_unavailable',
      status: { state: 'UNKNOWN', reason: 'remote_unavailable' },
    };
  }

  const apiUrl = owner
    ? `https://api.github.com/repos/${owner}/${repo}/releases`
    : `https://api.github.com/repos/${repo}/releases`;

  try {
    const fetchFn = options.fetch || globalThis.fetch;
    if (!fetchFn) {
      return { found: false, state: 'UNKNOWN', reason: 'fetch_unavailable' };
    }
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'forgeos-updater' };
    const res = await fetchFn(apiUrl, { headers, signal: options.signal });
    if (!res.ok) {
      return {
        found: false,
        state: 'UNKNOWN',
        reason: 'remote_unavailable',
        status: { state: 'UNKNOWN', reason: 'remote_unavailable', http_status: res.status },
      };
    }
    const releases = await res.json();
    const filtered = filterByChannel(releases, channel);
    const latest = sortByVersion(filtered)[0];
    if (!latest) {
      return { found: false, reason: 'no_stable_release', channel };
    }
    const normalized = normalizeRelease({
      ...latest,
      owner,
      repository: repo,
    }, cfg);
    return { found: true, ...normalized, source: 'github_api', channel };
  } catch {
    return {
      found: false,
      state: 'UNKNOWN',
      reason: 'remote_unavailable',
      status: { state: 'UNKNOWN', reason: 'remote_unavailable' },
    };
  }
}

export { normalizeRelease, parseChannel, filterByChannel };
