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
  if (typeof version !== 'string') throw Object.assign(new TypeError('invalid_semver'), {code:'INVALID_SEMVER'});
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  // The full-match check also rejects JS regexp $ matching before a final newline.
  if (!match || match[0] !== version) throw Object.assign(new TypeError('invalid_semver'), {code:'INVALID_SEMVER'});
  const prerelease = match[4]?.split('.') || [];
  if (prerelease.some(id => /^[0-9]+$/.test(id) && id.length > 1 && id[0] === '0'))
    throw Object.assign(new TypeError('invalid_semver'), {code:'INVALID_SEMVER'});
  const core = match.slice(1,4);
  // Preserve historical safe numeric fields, without rounding arbitrarily large SemVer integers.
  const field = s => Number.isSafeInteger(Number(s)) ? Number(s) : s;
  return {major:field(core[0]),minor:field(core[1]),patch:field(core[2]),core,
    prerelease,build:match[5]?.split('.') || [],raw:version};
}

function compareDecimal(a,b) {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}
export function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  for (let i=0;i<3;i++) { const cmp=compareDecimal(va.core[i],vb.core[i]);if(cmp)return cmp; }
  if (!va.prerelease.length || !vb.prerelease.length)
    return va.prerelease.length === vb.prerelease.length ? 0 : va.prerelease.length ? -1 : 1;
  for (let i=0;i<Math.min(va.prerelease.length,vb.prerelease.length);i++) {
    const x=va.prerelease[i],y=vb.prerelease[i];if(x===y)continue;
    const nx=/^[0-9]+$/.test(x),ny=/^[0-9]+$/.test(y);
    return nx && ny ? compareDecimal(x,y) : nx !== ny ? (nx ? -1 : 1) : x > y ? 1 : -1;
  }
  if (va.prerelease.length !== vb.prerelease.length) return va.prerelease.length > vb.prerelease.length ? 1 : -1;
  return 0;
}

export function classifyVersionBump(from, to) {
  const vf = parseSemver(from);
  const vt = parseSemver(to);
  for (let i=0;i<3;i++) {
    const cmp=compareDecimal(vt.core[i],vf.core[i]);
    if(cmp)return cmp>0 ? ['MAJOR','MINOR','PATCH'][i] : 'NONE';
  }
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
