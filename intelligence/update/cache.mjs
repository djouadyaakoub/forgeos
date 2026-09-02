/**
 * Cached release metadata — last_checked / last_known_release
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE_PATH = path.join(os.homedir(), '.cursor', 'agent-os', 'update-cache.json');
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function getCachePath() {
  return CACHE_PATH;
}

export function parseInterval(interval) {
  if (!interval) return DEFAULT_INTERVAL_MS;
  const m = String(interval).match(/^(\d+)(h|m|s)$/);
  if (!m) return DEFAULT_INTERVAL_MS;
  const n = Number(m[1]);
  if (m[2] === 'h') return n * 60 * 60 * 1000;
  if (m[2] === 'm') return n * 60 * 1000;
  return n * 1000;
}

export function readUpdateCache(cachePath = CACHE_PATH) {
  if (!fs.existsSync(cachePath)) {
    return { last_checked: null, last_known_release: null };
  }
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return { last_checked: null, last_known_release: null };
  }
}

export function writeUpdateCache(data, cachePath = CACHE_PATH) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export function shouldRefreshCache(config, options = {}) {
  if (options.force_check || options.refresh) return true;
  const cache = readUpdateCache(options.cache_path);
  if (!cache.last_checked) return true;
  const interval = parseInterval(config?.update?.check_interval);
  const elapsed = Date.now() - new Date(cache.last_checked).getTime();
  return elapsed >= interval;
}

export function updateCacheEntry(release, options = {}) {
  const cache = readUpdateCache(options.cache_path);
  const next = {
    last_checked: new Date().toISOString(),
    last_known_release: release ? {
      version: release.version,
      tag: release.tag,
      channel: release.channel,
      published_at: release.published_at,
    } : cache.last_known_release,
  };
  return writeUpdateCache(next, options.cache_path);
}
