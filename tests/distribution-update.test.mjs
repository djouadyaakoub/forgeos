#!/usr/bin/env node
/**
 * Phase 16 — GitHub packaging, distribution, and update lifecycle tests
 */
import fs from 'node:fs';
import { temporaryFixtures } from './helpers/temporary-fixtures.mjs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getCanonicalVersion,
  validateVersionSync,
  compareSemver,
  classifyVersionBump,
} from '../policy/version.mjs';
import { discoverUniversalOsUpdate } from '../intelligence/update/checker.mjs';
import { classifyProjectCompatibility, MIGRATION_MODES } from '../intelligence/update/planner.mjs';
import {
  planProjectMigrations,
  applyProjectMigration,
  rollbackProjectMigration,
  rollbackUniversalUpdate,
} from '../intelligence/update/migration.mjs';
import {
  buildUpdateNotification,
  planUniversalUpdate,
  applyUniversalUpdate,
  verifyUpdate,
} from '../intelligence/update/manager.mjs';
import { getUpdateStatus } from '../intelligence/update/status.mjs';
import {
  registerProject,
  unregisterProject,
  discoverInstalledProjects,
  readRegistry,
  getRegistryPath,
} from '../intelligence/registry/projects.mjs';
import { checkCompatibility } from '../intelligence/compatibility/adapter.mjs';
import { coordinateDevelopmentWorkflow } from '../intelligence/orchestrator/coordinator.mjs';
import { writeInstallManifest, getInstallManifestPath } from '../policy/plugin-root.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const FIXTURES = temporaryFixtures(path.join(REPO,'tests/fixtures'));
const FIXTURE_A = path.join(FIXTURES, 'project-a');
const FIXTURE_B = path.join(FIXTURES, 'project-b');
const FIXTURE_C = path.join(FIXTURES, 'project-c');
const FIXTURE_V1 = path.join(REPO, 'tests/fixtures/sample-project-v1');
const MANIFEST_110 = path.join(REPO, 'tests/fixtures/release-manifest-1.1.0.json');
const MANIFEST_200 = path.join(REPO, 'tests/fixtures/release-manifest-2.0.0.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
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

function withTempRegistry(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-registry-'));
  const regPath = path.join(tmp, 'projects.yaml');
  try {
    return fn(regPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function withTempProject(fixtureDir, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-proj-'));
  const projectDir = path.join(tmp, 'project');
  fs.cpSync(fixtureDir, projectDir, { recursive: true });
  try {
    return fn(projectDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('Phase 16 — Distribution & Update Tests\n');

console.log('--- Versioning ---');
test('Canonical version from package.json', () => {
  assert(getCanonicalVersion() === '2.0.0-rc.3');
});
test('Version sync across package, plugin, rules', () => {
  const sync = validateVersionSync();
  assert(sync.in_sync, JSON.stringify(sync.mismatches));
});
test('Semver compare and bump classification', () => {
  assert(compareSemver('1.0.0', '1.1.0') < 0);
  assert(classifyVersionBump('1.0.0', '1.1.0') === 'MINOR');
  assert(classifyVersionBump('1.0.0', '2.0.0') === 'MAJOR');
});

console.log('\n--- Release manifest ---');
test('Release manifest exists and matches version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'release/release-manifest.json'), 'utf8'));
  assert(manifest.release.version === getCanonicalVersion());
  assert(manifest.release.min_adapter_schema_version === 1);
});

console.log('\n--- Secret scan ---');
test('Secret scan runs clean', () => {
  const result = spawnSync(process.execPath, ['scripts/security/secret-scan.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout);
  assert(report.clean, `findings: ${report.findings_count}`);
});

console.log('\n--- Update discovery ---');
test('discoverUniversalOsUpdate reports installed vs latest', () => {
  const discovery = discoverUniversalOsUpdate({
    installed_version: '1.0.0',
    manifest_path: MANIFEST_110,
  });
  assert(discovery.update_available);
  assert(discovery.latest.version === '1.1.0');
  assert(discovery.version_bump === 'MINOR');
});

console.log('\n--- Project registry ---');
test('register and discover projects (metadata only)', () => {
  withTempRegistry((regPath) => {
    registerProject(FIXTURE_A, regPath);
    const projects = discoverInstalledProjects(regPath);
    assert(projects.length === 1);
    assert(projects[0].project_id === 'project-a');
    assert(!JSON.stringify(projects).includes('password'));
    unregisterProject(FIXTURE_A, regPath);
    assert(discoverInstalledProjects(regPath).length === 0);
  });
});

console.log('\n--- Compatibility ---');
test('project-a PATCH/MINOR → AUTO_SAFE', () => {
  const { compatibility } = classifyProjectCompatibility(FIXTURE_A, {
    from_version: '1.0.0',
    to_version: '1.1.0',
  });
  assert(compatibility.status === MIGRATION_MODES.AUTO_SAFE);
});
test('project-b old adapter → REVIEW_REQUIRED', () => {
  const { compatibility } = classifyProjectCompatibility(FIXTURE_B, {
    from_version: '1.0.0',
    to_version: '1.1.0',
  });
  assert(compatibility.status === MIGRATION_MODES.REVIEW_REQUIRED);
});
test('project-c version range → INCOMPATIBLE', () => {
  const { compatibility } = classifyProjectCompatibility(FIXTURE_C, {
    from_version: '1.0.0',
    to_version: '1.1.0',
  });
  assert(compatibility.status === MIGRATION_MODES.INCOMPATIBLE);
});
test('MAJOR 2.0 → REVIEW_REQUIRED when version range allows', () => {
  withTempProject(FIXTURE_A, (projectDir) => {
    const adapterPath = path.join(projectDir, '.agent-os/project.yaml');
    let content = fs.readFileSync(adapterPath, 'utf8');
    content = content.replace('>=1.0 <2.0', '>=1.0 <3.0');
    fs.writeFileSync(adapterPath, content, 'utf8');
    const { compatibility } = classifyProjectCompatibility(projectDir, {
      from_version: '1.0.0',
      to_version: '2.0.0',
      target_adapter_schema: 2,
    });
    assert(compatibility.status === MIGRATION_MODES.REVIEW_REQUIRED);
  });
});

console.log('\n--- Migration planning ---');
test('planProjectMigrations produces structured plan', () => {
  const plan = planProjectMigrations(FIXTURE_V1, { from_version: '1.0.0', to_version: '1.1.0' });
  assert(plan.migration_plan.project.includes('sample-project-v1') || plan.migration_plan.project_id === 'sample-project-v1');
  assert(plan.migration_plan.auto_modify_application_code === false);
});

console.log('\n--- AUTO_SAFE migration ---');
test('sample-project-v1 AUTO_SAFE migration succeeds', () => {
  withTempProject(FIXTURE_V1, (projectDir) => {
    const plan = planProjectMigrations(projectDir, { from_version: '1.0.0', to_version: '1.1.0' });
    assert(plan.migration_plan.classification === MIGRATION_MODES.AUTO_SAFE);
    const result = applyProjectMigration(projectDir, plan);
    assert(result.status === 'SUCCESS' || result.status === 'DRY_RUN' || result.mutated !== undefined);
    if (result.backup) {
      rollbackProjectMigration(projectDir, result.backup);
      const content = fs.readFileSync(path.join(projectDir, '.agent-os/project.yaml'), 'utf8');
      assert(!content.includes('installed_version') || content.includes('adapter_schema_version: 0'));
    }
  });
});

console.log('\n--- Failure + rollback ---');
test('simulated failure rolls back adapter', () => {
  withTempProject(FIXTURE_V1, (projectDir) => {
    const plan = planProjectMigrations(projectDir, { from_version: '1.0.0', to_version: '1.1.0' });
    const before = fs.readFileSync(path.join(projectDir, '.agent-os/project.yaml'), 'utf8');
    const fail = applyProjectMigration(projectDir, plan, { simulate_failure: true });
    assert(fail.status === 'FAILED');
    if (fail.backup) {
      rollbackProjectMigration(projectDir, fail.backup);
      const after = fs.readFileSync(path.join(projectDir, '.agent-os/project.yaml'), 'utf8');
      assert(after === before);
    }
  });
});

console.log('\n--- REVIEW_REQUIRED approval ---');
test('REVIEW_REQUIRED blocked without approval', () => {
  withTempProject(FIXTURE_B, (projectDir) => {
    const plan = planProjectMigrations(projectDir, { from_version: '1.0.0', to_version: '1.1.0' });
    const result = applyProjectMigration(projectDir, plan);
    assert(result.status === 'BLOCKED');
    assert(result.reason === 'approval_required');
  });
});

console.log('\n--- Multi-project update ---');
test('A/B/C classifications in single plan', () => {
  withTempRegistry((regPath) => {
    registerProject(FIXTURE_A, regPath);
    registerProject(FIXTURE_B, regPath);
    registerProject(FIXTURE_C, regPath);
    const plan = planUniversalUpdate({
      registry_path: regPath,
      installed_version: '1.0.0',
      manifest_path: MANIFEST_110,
    });
    const byId = Object.fromEntries(plan.universal_os_update.proposals.map((p) => [p.project_id, p]));
    assert(byId['project-a'].classification === MIGRATION_MODES.AUTO_SAFE);
    assert(byId['project-b'].classification === MIGRATION_MODES.REVIEW_REQUIRED);
    assert(byId['project-c'].classification === MIGRATION_MODES.INCOMPATIBLE);
    const apply = applyUniversalUpdate({
      registry_path: regPath,
      installed_version: '1.0.0',
      manifest_path: MANIFEST_110,
    });
    const blocked = apply.results.find((r) => r.project_id === 'project-b' || r.project?.includes('project-b'));
    const skipped = apply.results.find((r) => r.reason === 'incompatible');
    assert(blocked?.status === 'BLOCKED' || apply.results.some((r) => r.status === 'BLOCKED'));
    assert(skipped || apply.results.some((r) => r.reason === 'incompatible'));
  });
});

console.log('\n--- No silent mutation ---');
test('Notification does not auto-execute', () => {
  const { notification } = buildUpdateNotification({
    installed_version: '1.0.0',
    manifest_path: MANIFEST_110,
    projects: [{ path: FIXTURE_A, project_id: 'project-a' }],
  });
  assert(notification.auto_execute === false);
  assert(notification.silent_mutation === false);
});

console.log('\n--- Update status command ---');
test('getUpdateStatus is read-only', () => {
  const status = getUpdateStatus({
    installed_version: '1.0.0',
    manifest_path: MANIFEST_110,
    projects: [{ path: FIXTURE_A, project_id: 'project-a' }],
  });
  assert(status.command === 'forgeos update status');
  assert(status.mutates_anything === false);
});

console.log('\n--- Update verification ---');
test('verifyUpdate returns UPDATE_VERIFIED', () => {
  const result = verifyUpdate();
  assert(result.update_verification.status === 'UPDATE_VERIFIED');
});

console.log('\n--- Install from release ---');
test('install-from-release dry-run passes integrity', () => {
  const result = spawnSync(process.execPath, ['bootstrap/install-from-release.mjs', '--source', REPO, '--dry-run'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert(result.status === 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert(report.status === 'DRY_RUN');
  assert(report.integrity.valid);
});

console.log('\n--- Global rollback ---');
test('rollbackUniversalUpdate restores install manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-install-'));
  const manifestPath = path.join(tmp, 'install.json');
  const backupPath = path.join(tmp, 'install.json.backup');
  fs.writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0', plugin_root: '/old' }), 'utf8');
  fs.writeFileSync(backupPath, JSON.stringify({ version: '0.9.0', plugin_root: '/older' }), 'utf8');
  const result = rollbackUniversalUpdate(backupPath, manifestPath);
  assert(result.status === 'ROLLED_BACK');
  const restored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(restored.version === '0.9.0');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('\n--- Orchestrator INCOMPATIBLE block ---');
test('coordinateDevelopmentWorkflow blocks incompatible project', () => {
  const result = coordinateDevelopmentWorkflow({ project_dir: FIXTURE_C });
  assert(result.blocked === true);
  assert(result.phase === 'blocked_incompatible_environment');
});

console.log('\n--- User vs project scope ---');
test('Global update plan does not set auto_modify_project', () => {
  const plan = planUniversalUpdate({
    installed_version: '1.0.0',
    manifest_path: MANIFEST_110,
    projects: [{ path: FIXTURE_A, project_id: 'project-a' }],
  });
  assert(plan.universal_os_update.proposals.every((p) => p.auto_modify_project === false));
});

console.log('\n--- Repository hygiene ---');
test('.gitignore excludes secrets and user state', () => {
  const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert(gitignore.includes('.env'));
  assert(gitignore.includes('node_modules'));
});

console.log('\n--- Release candidate metadata ---');
test('Release manifest schema file exists', () => {
  assert(fs.existsSync(path.join(REPO, 'schemas/release-manifest.yaml')));
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
