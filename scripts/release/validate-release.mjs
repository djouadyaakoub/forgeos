#!/usr/bin/env node
/**
 * Release gate — validates release readiness without creating tags or GitHub releases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateVersionSync, getCanonicalVersion } from '../../policy/version.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const LOCAL_PATH_PATTERNS = [
  /C:\\Apps\\cursor-agent-os/gi,
  /C:\/Apps\/cursor-agent-os/gi,
  /C:\\Apps\\ForgeOS/gi,
  /C:\/Apps\/ForgeOS/gi,
  /C:\\Apps\\speed-flexy-server/gi,
];

const SPEED_FLEXY_LEAK = [
  /speed-flexy/gi,
  /speed_flexy/gi,
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function checkVersionSync() {
  const sync = validateVersionSync();
  return { check: 'version_sync', status: sync.in_sync ? 'pass' : 'fail', details: sync };
}

function checkReleaseManifest() {
  const manifestPath = path.join(ROOT, 'release/release-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { check: 'release_manifest', status: 'fail', reason: 'missing' };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const canonical = getCanonicalVersion();
  const ok = manifest.release?.version === canonical;
  return {
    check: 'release_manifest',
    status: ok ? 'pass' : 'fail',
    version: manifest.release?.version,
    canonical,
  };
}

function checkPlugin() {
  const pluginPath = path.join(ROOT, '.cursor-plugin/plugin.json');
  if (!fs.existsSync(pluginPath)) return { check: 'plugin_valid', status: 'fail' };
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  const engine = fs.existsSync(path.join(ROOT, 'policy/engine.mjs'));
  const hook = fs.existsSync(path.join(ROOT, 'policy/hooks/policy-pre-tool.mjs'));
  return {
    check: 'plugin_valid',
    status: plugin.name && engine && hook ? 'pass' : 'fail',
    version: plugin.version,
  };
}

function checkSchemas() {
  const required = ['schemas/release-manifest.yaml', 'schemas/structure-plan.yaml'];
  const missing = required.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  return { check: 'schemas_valid', status: missing.length === 0 ? 'pass' : 'fail', missing };
}

function checkDocs() {
  const required = ['README.md', 'CHANGELOG.md', 'docs/installation.md', 'docs/updates.md'];
  const missing = required.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  return { check: 'documentation', status: missing.length === 0 ? 'pass' : 'fail', missing };
}

function scanLocalPaths() {
  const offenders = [];
  const scanDirs = ['bootstrap', 'policy', 'intelligence', 'docs', 'agents'];
  for (const dir of scanDirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    walk(full, (file, content) => {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rel.includes('validate-release.mjs')) return;
      if (/docs\/.*(PHASE-|REPORT|EXTRACTION)/.test(rel)) return;
      for (const pat of LOCAL_PATH_PATTERNS) {
        if (pat.test(content)) offenders.push({ file: rel, pattern: pat.source });
      }
    });
  }
  return {
    check: 'no_local_paths',
    status: offenders.length === 0 ? 'pass' : 'fail',
    offenders: offenders.slice(0, 10),
  };
}

function scanSpeedFlexyLeakage() {
  const offenders = [];
  const scanDirs = ['agents', 'policy', 'intelligence', 'docs', 'bootstrap'];
  for (const dir of scanDirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    walk(full, (file, content) => {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rel.includes('PHASE-') || rel.includes('validate-release')) return;
      for (const pat of SPEED_FLEXY_LEAK) {
        if (pat.test(content) && !rel.includes('distribution-update.test')) {
          offenders.push({ file: rel });
        }
      }
    });
  }
  return {
    check: 'no_speed_flexy_leakage',
    status: offenders.length === 0 ? 'pass' : 'warn',
    offenders: offenders.slice(0, 5),
  };
}

function walk(dir, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      walk(full, fn);
    } else if (entry.isFile() && /\.(mjs|js|md|yaml|yml|json)$/.test(entry.name)) {
      try {
        fn(full, fs.readFileSync(full, 'utf8'));
      } catch { /* skip */ }
    }
  }
}

function runSecretScan() {
  const result = spawnSync(process.execPath, ['scripts/security/secret-scan.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  let parsed = { clean: result.status === 0 };
  try {
    parsed = JSON.parse(result.stdout);
  } catch { /* use default */ }
  return {
    check: 'secret_scan',
    status: parsed.clean ? 'pass' : 'fail',
    findings_count: parsed.findings_count ?? -1,
  };
}

function checkChecksums() {
  const checksumsPath = path.join(ROOT, 'release/checksums.json');
  if (!fs.existsSync(checksumsPath)) {
    return { check: 'checksums_manifest', status: 'warn', reason: 'missing — run npm run build-release' };
  }
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
  const archive = checksums.artifacts?.find((a) => /\.zip$/i.test(a.name));
  if (!archive) return { check: 'checksums_manifest', status: 'warn', reason: 'no_archive_entry' };
  const archivePath = path.join(ROOT, 'release', archive.name);
  if (!fs.existsSync(archivePath)) {
    return { check: 'checksums_manifest', status: 'warn', reason: 'archive_not_found' };
  }
  const result = spawnSync(process.execPath, [
    '-e',
    `import { verifySha256 } from './scripts/security/checksum.mjs'; const r=verifySha256('${archivePath.replace(/\\/g, '/')}', '${archive.sha256}'); process.exit(r.valid?0:1);`,
  ], { cwd: ROOT, encoding: 'utf8' });
  return { check: 'checksums_manifest', status: result.status === 0 ? 'pass' : 'fail' };
}

function runSecurityTests() {
  const result = spawnSync(process.execPath, ['tests/distribution-security.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { check: 'distribution_security_tests', status: result.status === 0 ? 'pass' : 'fail', exit_code: result.status };
}

const checks = [
  checkVersionSync(),
  checkReleaseManifest(),
  checkPlugin(),
  checkSchemas(),
  checkDocs(),
  scanLocalPaths(),
  scanSpeedFlexyLeakage(),
  runSecretScan(),
  runDistributionTests(),
  runSecurityTests(),
  checkChecksums(),
];

function runDistributionTests() {
  const result = spawnSync(process.execPath, ['tests/distribution-update.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, AGENT_OS_SKIP_FULL_REGRESSION: '1' },
  });
  return {
    check: 'distribution_tests',
    status: result.status === 0 ? 'pass' : 'fail',
    exit_code: result.status,
  };
}

const blocked = checks.filter((c) => c.status === 'fail');
const warnings = checks.filter((c) => c.status === 'warn');

const report = {
  release_validation: {
    version: getCanonicalVersion(),
    status: blocked.length === 0 ? 'READY' : 'BLOCKED',
    checks,
    blocked_count: blocked.length,
    warning_count: warnings.length,
    validated_at: new Date().toISOString(),
    note: 'Does not create git tags or GitHub releases',
  },
};

const rcPath = path.join(ROOT, 'release/release-candidate.json');
fs.writeFileSync(rcPath, JSON.stringify({
  release_candidate: {
    version: getCanonicalVersion(),
    status: blocked.length === 0 ? 'READY' : 'BLOCKED',
    checks: checks.map((c) => ({ check: c.check, status: c.status })),
    warnings: warnings.map((c) => c.check),
  },
}, null, 2));

console.log(JSON.stringify(report, null, 2));
process.exit(blocked.length === 0 ? 0 : 1);
