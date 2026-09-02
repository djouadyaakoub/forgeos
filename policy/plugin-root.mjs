/**
 * ForgeOS root resolution (formerly plugin-root)
 *
 * Resolution order:
 * 1. FORGEOS_ROOT
 * 2. CURSOR_AGENT_OS_PLUGIN_ROOT (legacy)
 * 3. AGENT_OS_PLUGIN_ROOT (legacy)
 * 4. User install manifest (~/.cursor/forge-os/install.json, legacy ~/.cursor/agent-os/)
 * 5. Cursor plugin cache scan
 * 6. FORGEOS_DEV_ROOT / AGENT_OS_DEV_ROOT (development)
 * 7. Repository dev fallback
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getCanonicalVersion } from './version.mjs';
import {
  PRODUCT_ID,
  CURSOR_PLUGIN_ID,
  ENV,
  INSTALL_DIR_NAMES,
  resolveRootFromEnv,
  resolveDevRootFromEnv,
} from './identity.mjs';

const POLICY_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(POLICY_ROOT);

function getInstallManifestCandidates() {
  return [
    path.join(os.homedir(), '.cursor', INSTALL_DIR_NAMES.primary, 'install.json'),
    path.join(os.homedir(), '.cursor', INSTALL_DIR_NAMES.legacy, 'install.json'),
  ];
}

function readInstallManifest() {
  for (const manifestPath of getInstallManifestCandidates()) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      return { data: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), path: manifestPath };
    } catch { /* try next */ }
  }
  return null;
}

const INSTALL_MANIFEST = getInstallManifestCandidates()[0];

function pathExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isValidForgeOsRoot(root) {
  if (!root) return false;
  const normalized = path.resolve(root);
  return (
    pathExists(path.join(normalized, '.cursor-plugin', 'plugin.json')) &&
    pathExists(path.join(normalized, 'policy', 'engine.mjs')) &&
    pathExists(path.join(normalized, 'policy', 'hooks', 'policy-pre-tool.mjs'))
  );
}

function discoverInPluginCache() {
  const cacheRoots = [
    path.join(os.homedir(), '.cursor', 'plugins', 'cache'),
    path.join(os.homedir(), '.cursor', 'plugins'),
  ];
  const found = [];
  for (const cacheRoot of cacheRoots) {
    if (!pathExists(cacheRoot)) continue;
    walkForPluginRoot(cacheRoot, found, 0, 6);
  }
  return found.find((p) => p.includes(CURSOR_PLUGIN_ID) || p.includes(PRODUCT_ID)) || found[0] || null;
}

function walkForPluginRoot(dir, found, depth, maxDepth) {
  if (depth > maxDepth) return;
  if (isValidForgeOsRoot(dir)) {
    found.push(path.resolve(dir));
    return;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    walkForPluginRoot(path.join(dir, entry.name), found, depth + 1, maxDepth);
  }
}

export function resolvePluginRoot(options = {}) {
  const candidates = [];
  const rootEnv = resolveRootFromEnv();
  if (rootEnv) {
    const source = process.env[ENV.FORGEOS_ROOT] ? ENV.FORGEOS_ROOT
      : process.env[ENV.CURSOR_AGENT_OS_PLUGIN_ROOT] ? ENV.CURSOR_AGENT_OS_PLUGIN_ROOT
        : ENV.AGENT_OS_PLUGIN_ROOT;
    candidates.push({ source, root: rootEnv });
  }

  const install = readInstallManifest();
  if (install?.data?.plugin_root) {
    candidates.push({ source: 'user_install_manifest', root: install.data.plugin_root });
  }

  const cached = discoverInPluginCache();
  if (cached) {
    candidates.push({ source: 'cursor_plugin_cache', root: cached });
  }

  const devRoot = resolveDevRootFromEnv();
  if (devRoot) {
    candidates.push({
      source: process.env[ENV.FORGEOS_DEV_ROOT] ? ENV.FORGEOS_DEV_ROOT : ENV.AGENT_OS_DEV_ROOT,
      root: devRoot,
    });
  }

  if (!options.skipDevFallback) {
    candidates.push({ source: 'development_checkout', root: REPO_ROOT });
  }

  for (const c of candidates) {
    if (isValidForgeOsRoot(c.root)) {
      return {
        root: path.resolve(c.root),
        source: c.source,
        product_id: PRODUCT_ID,
        plugin_id: CURSOR_PLUGIN_ID,
        cursor_plugin_id: CURSOR_PLUGIN_ID,
      };
    }
  }

  return {
    root: null,
    source: 'not_found',
    product_id: PRODUCT_ID,
    plugin_id: CURSOR_PLUGIN_ID,
    error: 'ForgeOS root not found. Run bootstrap/install-plugin.mjs',
  };
}

export function getPluginRoot(options = {}) {
  const resolved = resolvePluginRoot(options);
  if (!resolved.root) {
    throw new Error(resolved.error || 'ForgeOS root not found');
  }
  return resolved.root;
}

export function hookCommand(name) {
  return `node .cursor/hooks/forge-os/${name}`;
}

export function legacyHookCommand(name) {
  return `node .cursor/hooks/agent-os/${name}`;
}

export function hookAbsolutePath(name, pluginRoot = getPluginRoot()) {
  return path.join(pluginRoot, 'policy/hooks', name).replace(/\\/g, '/');
}

export function getInstallManifestPath() {
  const install = readInstallManifest();
  return install?.path || INSTALL_MANIFEST;
}

export function writeInstallManifest(pluginRoot, version = getCanonicalVersion()) {
  const manifestPath = getInstallManifestPath();
  const dir = path.dirname(manifestPath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    product_id: PRODUCT_ID,
    plugin_id: CURSOR_PLUGIN_ID,
    plugin_root: path.resolve(pluginRoot).replace(/\\/g, '/'),
    version,
    installed_at: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export const PLUGIN_ID = PRODUCT_ID;
export { REPO_ROOT, INSTALL_MANIFEST, PRODUCT_ID, CURSOR_PLUGIN_ID };
