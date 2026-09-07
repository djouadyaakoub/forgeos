/**
 * Capability Resolver — Stages 8 + 12 + 14 + 17
 *
 * Selects implementation type/id. Does NOT execute or authorize.
 * Stage 12: availability vs programmatic executability.
 * Stage 14: Capability → Operation → Implementation.
 * Stage 17: Host-native first; distinguish OSS_DERIVED vs OPTIONAL_RUNTIME.
 *
 * Runtime Router is OPTIONAL programmatic backend selection — not Capability Resolver.
 */
import {
  IMPLEMENTATION_TYPES,
  IMPLEMENTATION_KINDS,
  IMPLEMENTATION_PREFERENCE_ORDER,
  canonicalizeImplementationType,
  implementationTypeToKind,
  launchesExternalRuntime,
  isValidImplementationType,
  getCapabilityBinding,
} from './binding.mjs';
import { POLICY_AUTHORITY } from '../../policy/identity.mjs';
import { discoverHostCapabilities, selectHost } from '../../host/discovery.mjs';
import { getOperation } from './operations.mjs';

const HOST_CAPABILITY_MAP = Object.freeze({
  read: ['host_native', 'forgeos_native'],
  analyze: ['forgeos_native', 'host_native'],
  plan: ['host_native', 'forgeos_native'],
  write: ['host_native', 'oss_derived', 'optional_runtime', 'oss_backed'],
  edit: ['host_native', 'oss_derived', 'optional_runtime', 'oss_backed'],
  refactor: ['host_native', 'oss_derived', 'optional_runtime', 'oss_backed'],
  documentation: ['host_native', 'forgeos_native', 'oss_derived'],
  deploy: ['host_native', 'optional_runtime', 'oss_backed'],
  test: ['host_native', 'forgeos_native'],
});

function asList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return [String(value)];
}

function hostSupports(binding, hostContext, hostDescriptor) {
  const hostCaps = asList(hostContext?.capabilities?.length
    ? hostContext.capabilities
    : hostDescriptor?.capabilities);
  if (!hostCaps.length) return false;
  const toolProfile = String(binding.tool_profile || '');
  if (toolProfile === 'read-explore') {
    return hostCaps.includes('read') || hostCaps.includes('analyze');
  }
  if (toolProfile === 'implement-local') {
    return hostCaps.includes('write')
      || hostCaps.includes('edit')
      || hostCaps.includes('documentation')
      || hostCaps.includes('read');
  }
  if (toolProfile === 'test') return hostCaps.includes('test') || hostCaps.includes('read');
  if (toolProfile === 'release') return hostCaps.includes('deploy');
  return hostCaps.includes('read');
}

function policyCompatibilityNote(policyContext = {}) {
  const decision = policyContext.policy_decision || policyContext;
  if (!decision || typeof decision !== 'object') {
    return {
      policy_authority: POLICY_AUTHORITY,
      policy_checked: false,
      policy_decision: null,
      note: 'Resolver does not evaluate policy — consume Policy Authority separately',
    };
  }
  const permission = decision.decision || decision.permission;
  return {
    policy_authority: decision.authority || POLICY_AUTHORITY,
    policy_checked: true,
    policy_decision: permission || null,
    note: permission === 'deny'
      ? 'Policy DENY present — execution path must remain blocked regardless of resolution'
      : 'Policy context supplied — resolver does not override DENY',
  };
}

