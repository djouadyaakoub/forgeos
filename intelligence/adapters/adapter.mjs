/**
 * Intelligence Adapter contract — Stage 13
 *
 * External analyzers are INTELLIGENCE PROVIDERS only.
 * They must not authorize, execute, mutate, or verify.
 */
import { POLICY_AUTHORITY } from '../../policy/identity.mjs';

export const INTELLIGENCE_ADAPTER_SCHEMA = 'forgeos-intelligence-adapter';
export const NORMALIZATION_VERSION = '1.0.0-stage13';

export const EVIDENCE_CLASSES = Object.freeze([
  'deterministic',
  'heuristic',
  'insufficient',
]);

/**
 * Validate an intelligence adapter against Stage 13 boundaries.
 */
export function validateIntelligenceAdapter(adapter = {}) {
  const reasons = [];
  if (!adapter || typeof adapter !== 'object') {
    return { valid: false, reasons: ['missing_adapter'] };
  }
  if (!adapter.id) reasons.push('missing_id');
  if (!adapter.name) reasons.push('missing_name');
  if (!adapter.version) reasons.push('missing_version');
  if (!Array.isArray(adapter.capabilities)) reasons.push('missing_capabilities');
  if (!Array.isArray(adapter.supported_languages)) reasons.push('missing_supported_languages');

  for (const fn of ['health', 'canAnalyze', 'analyze', 'normalize']) {
    if (typeof adapter[fn] !== 'function') reasons.push(`missing_${fn}`);
  }

  if (adapter.claims_policy_authority === true) {
    reasons.push('adapter_cannot_claim_policy_authority');
  }
  if (adapter.claims_project_intelligence_authority === true) {
    reasons.push('adapter_cannot_claim_project_intelligence_authority');
  }
  if (adapter.claims_canvas_authority === true) {
    reasons.push('adapter_cannot_claim_canvas_authority');
  }
  if (adapter.may_mutate === true) {
    reasons.push('adapter_cannot_mutate');
  }
  if (adapter.may_execute === true) {
    reasons.push('adapter_cannot_execute');
  }
  if (adapter.authority && !['intelligence_provider', 'intelligence_adapter'].includes(adapter.authority)) {
    reasons.push('invalid_authority_claim');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    policy_authority: POLICY_AUTHORITY,
    note: 'Intelligence adapters never become Policy Authority or Project Intelligence Authority',
  };
}

/**
 * Fail-closed unavailable analyze result (no fake data).
 */
export function unavailableAnalyzeResult(reason, extra = {}) {
  return {
    ok: false,
    status: 'unavailable',
    reason,
    raw: null,
    facts: null,
    evidence_class: 'insufficient',
    ...extra,
  };
}

/**
 * Stable project context for analyzers (read-only descriptors).
 */
export function createProjectContext(input = {}) {
  return {
    project_dir: input.project_dir || null,
    project_id: input.project_id || null,
    project_intelligence_fingerprint: input.project_intelligence_fingerprint || null,
    files: Array.isArray(input.files) ? [...input.files].sort() : [],
    max_files: input.max_files || 2000,
    max_file_bytes: input.max_file_bytes || 200_000,
    changed_files: Array.isArray(input.changed_files)
      ? [...input.changed_files].sort()
      : [],
  };
}
