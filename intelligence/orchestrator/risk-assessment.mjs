/**
 * Task-level risk assessment — subject risk vs action risk
 */
import { maxRiskLevel } from '../risk.mjs';
import { detectActionType, assessActionRisk, ACTION_TYPES } from './action-risk.mjs';

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const SUBJECT_CRITICAL = [
  /migration/i, /ledger/i, /financial/i, /tenant isolation/i,
  /credential/i, /secret/i, /destructive/i, /drop table/i,
];
const SUBJECT_HIGH = [
  /auth/i, /permission/i, /payment/i, /public api/i, /boundary/i,
  /kyc/i, /pii/i, /tenant/i,
];
const SUBJECT_MEDIUM = [
  /database/i, /schema/i, /refactor/i, /cross-component/i, /multi-tenant/i,
  /production/i, /deploy/i,
];

export function assessSubjectRisk(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''} ${(request.paths || []).join(' ')}`;
  const signals = request.signals || {};
  const reasons = [];

  if (signals.migration_required || /migration/i.test(text)) reasons.push('migration topic');
  if (SUBJECT_CRITICAL.some((p) => p.test(text))) reasons.push('critical domain');
  if (SUBJECT_HIGH.some((p) => p.test(text))) reasons.push('high sensitivity topic');
  if (SUBJECT_MEDIUM.some((p) => p.test(text))) reasons.push('medium sensitivity topic');
  if (request.sensitive_flags?.length) reasons.push('explicit sensitive flags');

  let level = 'LOW';
  if (SUBJECT_CRITICAL.some((p) => p.test(text)) || signals.migration_required) level = 'CRITICAL';
  else if (SUBJECT_HIGH.some((p) => p.test(text)) || request.sensitive_flags?.length) level = 'HIGH';
  else if (SUBJECT_MEDIUM.some((p) => p.test(text))) level = 'MEDIUM';

  if (context.discovered_risk) {
    level = maxRiskLevel([level, context.discovered_risk]);
    reasons.push(`discovered: ${context.discovered_risk}`);
  }

  return { level, reasons, type: 'subject' };
}

export function assessTaskRisk(request = {}, context = {}) {
  const subjectRisk = assessSubjectRisk(request, context);
  const actionType = detectActionType(request);
  const actionRisk = assessActionRisk(actionType, request);

  const combinedLevel = maxRiskLevel([subjectRisk.level, actionRisk.level]);

  const requiresApproval =
    ['HIGH', 'CRITICAL'].includes(combinedLevel) &&
    ![ACTION_TYPES.READ, ACTION_TYPES.ANALYZE, ACTION_TYPES.PLAN].includes(actionType);

  return {
    level: combinedLevel,
    subject_risk: subjectRisk.level,
    action_risk: actionRisk.level,
    action_type: actionType,
    reasons: [...subjectRisk.reasons, ...actionRisk.reasons],
    requires_approval: requiresApproval,
    approval_scopes:
      combinedLevel === 'CRITICAL'
        ? ['production_operation', 'migration', 'security_boundary', 'credential_change']
        : combinedLevel === 'HIGH'
          ? ['security_boundary', 'architecture_change']
          : [],
  };
}

export function requiresApprovalInvalidation(previousRisk, newRisk) {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return order[newRisk] > order[previousRisk];
}

export function invalidateApprovalOnActionEscalation(previousAction, newAction) {
  const escalation = {
    READ: 0,
    ANALYZE: 0,
    PLAN: 0,
    WRITE: 1,
    EXECUTE: 2,
    DEPLOY: 3,
    DELETE: 3,
    PRODUCTION_CHANGE: 4,
  };
  return (escalation[newAction] || 0) > (escalation[previousAction] || 0);
}

export { RISK_LEVELS };
