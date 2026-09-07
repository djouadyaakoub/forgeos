#!/usr/bin/env node
/**
 * Phase 17 — Distribution security & GitHub integration tests
 */
import fs from 'node:fs';
import { temporaryFixtures } from './helpers/temporary-fixtures.mjs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDistributionConfig } from '../policy/distribution.mjs';
import { discoverLatestGithubRelease } from '../intelligence/update/github.mjs';
import { verifySourceAuthenticity, validateReleaseManifest } from '../intelligence/update/authenticity.mjs';
import { calculateSha256, verifySha256 } from '../scripts/security/checksum.mjs';
import { verifyReleaseSignature } from '../intelligence/update/signature.mjs';
import { discoverUniversalOsUpdateRemote } from '../intelligence/update/checker.mjs';
import { downloadReleaseAsset } from '../intelligence/update/downloader.mjs';
import { activateRelease, rollbackActivation } from '../intelligence/update/activate.mjs';
import { acquireUpdateLock, releaseUpdateLock } from '../intelligence/update/lock.mjs';
import { readUpdateCache, updateCacheEntry, shouldRefreshCache } from '../intelligence/update/cache.mjs';
import { buildUpdateProposal, getNotificationPriority } from '../intelligence/update/proposal.mjs';
import { buildUpdateNotification, applyUniversalUpdate } from '../intelligence/update/manager.mjs';
import { MIGRATION_MODES } from '../intelligence/update/planner.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GITHUB_FIXTURE = path.join(REPO, 'tests/fixtures/github/releases-stable.json');
const FIXTURES = temporaryFixtures(path.join(REPO,'tests/fixtures'));
const FIXTURE_A = path.join(FIXTURES, 'project-a');
const FIXTURE_B = path.join(FIXTURES, 'project-b');
const FIXTURE_C = path.join(FIXTURES, 'project-c');
const MANIFEST_110 = path.join(REPO, 'tests/fixtures/release-manifest-1.1.0.json');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function makeStageDir(version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-'));
  fs.mkdirSync(path.join(tmp, 'release'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.cursor-plugin'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'policy/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(tmp, '.cursor-plugin/plugin.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'policy/engine.mjs'), 'export {}\n');
  fs.writeFileSync(path.join(tmp, 'policy/hooks/policy-pre-tool.mjs'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(tmp, 'release/release-manifest.json'), JSON.stringify({
    release: {
      version,
      plugin_id: 'cursor-agent-os',
      adapter: { min_schema: 1 },
      supply_chain: { repository: 'cursor-agent-os' },
    },
  }));
  return tmp;
}

console.log('Phase 17 — Distribution Security & GitHub Tests\n');

console.log('--- Distribution config ---');
await test('loadDistributionConfig is generic without credentials', async () => {
  const cfg = loadDistributionConfig();
  assert(cfg.source.repository === 'forgeos');
  assert(cfg.source.plugin_id === 'forgeos');
  assert(!JSON.stringify(cfg).includes('token'));
});

console.log('\n--- GitHub release discovery ---');
await test('discoverLatestGithubRelease from fixture (stable)', async () => {
  const release = await discoverLatestGithubRelease(loadDistributionConfig(), {
    fixture_path: GITHUB_FIXTURE,
    repo_root: REPO,
  });
  assert(release.found);
  assert(release.version === '1.1.0');
  assert(release.channel === 'stable');
});

await test('stable channel excludes beta prerelease', async () => {
  const release = await discoverLatestGithubRelease(loadDistributionConfig(), {
    fixture_path: GITHUB_FIXTURE,
    repo_root: REPO,
    channel: 'stable',
  });
  assert(release.tag === 'v1.1.0');
});

console.log('\n--- Source authenticity ---');
await test('rejects wrong owner', async () => {
  const cfg = loadDistributionConfig();
  cfg.source.owner = 'trusted-owner';
  const result = verifySourceAuthenticity(cfg, {
    owner: 'evil-owner',
    repository: 'forgeos',
    plugin_id: 'forgeos',
  });
  assert(!result.authentic && result.blocked);
});

await test('rejects wrong plugin_id', async () => {
  const result = verifySourceAuthenticity(loadDistributionConfig(), {
    repository: 'cursor-agent-os',
    plugin_id: 'wrong-plugin',
  });
  assert(!result.authentic);
});

await test('accepts configured source', async () => {
  const result = verifySourceAuthenticity(loadDistributionConfig(), {
    repository: 'forgeos',
    plugin_id: 'forgeos',
    release_manifest: { plugin_id: 'forgeos', version: '1.1.0' },
  });
  assert(result.authentic);
});

console.log('\n--- Release manifest validation ---');
await test('validates required manifest fields', async () => {
  const valid = validateReleaseManifest({
    release: { version: '1.0.0', plugin_id: 'cursor-agent-os', adapter: { min_schema: 1 } },
  });
  assert(valid.valid);
  const invalid = validateReleaseManifest({ release: { version: '1.0.0' } });
  assert(!invalid.valid && invalid.blocked);
});

console.log('\n--- SHA256 integrity ---');
await test('calculateSha256 and verifySha256', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-'));
  const file = path.join(tmp, 'test.txt');
  fs.writeFileSync(file, 'hello-release');
  const hash = calculateSha256(file);
  assert(verifySha256(file, hash).valid);
  assert(verifySha256(file, 'wrong').blocked);
  fs.rmSync(tmp, { recursive: true, force: true });
});

await test('checksum mismatch BLOCKS', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-'));
  const file = path.join(tmp, 'artifact.bin');
  fs.writeFileSync(file, 'tampered');
  assert(verifySha256(file, 'a'.repeat(64)).blocked);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('\n--- Signature abstraction ---');
await test('verifyReleaseSignature checksum-only mode', async () => {
  const result = verifyReleaseSignature({
    release: { artifacts: [{ name: 'x.zip', sha256: 'abc' }] },
  });
  assert(result.checksum_only);
});

console.log('\n--- Update checker remote ---');
await test('remote discovery via fixture', async () => {
  const cachePath = path.join(os.tmpdir(), `cache-${Date.now()}.json`);
  const discovery = await discoverUniversalOsUpdateRemote({
    fixture_path: GITHUB_FIXTURE,
    repo_root: REPO,
    installed_version: '1.0.0',
    force_check: true,
    cache_path: cachePath,
  });
  assert(discovery.update_available);
  assert(discovery.latest.version === '1.1.0');
  fs.unlinkSync(cachePath);
});

await test('network failure → UNKNOWN', async () => {
  const discovery = await discoverUniversalOsUpdateRemote({
    simulate_network_failure: true,
    installed_version: '1.0.0',
  });
  assert(discovery.remote_state === 'UNKNOWN' || discovery.status?.state === 'UNKNOWN');
});

console.log('\n--- Cache & rate limiting ---');
await test('cache stores last_known_release', async () => {
  const cachePath = path.join(os.tmpdir(), `cache-${Date.now()}.json`);
  updateCacheEntry({ version: '1.1.0', tag: 'v1.1.0', channel: 'stable' }, { cache_path: cachePath });
  assert(readUpdateCache(cachePath).last_known_release.version === '1.1.0');
  fs.unlinkSync(cachePath);
});

await test('shouldRefreshCache respects force_check', async () => {
  const cachePath = path.join(os.tmpdir(), `cache-${Date.now()}.json`);
  updateCacheEntry({ version: '1.1.0' }, { cache_path: cachePath });
  assert(shouldRefreshCache(loadDistributionConfig(), { cache_path: cachePath, force_check: true }));
  fs.unlinkSync(cachePath);
});

console.log('\n--- Download & staging ---');
await test('download blocks wrong plugin_id', async () => {
  const result = await downloadReleaseAsset({
    version: '1.1.0',
    repository: 'cursor-agent-os',
    plugin_id: 'evil-plugin',
    release_manifest: { plugin_id: 'evil-plugin', version: '1.1.0', adapter: { min_schema: 1 } },
    assets: [],
  }, { config: loadDistributionConfig() });
  assert(result.blocked);
});

await test('download stages valid local bundle with checksum', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const bundleFile = path.join(tmp, 'forgeos-1.1.0.zip');
  fs.writeFileSync(bundleFile, 'test-bundle-content');
  const sha = calculateSha256(bundleFile);
  const result = await downloadReleaseAsset({
    version: '1.1.0',
    repository: 'forgeos',
    plugin_id: 'forgeos',
    release_manifest: {
      plugin_id: 'forgeos',
      version: '1.1.0',
      adapter: { min_schema: 1 },
      artifacts: [{ name: 'forgeos-1.1.0.zip', sha256: sha }],
    },
    assets: [{ name: 'forgeos-1.1.0.zip', local_path: bundleFile }],
  }, { config: loadDistributionConfig(), fixture_bundle: bundleFile, expected_sha256: sha });
  assert(result.status === 'STAGED' && result.checksum_verified);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('\n--- Activation & rollback ---');
await test('downgrade blocked without explicit action', async () => {
  const tmp = makeStageDir('1.0.0');
  const result = activateRelease(tmp, {
    config: loadDistributionConfig(),
    current_version: '1.2.0',
  });
  assert(result.status === 'BLOCKED' && result.reason === 'downgrade_not_allowed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

await test('rollback restores install manifest', async () => {
  const backupDir = path.join(os.tmpdir(), `backup-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const installPath = path.join(os.tmpdir(), `install-${Date.now()}.json`);
  fs.writeFileSync(installPath, JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(backupDir, 'install.json'), JSON.stringify({ version: '0.9.0' }));
  const { rollbackUniversalUpdate } = await import('../intelligence/update/migration.mjs');
  const rollback = rollbackUniversalUpdate(path.join(backupDir, 'install.json'), installPath);
  assert(rollback.status === 'ROLLED_BACK');
  assert(JSON.parse(fs.readFileSync(installPath, 'utf8')).version === '0.9.0');
  fs.rmSync(backupDir, { recursive: true, force: true });
});

console.log('\n--- Update lock ---');
await test('concurrent update prevented', async () => {
  const lockPath = path.join(os.tmpdir(), `lock-${Date.now()}.json`);
  const a = acquireUpdateLock({ lock_path: lockPath });
  assert(a.acquired);
  const b = acquireUpdateLock({ lock_path: lockPath });
  assert(!b.acquired && b.status === 'UPDATE_IN_PROGRESS');
  releaseUpdateLock({ lock_path: lockPath });
});

console.log('\n--- Notification & proposals ---');
await test('REVIEW_REQUIRED creates proposal', async () => {
  const proposal = buildUpdateProposal(FIXTURE_B, {
    migration_plan: { classification: 'REVIEW_REQUIRED', project: FIXTURE_B, actions: [] },
  }, { installed: { version: '1.0.0' }, latest: { version: '1.1.0' } });
  assert(proposal.proposal.approval_required && !proposal.proposal.auto_apply);
});

await test('security advisory raises priority', async () => {
  const p = getNotificationPriority({ security_update: true, security_severity: 'CRITICAL' }, []);
  assert(p.priority === 'CRITICAL');
});

console.log('\n--- Multi-project scenarios ---');
await test('A/B/C impact analysis', async () => {
  const notification = buildUpdateNotification({
    discovery: { installed: { version: '1.0.0' }, latest: { version: '1.1.0' }, update_available: true },
    projects: [
      { path: FIXTURE_A, project_id: 'project-a' },
      { path: FIXTURE_B, project_id: 'project-b' },
      { path: FIXTURE_C, project_id: 'project-c' },
    ],
  });
  const byId = Object.fromEntries(notification.notification.projects.map((p) => [p.project_id, p]));
  assert(byId['project-a'].status === MIGRATION_MODES.AUTO_SAFE);
  assert(byId['project-b'].status === MIGRATION_MODES.REVIEW_REQUIRED);
  assert(byId['project-c'].status === MIGRATION_MODES.INCOMPATIBLE);
});

await test('INCOMPATIBLE does not mutate', async () => {
  const apply = applyUniversalUpdate({
    installed_version: '1.0.0',
    manifest_path: MANIFEST_110,
    projects: [{ path: FIXTURE_C, project_id: 'project-c' }],
  });
  assert(apply.results.every((r) => r.status === 'SKIPPED'));
});

console.log('\n--- Release builder ---');
await test('build-release produces checksums', async () => {
  const result = spawnSync(process.execPath, ['scripts/release/build-release.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert(result.status === 0, result.stderr || result.stdout);
  assert(fs.existsSync(path.join(REPO, 'release/checksums.json')));
});

console.log('\n--- Supply chain ---');
await test('wrong repository blocked', async () => {
  assert(verifySourceAuthenticity(loadDistributionConfig(), {
    repository: 'malicious-repo',
    plugin_id: 'forgeos',
  }).blocked);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
