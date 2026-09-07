/**
 * Capability Operation contract — Stage 14
 *
 * Operations describe HOW a capability can address findings.
 * They are NOT execution engines, Policy Authority, or agents.
 */
import crypto from 'node:crypto';
import { IMPLEMENTATION_TYPES } from './binding.mjs';

export const OPERATION_SCHEMA = 'forgeos-capability-operation';
export const OPERATION_SCHEMA_VERSION = 1;

export const OPERATION_TYPES = Object.freeze([
  'remediation',
  'analysis',
  'planning',
  'documentation',
]);

export const OPERATION_RISKS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const VERIFICATION_STRATEGIES = Object.freeze([
  'none',
  'presence',
  'project_verification_commands',
]);

function asList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Validate a capability operation definition.
 */
export function validateCapabilityOperation(op = {}, context = {}) {
  const reasons = [];
  if (!op || typeof op !== 'object') {
    return { valid: false, reasons: ['missing_operation'] };
  }
  if (!op.id) reasons.push('missing_id');
  if (!op.capability_id) reasons.push('missing_capability_id');
  if (!op.name) reasons.push('missing_name');
  if (!op.description) reasons.push('missing_description');
  if (!OPERATION_TYPES.includes(op.operation_type)) reasons.push('invalid_operation_type');
  if (!OPERATION_RISKS.includes(op.risk)) reasons.push('invalid_risk');
  if (!VERIFICATION_STRATEGIES.includes(op.verification_strategy)) {
    reasons.push('missing_or_invalid_verification_strategy');
  }

  const implTypes = asList(op.implementation_types);
  if (!implTypes.length) reasons.push('missing_implementation_types');
  for (const t of implTypes) {
    if (!IMPLEMENTATION_TYPES.includes(t)) reasons.push(`invalid_implementation_type:${t}`);
  }
  if (op.preferred_implementation && !implTypes.includes(op.preferred_implementation)) {
    reasons.push('preferred_implementation_not_in_types');
  }

  if (!op.scope || typeof op.scope !== 'object') {
    reasons.push('missing_scope');
  } else {
    if (!Array.isArray(op.scope.allowed_paths)) reasons.push('invalid_scope_allowed_paths');
  }

  if (!Array.isArray(op.expected_effects)) reasons.push('missing_expected_effects');
  if (!Array.isArray(op.prerequisites)) reasons.push('missing_prerequisites');

  if (op.claims_policy_authority === true) reasons.push('operation_cannot_claim_policy_authority');
  if (op.may_execute === true) reasons.push('operation_cannot_execute');
  if (op.may_authorize === true) reasons.push('operation_cannot_authorize');
  if (op.auto_execute === true) reasons.push('operation_cannot_auto_execute');

  if (context.known_capability_ids instanceof Set) {
    if (op.capability_id && !context.known_capability_ids.has(op.capability_id)) {
      reasons.push('unknown_capability');
    }
  }

  if (context.require_finding_types !== false) {
    if (!Array.isArray(op.applies_to_finding_types)) {
      reasons.push('missing_applies_to_finding_types');
    }
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * Normalize a validated operation into a stable record.
 */
export function normalizeCapabilityOperation(input = {}) {
  const implementation_types = asList(input.implementation_types)
    .filter((t) => IMPLEMENTATION_TYPES.includes(t));
  const preferred = implementation_types.includes(input.preferred_implementation)
    ? input.preferred_implementation
    : implementation_types[0] || null;

  const op = {
    schema: OPERATION_SCHEMA,
    schema_version: OPERATION_SCHEMA_VERSION,
    id: String(input.id || ''),
    capability_id: String(input.capability_id || ''),
    name: String(input.name || ''),
    description: String(input.description || ''),
    operation_type: OPERATION_TYPES.includes(input.operation_type)
      ? input.operation_type
      : 'remediation',
    version: String(input.version || '1.0.0'),
    applies_to_finding_types: asList(input.applies_to_finding_types).sort(),
    input_schema: input.input_schema || {
      findings: 'array',
      project_facts: 'object',
    },
    scope: {
      allowed_paths: asList(input.scope?.allowed_paths),
      forbidden_paths: asList(input.scope?.forbidden_paths).length
        ? asList(input.scope?.forbidden_paths)
        : ['.cursor/**', '.agent-os/**', 'policy/**'],
      notes: String(input.scope?.notes || ''),
    },
    risk: OPERATION_RISKS.includes(input.risk) ? input.risk : 'MEDIUM',
    prerequisites: asList(input.prerequisites).sort(),
    expected_effects: asList(input.expected_effects),
    verification_strategy: VERIFICATION_STRATEGIES.includes(input.verification_strategy)
      ? input.verification_strategy
      : 'none',
    verification_presence: asList(input.verification_presence),
    implementation_types,
    preferred_implementation: preferred,
    claims_policy_authority: false,
    may_execute: false,
    may_authorize: false,
    auto_execute: false,
    authority: 'capability_operation',
    note: 'Operation is a governed specification — not an execution engine',
  };

  op.operation_fingerprint = fingerprintCapabilityOperation(op);
  return op;
}

export function fingerprintCapabilityOperation(op = {}) {
  const canonical = {
    id: op.id,
    capability_id: op.capability_id,
    version: op.version,
    operation_type: op.operation_type,
    applies_to_finding_types: asList(op.applies_to_finding_types).sort(),
    scope: {
      allowed_paths: asList(op.scope?.allowed_paths).sort(),
      forbidden_paths: asList(op.scope?.forbidden_paths).sort(),
    },
    risk: op.risk,
    prerequisites: asList(op.prerequisites).sort(),
    expected_effects: asList(op.expected_effects),
    verification_strategy: op.verification_strategy,
    verification_presence: asList(op.verification_presence).sort(),
    implementation_types: asList(op.implementation_types).sort(),
    preferred_implementation: op.preferred_implementation,
  };
  return crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex').slice(0, 24);
}

/**
 * Fingerprint a task↔operation binding (invalidates when inputs change).
 */
export function fingerprintOperationBinding(input = {}) {
  const payload = {
    operation_id: input.operation_id || input.operation?.id || null,
    operation_fingerprint: input.operation_fingerprint
      || input.operation?.operation_fingerprint
      || null,
    capability_id: input.capability_id || null,
    scope: {
      allowed_paths: asList(input.allowed_paths || input.scope?.allowed_paths).sort(),
      forbidden_paths: asList(input.forbidden_paths || input.scope?.forbidden_paths).sort(),
      affected_files: asList(input.affected_files).sort(),
    },
    project_intelligence_fingerprint: input.project_intelligence_fingerprint || null,
    finding_ids: asList(input.finding_ids).sort(),
    finding_fingerprints: asList(input.finding_fingerprints).sort(),
    verification_strategy: input.verification_strategy || null,
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 24);
}

export function createCapabilityOperation(input = {}, context = {}) {
  const normalized = normalizeCapabilityOperation(input);
  const validation = validateCapabilityOperation(normalized, context);
  return {
    valid: validation.valid,
    reasons: validation.reasons,
    operation: validation.valid ? normalized : null,
  };
}
