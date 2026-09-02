/**
 * Canonical Universal Agent OS version — single source of truth
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.dirname(POLICY_ROOT);

export function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

export function readPluginVersion() {
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.cursor-plugin', 'plugin.json'), 'utf8'));
  return plugin.version;
}

export function readRulesVersion() {
  const rules = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'policy', 'rules.json'), 'utf8'));
  return rules.agent_os_version;
}

export function getCanonicalVersion() {
  return readPackageVersion();
}

export function parseSemver(version) {
  const [major, minor, patch] = String(version).split('.').map((n) => Number(n) || 0);
  return { major, minor, patch, raw: version };
}

export function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  return 0;
}

export function classifyVersionBump(from, to) {
  const vf = parseSemver(from);
  const vt = parseSemver(to);
  if (vt.major > vf.major) return 'MAJOR';
  if (vt.minor > vf.minor) return 'MINOR';
  if (vt.patch > vf.patch) return 'PATCH';
  return 'NONE';
}

export function validateVersionSync() {
  const pkg = readPackageVersion();
  const plugin = readPluginVersion();
  const rules = readRulesVersion();
  const mismatches = [];
  if (pkg !== plugin) mismatches.push({ source: 'plugin.json', expected: pkg, got: plugin });
  if (pkg !== rules) mismatches.push({ source: 'rules.json', expected: pkg, got: rules });
  return {
    canonical: pkg,
    package: pkg,
    plugin,
    rules,
    in_sync: mismatches.length === 0,
    mismatches,
  };
}

export const CURRENT_ADAPTER_SCHEMA = 1;
