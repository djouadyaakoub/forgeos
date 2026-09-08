#!/usr/bin/env node
/**
 * Release gate — validates release readiness without creating tags or GitHub releases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateVersionSync, getCanonicalVersion } from '../../policy/version.mjs';
import { checkInvariantRegistry } from './invariant-enforcer-registry.mjs';
import { auditProductLeakage, auditProductPaths } from './product-leakage.mjs';
import { checkReleaseChecksums } from './checksum-validation.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));


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
  const required = [
    'schemas/release-manifest.yaml',
    'schemas/structure-plan.yaml',
    'schemas/project-intelligence-contract.schema.yaml',
    'schemas/runtime-backend-interface.schema.yaml',
    'schemas/capability-assessment.schema.yaml',
    'schemas/canvas-item.schema.yaml',
    'schemas/task-candidate.schema.yaml',
    'schemas/task-approval.schema.yaml',
    'schemas/governance-evidence.schema.yaml',
    'schemas/orchestration-plan.schema.yaml',
    'schemas/host-task-handoff.schema.yaml',
    'schemas/structural-facts.schema.yaml',
    'schemas/capability-operation.schema.yaml',
    'schemas/oss-derived-capability.schema.yaml',
  ];
  const missing = required.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  return { check: 'schemas_valid', status: missing.length === 0 ? 'pass' : 'fail', missing };
}

function checkDocs() {
  const required = ['README.md', 'CHANGELOG.md', 'docs/installation.md', 'docs/updates.md'];
  const missing = required.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  return { check: 'documentation', status: missing.length === 0 ? 'pass' : 'fail', missing };
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

function runSecurityTests() {
  const result = spawnSync(process.execPath, ['tests/distribution-security.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { check: 'distribution_security_tests', status: result.status === 0 ? 'pass' : 'fail', exit_code: result.status };
}

function ensureReleaseBuilt() {
  const result = spawnSync(process.execPath, ['scripts/release/build-release.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    check: 'build_release',
    status: result.status === 0 ? 'pass' : 'fail',
    exit_code: result.status,
  };
}

function runExtractedReleaseE2E() {
  const result = spawnSync(process.execPath, ['scripts/release/validate-extracted-release-e2e.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORGEOS_ROOT: '',
      CURSOR_AGENT_OS_PLUGIN_ROOT: '',
      AGENT_OS_PLUGIN_ROOT: '',
      FORGEOS_DEV_ROOT: '',
      AGENT_OS_DEV_ROOT: '',
    },
  });
  let detail = {};
  try {
    detail = JSON.parse(result.stdout);
  } catch {
    detail = { raw_stdout: (result.stdout || '').slice(0, 2000), stderr: (result.stderr || '').slice(0, 1000) };
  }
  return {
    check: 'extracted_release_e2e',
    status: result.status === 0 ? 'pass' : 'fail',
    exit_code: result.status,
    detail,
  };
}

function runManifestContractTests() {
  const a = spawnSync(process.execPath, ['tests/project-manifest-contract.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const b = spawnSync(process.execPath, ['tests/project-intelligence-contract.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    check: 'project_manifest_contract',
    status: a.status === 0 && b.status === 0 ? 'pass' : 'fail',
    exit_code: a.status === 0 ? b.status : a.status,
  };
}

const checks = [
  checkInvariantRegistry(ROOT),
  checkVersionSync(),
  checkReleaseManifest(),
  checkPlugin(),
  checkSchemas(),
  checkDocs(),
  auditProductPaths(ROOT),
  auditProductLeakage(ROOT),
  runSecretScan(),
  runDistributionTests(),
  runSecurityTests(),
  runManifestContractTests(),
  ensureReleaseBuilt(),
  checkReleaseChecksums(ROOT),
  runExtractedReleaseE2E(),
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
