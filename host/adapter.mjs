/**
 * Host Adapter contract — Stage 12
 *
 * Host Adapters integrate editors/IDEs with ForgeOS.
 * They are NOT Runtime Backends and NOT Policy Authority.
 * They must not implement independent authorization rules.
 */
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { PRODUCT_HOST_IDS, isProductHost } from './catalog.mjs';
export { PRODUCT_HOST_IDS, isProductHost } from './catalog.mjs';

export const HOST_INVOCATION_MODES = Object.freeze([
  'interactive',
  'programmatic',
  'unknown',
]);

export const HOST_CAPABILITY_CLASSES = Object.freeze([
  'READ',
  'ANALYZE',
  'PLAN',
  'EDIT',
  'REFACTOR',
  'TEST',
  'DOCUMENTATION',
]);

export const HOST_ADAPTER_SCHEMA = 'forgeos-host-adapter';


/** Stage 23: capabilities of this integration, not a product feature survey. */
export function validateHostCapabilityDescriptor(d) {
  const reasons = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { valid: false, reasons: ['missing_descriptor'] };
  if (!isProductHost(d.host_id)) reasons.push('unsupported_host');
  if (d.schema !== 'forgeos-host-capability-descriptor' || d.schema_version !== 1) reasons.push('invalid_schema');
  if (typeof d.host_name !== 'string' || !d.host_name.trim()) reasons.push('missing_name');
  for (const field of ['capabilities', 'capability_classes']) {
    const allowed = field === 'capabilities' ? HOST_CAPABILITY_CLASSES.map(c => c.toLowerCase()) : HOST_CAPABILITY_CLASSES;
    if (!Array.isArray(d[field]) || !d[field].length || d[field].some(c => !allowed.includes(c))
      || new Set(d[field]).size !== d[field].length) reasons.push(`invalid_${field}`);
  }
  if (d.invocation !== 'interactive' || d.interactive_execution !== true) reasons.push('interactive_only');
  for (const field of ['programmatic_agent_start', 'programmatic_execution', 'requires_docker', 'launches_external_runtime']) {
    if (d[field] !== false) reasons.push(`unsupported_${field}`);
  }
  if (d.same_workspace !== true || d.workspace_scope !== 'existing_project') reasons.push('existing_workspace_required');
  if (d.implementation_kind !== 'HOST_NATIVE') reasons.push('host_not_runtime');
  return { valid: reasons.length === 0, reasons };
}

/**
 * Validate a Host Adapter descriptor against the Stage 12 contract.
 */
export function validateHostExecutionAdapter(adapter = {}) {
  const reasons = [];
  if (!adapter || typeof adapter !== 'object') {
    return { valid: false, reasons: ['missing_adapter'] };
  }
  if (!adapter.id) reasons.push('missing_id');
  if (!adapter.name) reasons.push('missing_name');
  if (!adapter.version) reasons.push('missing_version');
  if (!Array.isArray(adapter.capabilities)) reasons.push('missing_capabilities');
  if (!HOST_INVOCATION_MODES.includes(adapter.invocation)) {
    reasons.push('invalid_invocation');
  }

  for (const fn of ['health', 'canHandle', 'prepare', 'start', 'cancel', 'collectEvidence']) {
    if (typeof adapter[fn] !== 'function') reasons.push(`missing_${fn}`);
  }

  if (adapter.claims_policy_authority === true) {
    reasons.push('host_cannot_claim_policy_authority');
  }
  if (adapter.authority && adapter.authority !== 'host_adapter') {
    reasons.push('invalid_authority_claim');
  }
  if (adapter.discovery) {
    reasons.push(...validateHostCapabilityDescriptor(adapter.discovery).reasons);
    if (adapter.id !== adapter.discovery.host_id) reasons.push('host_identity_mismatch');
    if (adapter.programmatic_agent_start !== false || adapter.invocation !== 'interactive') reasons.push('unsupported_invocation');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    policy_authority: POLICY_AUTHORITY,
    note: 'Host Adapter never becomes Policy Authority',
  };
}

/**
 * Normalize host capability discovery descriptor.
 */
export function createHostCapabilityDescriptor(input = {}) {
  return {
    schema: 'forgeos-host-capability-descriptor',
    schema_version: 1,
    host_id: String(input.host_id || ''),
    host_name: String(input.host_name || input.host_id || ''),
    capabilities: [...new Set((input.capabilities || []).map(String))],
    capability_classes: [...new Set((input.capability_classes || []).map(String))],
    invocation: HOST_INVOCATION_MODES.includes(input.invocation)
      ? input.invocation
      : 'unknown',
    programmatic_agent_start: input.programmatic_agent_start === true,
    implementation_kind: 'HOST_NATIVE',
    same_workspace: input.invocation === 'interactive',
    workspace_scope: input.invocation === 'interactive' ? 'existing_project' : 'unknown',
    interactive_execution: input.invocation === 'interactive',
    programmatic_execution: false,
    launches_external_runtime: false,
    requires_docker: false,
    exact_approval: { programmatic: 'UNSUPPORTED', hooked_tool: 'UNSUPPORTED',
      interactive: 'DECLARED_ONLY', intercepted_tier3: 'BLOCKED',
      note: 'Exact dispatch is available only through ForgeOS Local Executor; no universal host interception.' },
    notes: input.notes || [],
  };
}

/**
 * Shared fail-closed responses for interactive-only hosts.
 */
export function interactiveOnlyStartResult(reason = 'host_interactive_only') {
  return {
    ok: false,
    started: false,
    execution_status: 'HOST_INTERACTIVE_REQUIRED',
    reason,
    note: 'Handoff may be prepared; programmatic start is not available',
  };
}

export function interactiveOnlyCancelResult() {
  return {
    ok: false,
    cancelled: false,
    reason: 'no_programmatic_run_handle',
  };
}
