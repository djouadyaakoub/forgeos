/** Stage 23: supported integrations, detection hints and active selection are distinct. */
import { createHostCapabilityDescriptor, PRODUCT_HOST_IDS, isProductHost } from './adapter.mjs';
import { createCursorHostAdapter } from './adapters/cursor/index.mjs';
import { createCodexHostAdapter } from './adapters/codex/index.mjs';
import { createClaudeCodeHostAdapter } from './adapters/claude-code/index.mjs';
import { readHostConfiguration } from './configuration.mjs';

const REGISTRY = new Map([createCodexHostAdapter, createCursorHostAdapter, createClaudeCodeHostAdapter]
  .map(create => [create().id, { create, discover: () => create().discovery }]));

// FORGEOS_ACTIVE_HOST is an explicit operator declaration, not auto-detection.
export function selectHost(options = {}) {
  const config = readHostConfiguration(options.project_dir);
  if (!config.ok) return { ok: false, supported: false, host_id: null, source: 'project_configuration', reason: config.reason };
  const active = options.active_host_id ?? (options.env ?? process.env).FORGEOS_ACTIVE_HOST;
  const explicit = options.host_id !== undefined && options.host_id !== null;
  const hostId = explicit ? options.host_id : (config.configured_host ?? active ?? 'cursor');
  const source = explicit ? 'explicit' : config.configured_host ? 'project_configuration' : active != null ? 'configured_active' : 'legacy_default';
  const supported = isProductHost(hostId);
  const legacy = hostId === 'cli' || hostId === 'generic';
  return { ok: supported || legacy, host_id: typeof hostId === 'string' ? hostId : null,
    supported, source, active_host_id: isProductHost(active) ? active : null,
    configured_host: config.configured_host,
    reason: supported || legacy ? null : 'unknown_host' };
}

export function discoverHosts(options = {}) {
  const selection = selectHost(options);
  const hints = Array.isArray(options.detected_host_ids) ? options.detected_host_ids : [];
  return { selection, hosts: PRODUCT_HOST_IDS.map(host_id => ({
    host_id, supported: true, detected: hints.includes(host_id) ? true : null,
    active: selection.active_host_id ? selection.active_host_id === host_id : null,
    selected: selection.ok && selection.host_id === host_id,
  })) };
}

export function discoverHostCapabilities(options = {}) {
  const selection = selectHost(options);
  const registered = REGISTRY.get(selection.host_id);
  if (registered) return { ...registered.discover(), selection };
  return { ...createHostCapabilityDescriptor({
    host_id: selection.host_id || '', host_name: selection.host_id || 'Unknown',
    capabilities: selection.ok ? ['read', 'analyze', ...(selection.host_id === 'cli' ? ['plan'] : [])] : [],
    capability_classes: selection.ok ? ['READ', 'ANALYZE'] : [],
    invocation: 'unknown',
    notes: ['No implemented interactive adapter; no execution capability inferred'],
  }), valid: false, reason: selection.reason || 'host_adapter_not_implemented', selection };
}

export function getHostExecutionAdapter(hostId = 'cursor') {
  const registered = REGISTRY.get(hostId);
  if (registered) return registered.create();
  return {
    id: hostId, name: 'Unsupported host', version: '0.0.0', capabilities: [],
    invocation: 'unknown', claims_policy_authority: false,
    health: () => ({ status: 'unknown' }),
    canHandle: () => ({ ok: false, reason: 'host_adapter_not_implemented' }),
    prepare: () => ({ ok: false, reason: 'host_adapter_not_implemented' }),
    start: () => ({ ok: false, started: false, execution_status: 'HOST_INTERACTIVE_REQUIRED', reason: 'host_adapter_not_implemented' }),
    cancel: () => ({ ok: false, cancelled: false }),
    collectEvidence: () => ({ ok: false, available: false }),
  };
}

// Compatibility export: descriptors are freshly created, never shared mutable cache entries.
export function clearHostDiscoveryCache() {}