function normalizeAllowedTypes(types) {
  const out = [];
  for (const t of types || []) {
    if (!isValidImplementationType(t)) continue;
    // Deduplicate legacy alias with optional_runtime
    const c = canonicalizeImplementationType(t);
    if (c === 'optional_runtime') {
      // Prefer preserving original token if only oss_backed was listed
      if (!out.some((x) => canonicalizeImplementationType(x) === 'optional_runtime')) {
        out.push(t === 'optional_runtime' ? 'optional_runtime' : t);
      }
      continue;
    }
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function pickImplementation(binding, hostContext, preference, hostDescriptor, options = {}) {
  const allowed = normalizeAllowedTypes(
    binding.implementation_types.filter((t) => isValidImplementationType(t))
  );
  const prefRaw = preference || binding.preferred_implementation;
  const prefCanon = canonicalizeImplementationType(prefRaw);
  const order = [];

  // Match preference against allowed (including oss_backed ↔ optional_runtime)
  if (prefRaw) {
    const match = allowed.find((t) => canonicalizeImplementationType(t) === prefCanon);
    if (match) order.push(match);
  }
  for (const t of IMPLEMENTATION_PREFERENCE_ORDER) {
    const match = allowed.find((a) => canonicalizeImplementationType(a) === t);
    if (match && !order.some((o) => canonicalizeImplementationType(o) === t)) {
      order.push(match);
    }
  }

  const ossBackendId = options.runtime_backend_id
    || options.preferred_backend_id
    || options.oss_backend_id
    || null;

  const ossDerivedExecutionMode = options.oss_derived_execution_mode
    || binding.oss_derived_execution_mode
    || 'forgeos_native';

  for (const type of order) {
    const canon = canonicalizeImplementationType(type);
    const kind = implementationTypeToKind(type);

    if (canon === 'host_native' && hostSupports(binding, hostContext, hostDescriptor)) {
      const invocation = hostDescriptor?.invocation || hostContext?.invocation || 'interactive';
      const programmatic = hostDescriptor?.programmatic_agent_start === true;
      return {
        implementation_type: 'host_native',
        implementation_kind: IMPLEMENTATION_KINDS.HOST_NATIVE,
        implementation_id: hostDescriptor?.host_id || hostContext?.host_id || binding.specialist_ids?.[0] || 'host-agent',
        reasons: ['host_native_first', 'host_capabilities_match'],
        available: true,
        executable: programmatic === true,
        invocation: programmatic ? 'programmatic' : (invocation || 'interactive'),
        invocation_detail: programmatic
          ? 'host_programmatic_agent_start'
          : 'host_supports_capability_but_no_programmatic_invocation',
        launches_external_runtime: false,
        requires_runtime_router: false,
        product_path: 'host_native_primary',
        recommended_cli: programmatic ? null : 'forgeos task <task_id>',
      };
    }

    if (canon === 'forgeos_native') {
      return {
        implementation_type: 'forgeos_native',
        implementation_kind: IMPLEMENTATION_KINDS.FORGEOS_NATIVE,
        implementation_id: binding.assessment_module || 'forgeos-native',
        reasons: ['forgeos_native_module', binding.assessment_module],
        available: true,
        executable: true,
        invocation: 'programmatic',
        invocation_detail: 'forgeos_native_module',
        launches_external_runtime: false,
        requires_runtime_router: false,
        product_path: 'forgeos_native_module',
      };
    }

    if (canon === 'oss_derived') {
      const mode = ossDerivedExecutionMode === 'host_native' ? 'host_native' : 'forgeos_native';
      const programmatic = mode === 'forgeos_native'
        || hostDescriptor?.programmatic_agent_start === true;
      return {
        implementation_type: 'oss_derived',
        implementation_kind: IMPLEMENTATION_KINDS.OSS_DERIVED,
        implementation_id: binding.oss_derived_id || binding.assessment_module || 'oss-derived',
        reasons: [
          'oss_derived_capability',
          'does_not_launch_external_application',
          `execution_mode:${mode}`,
        ],
        available: true,
        executable: mode === 'forgeos_native' ? true : programmatic === true,
        invocation: mode === 'host_native' && !programmatic ? 'interactive' : 'programmatic',
        invocation_detail: 'oss_derived_same_workspace_execution',
        launches_external_runtime: false,
        requires_runtime_router: false,
        execution_mode: mode,
        product_path: 'oss_derived_not_launcher',
        note: 'OSS-derived ≠ optional_runtime ≠ external agent launcher',
      };
    }

    if (canon === 'optional_runtime') {
      const legacyAlias = type === 'oss_backed';
      return {
        // Preserve legacy token when registry listed oss_backed (backward compatible)
        implementation_type: legacyAlias ? 'oss_backed' : 'optional_runtime',
        implementation_kind: IMPLEMENTATION_KINDS.OPTIONAL_RUNTIME,
        implementation_id: ossBackendId || 'runtime-router',
        reasons: legacyAlias
          ? [
            'optional_runtime',
            'legacy_alias_oss_backed',
            ossBackendId ? `preferred_backend:${ossBackendId}` : 'delegates_to_optional_programmatic_backend_selector',
          ]
          : [
            'optional_runtime',
            ossBackendId ? `preferred_backend:${ossBackendId}` : 'delegates_to_optional_programmatic_backend_selector',
          ],
        requires_runtime_router: true,
        preferred_backend_id: ossBackendId || null,
        available: true,
        executable: true,
        invocation: 'programmatic',
        invocation_detail: 'optional_programmatic_backend_selector',
        launches_external_runtime: true,
        product_path: 'optional_runtime_not_core',
        legacy_oss_backed_alias: legacyAlias,
        note: 'Optional RuntimeBackend path — not Core; not host-native; not OSS-derived',
      };
    }
  }

  return {
    implementation_type: null,
    implementation_kind: null,
    implementation_id: null,
    reasons: ['no_compatible_implementation'],
    available: false,
    executable: false,
    invocation: 'unknown',
    launches_external_runtime: false,
    requires_runtime_router: false,
  };
}

function enrichResolution(base, picked) {
  return {
    ...base,
    implementation_kind: picked.implementation_kind || implementationTypeToKind(picked.implementation_type),
    launches_external_runtime: picked.launches_external_runtime === true
      || launchesExternalRuntime(picked.implementation_type),
    product_path: picked.product_path || null,
    recommended_cli: picked.recommended_cli || null,
    execution_mode: picked.execution_mode || null,
    legacy_oss_backed_alias: picked.legacy_oss_backed_alias === true,
    note: picked.note || base.note || null,
  };
}

/**
 * Resolve capability (optionally via operation) to an implementation descriptor.
 * Never calls backend.start() or evaluate() as authority.
 */
export function resolveCapability(input = {}) {
  const selection = selectHost({ host_id: input.host_context?.host_id ?? input.host_id ?? input.host_descriptor?.host_id,
    project_dir: input.project_dir || input.facts?.project_dir });
  if (!selection.ok) return {
    resolved: false, available: false, executable: false, implementation_type: null,
    implementation_id: null, reasons: ['unknown_host'], launches_external_runtime: false,
    execution_boundary: 'resolver_does_not_execute',
  };
  const capabilityId = String(input.capability_id || '');
  const binding = input.capability_binding || getCapabilityBinding(capabilityId);
  if (!binding) {
    return {
      capability_id: capabilityId,
      resolved: false,
      available: false,
      executable: false,
      invocation: 'unknown',
      implementation_type: null,
      implementation_kind: null,
      implementation_id: null,
      reasons: ['unknown_capability'],
      evidence_schema: 'capability-assessment',
      verification_strategy: 'none',
      policy: policyCompatibilityNote(input.policy_context),
      execution_boundary: 'resolver_does_not_execute',
      launches_external_runtime: false,
    };
  }

  const operation = input.capability_operation
    || (input.operation_id ? getOperation(input.operation_id) : null);

  if (input.operation_id && !operation) {
    return {
      capability_id: binding.id,
      operation_id: input.operation_id,
      resolved: false,
      available: false,
      executable: false,
      invocation: 'unknown',
      implementation_type: null,
      implementation_kind: null,
      implementation_id: null,
      reasons: ['unknown_operation'],
      evidence_schema: binding.evidence_schema,
      verification_strategy: binding.verification_strategy,
      policy: policyCompatibilityNote(input.policy_context),
      execution_boundary: 'resolver_does_not_execute',
      launches_external_runtime: false,
    };
  }

  if (operation && operation.capability_id !== binding.id) {
    return {
      capability_id: binding.id,
      operation_id: operation.id,
      resolved: false,
      available: false,
      executable: false,
      invocation: 'unknown',
      implementation_type: null,
      implementation_kind: null,
      implementation_id: null,
      reasons: ['operation_capability_mismatch'],
      evidence_schema: binding.evidence_schema,
      verification_strategy: binding.verification_strategy,
      policy: policyCompatibilityNote(input.policy_context),
      execution_boundary: 'resolver_does_not_execute',
      launches_external_runtime: false,
    };
  }

  const effectiveBinding = operation
    ? {
      ...binding,
      implementation_types: (operation.implementation_types || [])
        .filter((t) => binding.implementation_types.some(
          (b) => canonicalizeImplementationType(b) === canonicalizeImplementationType(t)
            || b === t
        ) || binding.implementation_types.includes(t)),
      preferred_implementation: operation.preferred_implementation
        && (operation.implementation_types || []).includes(operation.preferred_implementation)
        ? operation.preferred_implementation
        : binding.preferred_implementation,
      oss_derived_execution_mode: operation.oss_derived_execution_mode
        || binding.oss_derived_execution_mode,
      oss_derived_id: operation.oss_derived_id || binding.oss_derived_id,
    }
    : binding;

  // Fix filter: operation types must be subset of binding (with alias awareness)
  if (operation) {
    effectiveBinding.implementation_types = (operation.implementation_types || []).filter((t) => {
      const ct = canonicalizeImplementationType(t);
      return binding.implementation_types.some(
        (b) => b === t || canonicalizeImplementationType(b) === ct
      );
    });
  }

  if (operation && !effectiveBinding.implementation_types.length) {
    return {
      capability_id: binding.id,
      operation_id: operation.id,
      resolved: false,
      available: false,
      executable: false,
      invocation: 'unknown',
      implementation_type: null,
      implementation_kind: null,
      implementation_id: null,
      reasons: ['operation_implementation_incompatible_with_capability'],
      evidence_schema: binding.evidence_schema,
      verification_strategy: operation.verification_strategy || binding.verification_strategy,
      policy: policyCompatibilityNote(input.policy_context),
      execution_boundary: 'resolver_does_not_execute',
      launches_external_runtime: false,
    };
  }

  const hostDescriptor = (selection.supported ? discoverHostCapabilities({ host_id: selection.host_id }) : input.host_descriptor)
    || discoverHostCapabilities({
      host_id: selection.host_id,
      capabilities: input.host_context?.capabilities,
      invocation: input.host_context?.invocation,
    });

  const preference = input.preference
    || operation?.preferred_implementation
    || effectiveBinding.preferred_implementation;

  const picked = pickImplementation(
    effectiveBinding,
    input.host_context || {},
    preference,
    hostDescriptor,
    {
      runtime_backend_id: input.runtime_backend_id || input.preferred_backend_id || null,
      preferred_backend_id: input.preferred_backend_id || input.runtime_backend_id || null,
      oss_backend_id: input.oss_backend_id || null,
      oss_derived_execution_mode: input.oss_derived_execution_mode
        || effectiveBinding.oss_derived_execution_mode,
    }
  );
  const policy = policyCompatibilityNote(input.policy_context);

  const operationMeta = operation
    ? {
      operation_id: operation.id,
      operation_fingerprint: operation.operation_fingerprint,
      operation_risk: operation.risk,
      operation_type: operation.operation_type,
      expected_effects: operation.expected_effects,
      verification_strategy: operation.verification_strategy,
    }
    : null;

  if (policy.policy_decision === 'deny') {
    return enrichResolution({
      capability_id: binding.id,
      resolved: false,
      available: picked.available === true,
      executable: false,
      invocation: picked.invocation || 'unknown',
      invocation_detail: picked.invocation_detail || null,
      implementation_type: picked.implementation_type,
      implementation_id: picked.implementation_id,
      reasons: [...(picked.reasons || []), 'policy_deny_blocks_execution_path'],
      requirements: {
        specialist_ids: binding.specialist_ids,
        tool_profile: binding.tool_profile,
        approval_tier_max: binding.approval_tier_max,
      },
      evidence_schema: binding.evidence_schema,
      verification_strategy: operation?.verification_strategy || binding.verification_strategy,
      operation: operationMeta,
      policy,
      execution_boundary: 'resolver_does_not_execute',
      deterministic_intelligence_available:
        input.deterministic_intelligence_available === true
        || input.facts?.deterministic_intelligence_available === true
        || false,
      note: 'DENY cannot be overridden by resolver',
    }, picked);
  }

  return enrichResolution({
    capability_id: binding.id,
    resolved: !!picked.implementation_type,
    available: picked.available === true,
    executable: picked.executable === true,
    invocation: picked.invocation || 'unknown',
    invocation_detail: picked.invocation_detail || null,
    implementation_type: picked.implementation_type,
    implementation_id: picked.implementation_id,
    reasons: picked.reasons,
    requirements: {
      specialist_ids: binding.specialist_ids,
      tool_profile: binding.tool_profile,
      approval_tier_max: binding.approval_tier_max,
      paths_writable: operation?.scope?.allowed_paths || binding.paths_writable || [],
      runtime_router_required: picked.requires_runtime_router === true,
    },
    evidence_schema: binding.evidence_schema,
    verification_strategy: operation?.verification_strategy || binding.verification_strategy,
    operation: operationMeta,
    host: {
      host_id: hostDescriptor.host_id,
      invocation: hostDescriptor.invocation,
      programmatic_agent_start: hostDescriptor.programmatic_agent_start === true,
    },
    policy,
    execution_boundary: 'resolver_does_not_execute',
    deterministic_intelligence_available:
      input.deterministic_intelligence_available === true
      || input.facts?.deterministic_intelligence_available === true
      || false,
  }, picked);
}

/**
 * Explicit Capability → Operation → Implementation resolution.
 */
export function resolveCapabilityOperation(input = {}) {
  const operation = input.capability_operation || getOperation(input.operation_id);
  if (!operation) {
    return {
      resolved: false,
      reasons: ['unknown_operation'],
      execution_boundary: 'resolver_does_not_execute',
      launches_external_runtime: false,
    };
  }
  return resolveCapability({
    ...input,
    capability_id: operation.capability_id,
    operation_id: operation.id,
    capability_operation: operation,
  });
}

export function resolverDoesNotExecute() {
  return true;
}

export {
  HOST_CAPABILITY_MAP,
  IMPLEMENTATION_TYPES,
  IMPLEMENTATION_KINDS,
};
