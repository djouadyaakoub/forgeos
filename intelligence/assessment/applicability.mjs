/**
 * Capability applicability — Stage 8
 *
 * Deterministic: APPLICABLE | NOT_APPLICABLE | UNKNOWN
 */
import { APPLICABILITY_STATES } from '../capability/binding.mjs';

const DEPLOYABLE_TYPES = new Set(['application', 'monorepo', 'infrastructure']);

export function evaluateApplicability(binding, facts = {}) {
  const rule = String(binding?.applicability || 'when_initialized');
  const initialized = facts.initialized === true;
  const hasSource = facts.has_source === true;
  const projectType = String(facts.project_type || '').toLowerCase();
  const hasDeployment = facts.has_deployment === true;

  let applicability = 'UNKNOWN';
  let reason = 'insufficient_project_facts';

  switch (rule) {
    case 'always':
      applicability = 'APPLICABLE';
      reason = 'always_applicable';
      break;
    case 'when_initialized':
      if (facts.initialized == null && facts.discovery_mode == null) {
        applicability = 'UNKNOWN';
        reason = 'initialization_unknown';
      } else if (initialized) {
        applicability = 'APPLICABLE';
        reason = 'project_initialized';
      } else {
        applicability = 'NOT_APPLICABLE';
        reason = 'project_uninitialized';
      }
      break;
    case 'when_has_source':
      if (facts.has_source == null) {
        applicability = 'UNKNOWN';
        reason = 'source_presence_unknown';
      } else if (hasSource) {
        applicability = 'APPLICABLE';
        reason = 'source_detected';
      } else if (initialized === false && facts.has_source === false) {
        applicability = 'NOT_APPLICABLE';
        reason = 'no_source_tree';
      } else {
        applicability = 'NOT_APPLICABLE';
        reason = 'no_source_tree';
      }
      break;
    case 'when_application':
      if (!initialized) {
        applicability = initialized === false ? 'NOT_APPLICABLE' : 'UNKNOWN';
        reason = initialized === false ? 'project_uninitialized' : 'type_unknown';
      } else if (!projectType) {
        applicability = 'UNKNOWN';
        reason = 'project_type_undeclared';
      } else if (DEPLOYABLE_TYPES.has(projectType) || projectType === 'application') {
        applicability = 'APPLICABLE';
        reason = `project_type_${projectType}`;
      } else {
        applicability = 'NOT_APPLICABLE';
        reason = `project_type_${projectType || 'unknown'}`;
      }
      break;
    case 'when_deployable':
      if (!initialized) {
        applicability = 'NOT_APPLICABLE';
        reason = 'project_uninitialized';
      } else if (hasDeployment) {
        applicability = 'APPLICABLE';
        reason = 'deployment_declared';
      } else if (projectType === 'library') {
        applicability = 'NOT_APPLICABLE';
        reason = 'library_not_deployable';
      } else if (DEPLOYABLE_TYPES.has(projectType)) {
        applicability = 'APPLICABLE';
        reason = `project_type_${projectType}`;
      } else if (!projectType) {
        applicability = 'UNKNOWN';
        reason = 'deployability_unknown';
      } else {
        applicability = 'NOT_APPLICABLE';
        reason = `project_type_${projectType}`;
      }
      break;
    default:
      applicability = 'UNKNOWN';
      reason = `unknown_applicability_rule:${rule}`;
  }

  if (!APPLICABILITY_STATES.includes(applicability)) {
    applicability = 'UNKNOWN';
  }

  return {
    capability_id: binding?.id || null,
    applicability,
    rule,
    reason,
  };
}
