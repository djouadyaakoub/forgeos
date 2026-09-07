#!/usr/bin/env node
/**
 * Portable hook shim — resolves ForgeOS install and delegates to Policy Authority hooks.
 * Copied to <project>/.cursor/hooks/agent-os/ during integrate-runtime / bootstrap.
 *
 * Does NOT evaluate policy itself. Fail-closed if ForgeOS root cannot be resolved.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK_NAME = path.basename(fileURLToPath(import.meta.url));
const PLUGIN_ID = 'cursor-agent-os';

const INSTALL_MANIFESTS = [
  path.join(os.homedir(), '.cursor', 'forge-os', 'install.json'),
  path.join(os.homedir(), '.cursor', 'agent-os', 'install.json'),
];

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isValidRoot(root) {
  return (
    root &&
    exists(path.join(root, '.cursor-plugin', 'plugin.json')) &&
    exists(path.join(root, 'policy', 'hooks', HOOK_NAME))
  );
}

function resolveRoot() {
  const envs = [
    process.env.FORGEOS_ROOT,
    process.env.CURSOR_AGENT_OS_PLUGIN_ROOT,
    process.env.AGENT_OS_PLUGIN_ROOT,
  ];
  for (const e of envs) {
    if (e && isValidRoot(e)) return path.resolve(e);
  }
  for (const manifestPath of INSTALL_MANIFESTS) {
    if (!exists(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m.plugin_root && isValidRoot(m.plugin_root)) return path.resolve(m.plugin_root);
    } catch {
      /* continue */
    }
  }
  if (process.env.FORGEOS_DEV_ROOT && isValidRoot(process.env.FORGEOS_DEV_ROOT)) {
    return path.resolve(process.env.FORGEOS_DEV_ROOT);
  }
  if (process.env.AGENT_OS_DEV_ROOT && isValidRoot(process.env.AGENT_OS_DEV_ROOT)) {
    return path.resolve(process.env.AGENT_OS_DEV_ROOT);
  }
  throw new Error(
    `ForgeOS plugin not found for hook ${HOOK_NAME} (plugin_id=${PLUGIN_ID}). Install: node <forgeos>/bootstrap/install-plugin.mjs`
  );
}

let stdin = '';
try {
  stdin = fs.readFileSync(0, 'utf8');
} catch {
  stdin = '';
}

try {
  const root = resolveRoot();
  const target = path.join(root, 'policy', 'hooks', HOOK_NAME);
  const r = spawnSync(process.execPath, [target], {
    input: stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    encoding: 'utf8',
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? (r.error ? 2 : 0));
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      authority: 'forgeos',
      user_message: 'Blocked: ForgeOS policy authority not available (fail closed).',
      agent_message: err.message,
    })
  );
  process.exit(2);
}
