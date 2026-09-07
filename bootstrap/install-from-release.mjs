#!/usr/bin/env node
/**
 * Install Universal Agent OS from a versioned release (local or GitHub-style path).
 *
 * Usage:
 *   node bootstrap/install-from-release.mjs --source <release-dir> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeInstallManifest, resolvePluginRoot, getInstallManifestPath } from '../policy/plugin-root.mjs';
import { getCanonicalVersion, validateVersionSync } from '../policy/version.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceIdx = args.indexOf('--source');
const source = sourceIdx >= 0 ? path.resolve(args[sourceIdx + 1]) : REPO_ROOT;

const REQUIRED_PATHS = [
  '.cursor-plugin/plugin.json',
  'policy/engine.mjs',
  'policy/hooks/policy-pre-tool.mjs',
  'templates/runtime/hook-shim.mjs',
  'package.json',
  'release/release-manifest.json',
];

function readReleaseManifest(dir) {
  const manifestPath = path.join(dir, 'release/release-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyIntegrity(releaseDir) {
  const missing = [];
  for (const rel of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(releaseDir, rel))) missing.push(rel);
  }
  const manifest = readReleaseManifest(releaseDir);
  const versionSync = validateVersionSync();
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(releaseDir, 'package.json'), 'utf8')).version;
  const issues = [];
  if (!manifest) issues.push('missing_release_manifest');
  if (manifest && manifest.release?.version !== pkgVersion) {
    issues.push('manifest_version_mismatch');
  }
  if (versionSync.canonical !== pkgVersion && releaseDir === REPO_ROOT) {
    issues.push('dev_version_note');
  }
  return {
    valid: missing.length === 0 && issues.filter((i) => i !== 'dev_version_note').length === 0,
    missing,
    issues,
    manifest: manifest?.release || null,
    version: pkgVersion,
    checksum_note: 'SHA256 verification optional — not enforced in local install',
  };
}

const integrity = verifyIntegrity(source);
if (!integrity.valid) {
  console.log(JSON.stringify({ action: 'install-from-release', status: 'INTEGRITY_FAILED', ...integrity }, null, 2));
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify({
    action: 'install-from-release',
    status: 'DRY_RUN',
    source: source.replace(/\\/g, '/'),
    version: integrity.version,
    integrity,
    would_write: getInstallManifestPath().replace(/\\/g, '/'),
  }, null, 2));
  process.exit(0);
}

const manifest = writeInstallManifest(source, integrity.version);
const verify = resolvePluginRoot({ skipDevFallback: true });

const report = {
  action: 'install-from-release',
  status: verify.root === path.resolve(source) ? 'INSTALLED' : 'VERIFY_FAILED',
  source: source.replace(/\\/g, '/'),
  version: manifest.version,
  install_manifest: getInstallManifestPath().replace(/\\/g, '/'),
  integrity,
  resolution_source: verify.source,
  dev_mode: source === REPO_ROOT,
  installed_mode: true,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.status === 'INSTALLED' ? 0 : 1);
