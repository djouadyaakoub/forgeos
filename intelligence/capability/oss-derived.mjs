/**
 * OSS-derived capability contract — Stage 17
 *
 * Metadata contract only. Does NOT download, install, or launch OSS applications.
 * OSS provenance → ForgeOS capability → same workspace → host/forgeos execution.
 */
import { IMPLEMENTATION_KINDS } from './implementation-kinds.mjs';

export const OSS_DERIVED_SCHEMA = 'forgeos-oss-derived-capability';
export const OSS_DERIVED_SCHEMA_VERSION = 1;

export const OSS_EXECUTION_MODES = Object.freeze(['host_native', 'forgeos_native']);

/**
 * Validate an OSS-derived capability provenance/execution descriptor.
 * Does not imply an implementation exists.
 */
export function validateOssDerivedCapability(input = {}) {
  const reasons = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, reasons: ['missing_descriptor'] };
  }

  const source = input.source || {};
  if (source.kind !== 'oss') reasons.push('source_kind_must_be_oss');
  if (!source.project) reasons.push('missing_source_project');
  if (!source.license) reasons.push('missing_source_license');
  if (!source.version && !source.reference && !source.version_or_reference) {
    reasons.push('missing_source_version_or_reference');
  }
  if (!source.provenance) reasons.push('missing_source_provenance');

  const execution = input.execution || {};
  if (!OSS_EXECUTION_MODES.includes(execution.mode)) {
    reasons.push('execution_mode_must_be_host_native_or_forgeos_native');
  }

  const authority = input.authority || {};
  if (authority.policy && authority.policy !== 'forgeos') {
    reasons.push('authority_policy_must_be_forgeos');
  }
  if (authority.verification && authority.verification !== 'forgeos') {
    reasons.push('authority_verification_must_be_forgeos');
  }

  // Hard invariant: OSS-derived must not declare external runtime launch
  if (input.launches_external_runtime === true) {
    reasons.push('oss_derived_must_not_launch_external_runtime');
  }
  if (execution.mode === 'optional_runtime' || execution.launches_external_application === true) {
    reasons.push('oss_derived_must_not_launch_external_application');
  }
  if (input.implementation_kind && input.implementation_kind !== IMPLEMENTATION_KINDS.OSS_DERIVED) {
    reasons.push('implementation_kind_must_be_OSS_DERIVED');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    launches_external_runtime: false,
    launches_external_application: false,
    note: 'Metadata contract only — does not claim an OSS implementation is present',
  };
}

/**
 * Normalize a descriptor into a stable record (no secrets, no downloads).
 */
export function normalizeOssDerivedCapability(input = {}) {
  const validation = validateOssDerivedCapability(input);
  const source = input.source || {};
  const execution = input.execution || {};
  const authority = input.authority || {};
  return {
    schema: OSS_DERIVED_SCHEMA,
    schema_version: OSS_DERIVED_SCHEMA_VERSION,
    valid: validation.valid,
    reasons: validation.reasons,
    implementation_kind: IMPLEMENTATION_KINDS.OSS_DERIVED,
    capability_id: input.capability_id || null,
    source: {
      kind: 'oss',
      project: source.project || null,
      license: source.license || null,
      version_or_reference: source.version_or_reference || source.version || source.reference || null,
      provenance: source.provenance || null,
    },
    execution: {
      mode: OSS_EXECUTION_MODES.includes(execution.mode) ? execution.mode : null,
      workspace: 'existing_project',
      launches_external_application: false,
    },
    authority: {
      policy: 'forgeos',
      verification: 'forgeos',
      ...(authority.policy ? { policy: authority.policy } : {}),
      ...(authority.verification ? { verification: authority.verification } : {}),
    },
    launches_external_runtime: false,
    note: validation.note,
  };
}

export function ossDerivedDoesNotLaunchExternalApplication() {
  return true;
}
