#!/usr/bin/env node
/**
 * Phase 12 — Plugin portability & fresh-machine simulation tests
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolvePluginRoot,
  writeInstallManifest,
  getInstallManifestPath,
  PLUGIN_ID,
  REPO_ROOT,
} from '../policy/plugin-root.mjs';
import { resetRuntimeCache } from '../policy/runtime.mjs';
import { loadEffectiveRules } from '../policy/project-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const SAMPLE = path.join(REPO, 'tests/fixtures/sample-project');
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');
const SPEED_FLEXY = 'C:/Apps/speed-flexy-server';

let passed = 0;
let failed = 0;
const origEnv = { ...process.env };

function test(name, fn) {
  const installPath = getInstallManifestPath();
  const installBefore = fs.existsSync(installPath) ? fs.readFileSync(installPath) : null;
  try {
    resetRuntimeCache();
    process.env = { ...origEnv };
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  } finally {
    if (installBefore) fs.writeFileSync(installPath, installBefore);
    else if (fs.existsSync(installPath)) fs.unlinkSync(installPath);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('Plugin Portability Tests\n');

console.log('--- Plugin root resolution ---');
test('Resolves from user install manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-install-'));
  const fakeRoot = path.join(tmp, 'plugin');
  fs.mkdirSync(path.join(fakeRoot, '.cursor-plugin'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'policy/hooks'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, '.cursor-plugin/plugin.json'), '{}');
  fs.writeFileSync(path.join(fakeRoot, 'policy/engine.mjs'), 'export {}\n');
  fs.writeFileSync(path.join(fakeRoot, 'policy/hooks/policy-pre-tool.mjs'), 'process.exit(0);\n');
  const manifestPath = path.join(tmp, 'install.json');
  fs.mkdirSync(path.dirname(getInstallManifestPath()), { recursive: true });
  const saved = fs.existsSync(getInstallManifestPath()) ? fs.readFileSync(getInstallManifestPath()) : null;
  writeInstallManifest(fakeRoot);
  delete process.env.AGENT_OS_DEV_ROOT;
  const r = resolvePluginRoot({ skipDevFallback: true });
  assert(r.root === path.resolve(fakeRoot), `expected ${fakeRoot} got ${r.root}`);
  assert(r.source === 'user_install_manifest', r.source);
  if (saved) fs.writeFileSync(getInstallManifestPath(), saved);
  else if (fs.existsSync(getInstallManifestPath())) fs.unlinkSync(getInstallManifestPath());
});

test('Root resolution preserves installed-root precedence over checkout fallback', () => {
  const r = resolvePluginRoot();
  const expected = r.source === 'user_install_manifest'
    ? JSON.parse(fs.readFileSync(getInstallManifestPath(),'utf8')).plugin_root : REPO_ROOT;
  assert(r.root === path.resolve(expected), `got ${r.root}`);
  assert(r.source === 'development_checkout' || r.source === 'user_install_manifest', r.source);
});

console.log('\n--- Portable hooks ---');
test('Speed Flexy hooks.json has no absolute dev path', () => {
  if(process.env.FORGEOS_LIVE_PROJECT_TESTS!=='1') {console.log('  SKIP  live project opt-in required');return;}
  if (!fs.existsSync(path.join(SPEED_FLEXY, '.cursor/hooks.json'))) {
    console.log('  SKIP  not integrated');
    return;
  }
  const raw = fs.readFileSync(path.join(SPEED_FLEXY, '.cursor/hooks.json'), 'utf8');
  assert(!raw.includes('C:/Apps/cursor-agent-os'), 'absolute dev path found (legacy folder)');
  assert(!raw.includes('C:/Apps/ForgeOS'), 'absolute dev path found (ForgeOS folder)');
  assert(raw.includes('.cursor/hooks/agent-os/'), 'portable shim path missing');
});

test('Portable shim delegates to universal hook', () => {
  if(process.env.FORGEOS_LIVE_PROJECT_TESTS!=='1') {console.log('  SKIP  live project opt-in required');return;}
  const shim = path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-pre-tool.mjs');
  if (!fs.existsSync(shim)) {
    console.log('  SKIP  shims not installed');
    return;
  }
  writeInstallManifest(REPO_ROOT);
  const input = JSON.stringify({
    tool_name: 'Write',
    tool_input: { path: '.cursor/hooks.json' },
    workspace_folder: SPEED_FLEXY,
  });
  const r = spawnSync('node', [shim], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_PROJECT_DIR: SPEED_FLEXY },
    cwd: SPEED_FLEXY,
  });
  assert(r.status === 2, `exit ${r.status}`);
  assert(JSON.parse(r.stdout).permission === 'deny', 'expected deny');
});

console.log('\n--- Project isolation ---');
test('Sample project has no Speed Flexy capabilities', () => {
  process.env.CURSOR_PROJECT_DIR = SAMPLE;
  const rules = loadEffectiveRules(SAMPLE);
  assert(rules.project?.id === 'sample-project' || rules.agents, 'sample loaded');
  assert(!rules.agents['backend-api'], 'Speed Flexy agent leaked');
  assert(!rules.agents['ledger'], 'SF domain leaked');
  const manifest = fs.readFileSync(path.join(SAMPLE, '.agent-os/project.yaml'), 'utf8');
  assert(!manifest.includes('fly_deploy'), 'SF tier3 leaked');
  assert(!manifest.includes('speed-flexy'), 'SF name leaked');
});

test('Speed Flexy has backend-api; sample does not', () => {
  if(process.env.FORGEOS_LIVE_PROJECT_TESTS!=='1') {console.log('  SKIP  live project opt-in required');return;}
  process.env.CURSOR_PROJECT_DIR = SPEED_FLEXY;
  const sf = loadEffectiveRules(SPEED_FLEXY);
  process.env.CURSOR_PROJECT_DIR = SAMPLE;
  const sp = loadEffectiveRules(SAMPLE);
  assert(sf.agents['backend-api'], 'SF missing backend-api');
  assert(!sp.agents['backend-api'], 'sample leaked backend-api');
});

console.log('\n--- Fresh-machine simulation ---');
test('Runtime works when dev path env cleared', () => {
  writeInstallManifest(REPO_ROOT);
  delete process.env.AGENT_OS_DEV_ROOT;
  const r = resolvePluginRoot({ skipDevFallback: true });
  assert(r.root, 'no root from install manifest');
  assert(r.source === 'user_install_manifest', r.source);
  const shim = path.join(SPEED_FLEXY, '.cursor/hooks/agent-os/policy-shell.mjs');
  if (!fs.existsSync(shim)) {
    console.log('  SKIP  shim missing');
    return;
  }
  const input = JSON.stringify({ command: 'fly deploy', workspace_folder: SPEED_FLEXY });
  const hook = spawnSync('node', [shim], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_PROJECT_DIR: SPEED_FLEXY },
    cwd: SPEED_FLEXY,
  });
  assert(hook.status === 2, 'fly deploy should block');
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
