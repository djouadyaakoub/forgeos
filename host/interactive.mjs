/** Shared interactive-only host behavior. Does not execute or authorize tasks. */
import {
  validateHostExecutionAdapter,
  createHostCapabilityDescriptor,
  interactiveOnlyStartResult,
  interactiveOnlyCancelResult,
  HOST_CAPABILITY_CLASSES,
} from './adapter.mjs';
import { getProductHost } from './catalog.mjs';

const ADAPTER_VERSION = '0.2.0-stage23';

const INTERACTIVE_CAPABILITIES = Object.freeze([
  'read',
  'analyze',
  'plan',
  'edit',
  'refactor',
  'test',
  'documentation',
]);

const INTERACTIVE_CLASSES = Object.freeze([
  'READ',
  'ANALYZE',
  'PLAN',
  'EDIT',
  'REFACTOR',
  'TEST',
  'DOCUMENTATION',
]);

const TOOL_PROFILE_TO_CAPS = Object.freeze({
  'read-explore': ['read', 'analyze', 'plan'],
  'implement-local': ['read', 'analyze', 'edit', 'documentation'],
  test: ['read', 'analyze', 'test'],
  release: ['read', 'analyze'],
});

export function discoverInteractiveHostCapabilities(hostId, name) {
  name = getProductHost(hostId)?.name || name;
  return createHostCapabilityDescriptor({
    host_id: hostId,
    host_name: name,
    capabilities: INTERACTIVE_CAPABILITIES,
    capability_classes: INTERACTIVE_CLASSES,
    invocation: 'interactive',
    programmatic_agent_start: false,
    notes: [
      `${name} handoff is host-interactive; installation/session not probed`,
      'No ForgeOS-owned programmatic host Agent start API is claimed',
      'HOST_INTERACTIVE_ONLY for agent execution',
    ],
  });
}

function mapToolProfile(toolProfile) {
  return TOOL_PROFILE_TO_CAPS[toolProfile] || ['read', 'analyze'];
}

export function createInteractiveHostAdapter(hostId, name, overrides = {}) {
  name = getProductHost(hostId)?.name || name;
  const descriptor = discoverInteractiveHostCapabilities(hostId, name);

  const adapter = {
    id: hostId,
    name,
    version: ADAPTER_VERSION,
    schema: 'forgeos-host-adapter',
    authority: 'host_adapter',
    claims_policy_authority: false,
    capabilities: [...descriptor.capabilities],
    capability_classes: [...descriptor.capability_classes],
    invocation: 'interactive',
    programmatic_agent_start: false,
    discovery: descriptor,

    health() {
      return {
        status: 'unknown',
        invocation: 'interactive',
        programmatic_agent_start: false,
        detail: 'Adapter available; active host session and installation are not probed',
      };
    },

    canHandle(task = {}, _projectIntelligence = null, policyContext = {}) {
      const decision = policyContext?.policy_decision || policyContext?.permission || null;
      if (decision === 'deny' || decision?.permission === 'deny' || decision?.decision === 'deny') {
        return {
          ok: false,
          reason: 'policy_deny',
          note: 'Host cannot override ForgeOS DENY',
        };
      }
      const profile = task.tool_profile || task.requirements?.tool_profile || 'read-explore';
      const needed = mapToolProfile(profile);
      const missing = needed.filter((c) => !descriptor.capabilities.includes(c));
      if (missing.length) {
        return { ok: false, reason: 'host_capability_gap', missing };
      }
      return {
        ok: true,
        reason: 'host_supports_capability',
        invocation: 'interactive',
        executable_programmatically: false,
      };
    },

    prepare(request = {}) {
      return {
        ok: true,
        prepared: true,
        host_id: hostId,
        invocation: 'interactive',
        execution_status: 'HANDOFF_READY',
        task_id: request.task_id || null,
        note: 'Interactive handoff may be generated; start() does not run an agent loop',
      };
    },

    present(instructions) {
      return `${name} — existing workspace handoff\n\n${instructions}`;
    },

    start(_request = {}) {
      return interactiveOnlyStartResult('host_interactive_only');
    },

    cancel(_handle = {}) {
      return interactiveOnlyCancelResult();
    },

    collectEvidence(_handle = {}) {
      return {
        ok: false,
        available: false,
        evidence_class: 'HOST_NATIVE_INTERACTIVE',
        reason: 'no_programmatic_host_run',
        note: 'ForgeOS verification must inspect project state after interactive work',
      };
    },

    ...overrides,
  };

  const validation = validateHostExecutionAdapter(adapter);
  return { ...adapter, validation };
}

export { INTERACTIVE_CAPABILITIES, INTERACTIVE_CLASSES };
