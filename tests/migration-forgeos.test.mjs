#!/usr/bin/env node
/**
 * ForgeOS project adapter migration tests
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProjectManifest, getForgeOsBlock, normalizeProjectManifest } from '../policy/project-adapter.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');

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

function withTempProject(fixtureDir, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-mig-'));
  const projectDir = path.join(tmp, 'project');
  fs.cpSync(fixtureDir, projectDir, { recursive: true });
  try {
    return fn(projectDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('ForgeOS Migration Tests\n');

test('normalizeProjectManifest maps agent_os to forgeos', () => {
  const normalized = normalizeProjectManifest({
    agent_os: { version: '>=1.0 <2.0' },
    project: { id: 'x' },
  });
  assert(normalized.forgeos?.version === '>=1.0 <2.0');
  assert(normalized.agent_os?.version === '>=1.0 <2.0');
});

test('getForgeOsBlock prefers forgeos over agent_os', () => {
  const block = getForgeOsBlock({ forgeos: { version: '2.0' }, agent_os: { version: '1.0' } });
  assert(block.version === '2.0');
});

test('legacy project-a loads with forgeos compat', () => {
  const { data } = loadProjectManifest(FIXTURE_A);
  const block = getForgeOsBlock(data);
  assert(block?.version?.includes('1.0'));
});

test('migrate-to-forgeos dry-run proposes plan', () => {
  withTempProject(FIXTURE_A, (projectDir) => {
    const result = spawnSync(process.execPath, [
      'bootstrap/migrate-to-forgeos.mjs',
      '--project-dir', projectDir,
    ], { cwd: REPO, encoding: 'utf8' });
    assert(result.status === 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert(report.status === 'PLANNED' || report.status === 'ALREADY_MIGRATED');
  });
});

test('migrate apply + rollback', () => {
  withTempProject(FIXTURE_A, (projectDir) => {
    const apply = spawnSync(process.execPath, [
      'bootstrap/migrate-to-forgeos.mjs',
      '--project-dir', projectDir,
      '--apply',
    ], { cwd: REPO, encoding: 'utf8' });
    const report = JSON.parse(apply.stdout);
    if (report.status === 'SUCCESS' && report.backup) {
      const rollback = spawnSync(process.execPath, [
        'bootstrap/migrate-to-forgeos.mjs',
        '--project-dir', projectDir,
        '--rollback', report.backup,
      ], { cwd: REPO, encoding: 'utf8' });
      assert(rollback.status === 0);
      const { data } = loadProjectManifest(projectDir);
      assert(getForgeOsBlock(data));
    }
  });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
