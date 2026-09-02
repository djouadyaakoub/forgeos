/**
 * Host adapter registry
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHostAdapter } from '../runtime/interface.mjs';

const ADAPTERS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'adapters');

const BUILTIN_HOSTS = {
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    capabilities: {
      agents: true,
      hooks: true,
      tasks: true,
      terminal: true,
      workspace: true,
      approval_ui: true,
    },
    runtime: { entrypoint: 'adapters/cursor/integration.mjs' },
    distribution: { plugin_id: 'cursor-agent-os' },
  },
  cli: {
    id: 'cli',
    name: 'CLI',
    capabilities: {
      agents: true,
      hooks: false,
      tasks: true,
      terminal: true,
      workspace: false,
      approval_ui: false,
    },
    runtime: { entrypoint: 'adapters/cli/boundary.mjs' },
    distribution: { plugin_id: 'forgeos' },
  },
  generic: {
    id: 'generic',
    name: 'Generic Host',
    capabilities: {
      agents: true,
      hooks: false,
      tasks: true,
      terminal: false,
      workspace: true,
      approval_ui: false,
    },
    runtime: { entrypoint: 'tests/fixtures/generic-host/runtime.mjs' },
    distribution: { plugin_id: 'forgeos' },
  },
};

export function listHostAdapters() {
  return Object.values(BUILTIN_HOSTS);
}

export function getHostAdapter(hostId = 'generic') {
  const adapter = BUILTIN_HOSTS[hostId];
  if (!adapter) return { valid: false, reason: 'unknown_host', host_id: hostId };
  const validation = validateHostAdapter(adapter);
  return { ...adapter, ...validation };
}

export function detectHostAdapter(options = {}) {
  if (options.host_id) return getHostAdapter(options.host_id);
  if (process.env.CURSOR_PROJECT_DIR || process.env.CURSOR_WORKSPACE) {
    return getHostAdapter('cursor');
  }
  if (options.cli) return getHostAdapter('cli');
  return getHostAdapter('generic');
}

export { ADAPTERS_ROOT, BUILTIN_HOSTS };
