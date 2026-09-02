/**
 * Development Intelligence Loop — routing re-exports and legacy helpers
 */
import { planDevelopmentIntelligenceWorkflow, formatWorkflowSummary } from './planner.mjs';
import { classifyTaskClasses } from './classification.mjs';
import { shouldTriggerSecurity } from './triggers.mjs';

export { planDevelopmentIntelligenceWorkflow, formatWorkflowSummary };
export { classifyTaskClasses, TASK_CLASSES, taskClassLabel } from './classification.mjs';
export { estimateComplexity } from './complexity.mjs';
export { assessTaskRisk, requiresApprovalInvalidation } from './risk-assessment.mjs';
export {
  shouldTriggerResearch,
  shouldTriggerStructure,
  shouldTriggerArchitecture,
  shouldTriggerSecurity,
  shouldTriggerDocs,
} from './triggers.mjs';

export const TASK_TYPES = {
  SIMPLE_FEATURE: 'simple_feature',
  COMPLEX_FEATURE: 'complex_feature',
  REFACTOR: 'refactor',
  NEW_TECHNOLOGY: 'new_technology',
  STRUCTURE_REVIEW: 'structure_review',
  RELEASE: 'release',
  RESEARCH: 'research',
};

export const SENSITIVE_DOMAINS = [
  'auth', 'database', 'tenant', 'secret', 'payment', 'ledger', 'production', 'permission', 'mcp',
];

export function classifyTaskType(request = {}) {
  return planDevelopmentIntelligenceWorkflow(request).task_type;
}

export function requiresSecurityReview(request = {}) {
  return shouldTriggerSecurity(request).required;
}

export function routeToAgent(capabilityId, registry = {}) {
  const caps = registry.capabilities || [];
  const cap = caps.find((c) => c.id === capabilityId);
  if (!cap) return { agent_id: null, reason: 'capability_not_found' };
  return {
    agent_id: cap.specialist_ids?.[0] || cap.agent || null,
    capability: cap,
    reason: 'capability_match',
  };
}
