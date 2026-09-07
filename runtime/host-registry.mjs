/**
 * Host adapter registry
 *
 * Registers Host Adapters (Cursor / CLI / generic) — NOT Runtime Backends.
 * Runtime Backend registration lives in `runtime/registry.mjs`.
 * Routing lives in `runtime/router.mjs`.
 *
 * The nested field `runtime.entrypoint` on host descriptors means
 * "host adapter module entrypoint", not a RuntimeBackend implementation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHostAdapter } from '../runtime/interface.mjs';
import { PRODUCT_HOST_IDS, getProductHost } from '../host/catalog.mjs';
import { selectHost } from '../host/discovery.mjs';

const ADAPTERS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'adapters');

const LEGACY_INVENTORY = {
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

// Compatibility bootstrap/event descriptors; first-class identities come only from the catalog.
const BUILTIN_HOSTS = {
  ...LEGACY_INVENTORY,
  ...Object.fromEntries(PRODUCT_HOST_IDS.map(id => [id, {
    ...(LEGACY_INVENTORY[id] || { capabilities: { agents: false, hooks: false, tasks: true, terminal: false, workspace: true, approval_ui: false } }),
    id, name: getProductHost(id).name, product_host: true, implementation_kind: 'HOST_NATIVE',
    preparation: 'project_local_instructions', live_verified: false,
  }])),
};

export function listHostAdapters() {
  return Object.values(BUILTIN_HOSTS);
}

export function getHostAdapter(hostId = 'generic') {
  const adapter = typeof hostId === 'string' && Object.hasOwn(BUILTIN_HOSTS, hostId) ? BUILTIN_HOSTS[hostId] : null;
  if (!adapter) return { valid: false, reason: 'unknown_host', host_id: hostId };
  const validation = validateHostAdapter(adapter);
  return { ...adapter, ...validation };
}

export function detectHostAdapter(options = {}) {
  const selected = selectHost(options);
  if (!selected.ok) return { valid: false, reason: selected.reason };
  // Legacy no-selection bootstrap context remains generic/CLI, not an active-host claim.
  return getHostAdapter(selected.source === 'legacy_default' ? (options.cli ? 'cli' : 'generic') : selected.host_id);
}

export { ADAPTERS_ROOT, BUILTIN_HOSTS };
