#!/usr/bin/env node
/**
 * ForgeOS branding verification tests
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRODUCT_ID, PRODUCT_NAME, PACKAGE_NAME } from '../policy/identity.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

console.log('ForgeOS Branding Tests\n');

test('identity constants', () => {
  assert(PRODUCT_ID === 'forgeos');
  assert(PRODUCT_NAME === 'ForgeOS');
  assert(PACKAGE_NAME === 'forgeos');
});

test('package.json name is forgeos', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert(pkg.name === 'forgeos');
  assert(pkg.description.includes('ForgeOS'));
});

test('plugin displayName is ForgeOS for Cursor', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO, '.cursor-plugin/plugin.json'), 'utf8'));
  assert(plugin.displayName.includes('ForgeOS'));
  assert(plugin.forgeos?.product_id === 'forgeos');
  assert(plugin.name === 'cursor-agent-os');
});

test('distribution config uses forgeos repository', () => {
  const yaml = fs.readFileSync(path.join(REPO, 'policy/distribution.yaml'), 'utf8');
  assert(yaml.includes('repository: forgeos'));
  assert(yaml.includes('plugin_id: forgeos'));
  assert(yaml.includes('adapters:'));
});

test('release manifest plugin_id is forgeos', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'release/release-manifest.json'), 'utf8'));
  assert(manifest.release.plugin_id === 'forgeos');
  assert(manifest.release.adapters?.cursor?.plugin_id === 'cursor-agent-os');
});

test('validate-branding script passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-branding.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert(result.status === 0, result.stdout || result.stderr);
});

test('README leads with ForgeOS not Cursor Agent OS', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert(readme.includes('ForgeOS'));
  assert(readme.includes('Universal Development Intelligence Platform'));
  assert(!readme.startsWith('# Universal Cursor Agent OS'));
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
