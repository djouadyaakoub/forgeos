/**
 * Action risk model — separates what is being discussed from what will be done
 */
export const ACTION_TYPES = {
  READ: 'READ',
  ANALYZE: 'ANALYZE',
  PLAN: 'PLAN',
  WRITE: 'WRITE',
  EXECUTE: 'EXECUTE',
  DEPLOY: 'DEPLOY',
  DELETE: 'DELETE',
  PRODUCTION_CHANGE: 'PRODUCTION_CHANGE',
};

const ACTION_RISK = {
  READ: 'LOW',
  ANALYZE: 'LOW',
  PLAN: 'LOW',
  WRITE: 'MEDIUM',
  EXECUTE: 'MEDIUM',
  DEPLOY: 'HIGH',
  DELETE: 'HIGH',
  PRODUCTION_CHANGE: 'CRITICAL',
};

export function detectActionType(request = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const explicit = request.action_type || request.signals?.action_type;

  if (explicit && ACTION_TYPES[explicit]) return ACTION_TYPES[explicit];

  if (/do not modify|without modifying|read.?only|without making any modification/i.test(text)) {
    return ACTION_TYPES.READ;
  }
  if (/^explain\b|^analyze\b|^audit\b|^discover\b|^identify\b|^inspect\b/i.test(text.trim())) {
    return ACTION_TYPES.ANALYZE;
  }
  if (/^plan\b|propose\b|design\b(?! system)/i.test(text)) {
    return ACTION_TYPES.PLAN;
  }
  if (/deploy to|ship to|release to|go live|execute deployment/i.test(text)) {
    return ACTION_TYPES.DEPLOY;
  }
  if (/delete\b|remove\b|drop table/i.test(text)) {
    return ACTION_TYPES.DELETE;
  }
  if (/implement\b|add\b|create\b|fix\b|refactor\b|modify\b|update\b|change\b/i.test(text)) {
    return ACTION_TYPES.WRITE;
  }
  if (/run\b|execute\b/i.test(text)) {
    return ACTION_TYPES.EXECUTE;
  }

  return ACTION_TYPES.ANALYZE;
}

export function assessActionRisk(actionType, request = {}) {
  const base = ACTION_RISK[actionType] || 'LOW';
  const text = `${request.objective || ''}`;
  let level = base;

  if (actionType === ACTION_TYPES.READ || actionType === ACTION_TYPES.ANALYZE) {
    level = 'LOW';
  }

  if (/production/i.test(text) && actionType === ACTION_TYPES.DEPLOY) {
    level = 'CRITICAL';
  } else if (/production/i.test(text) && [ACTION_TYPES.WRITE, ACTION_TYPES.EXECUTE].includes(actionType)) {
    level = 'HIGH';
  }

  return {
    action_type: actionType,
    level,
    reasons: [`action=${actionType}`, `base=${base}`],
  };
}

export function isReadOnlyAction(request = {}) {
  const action = detectActionType(request);
  return action === ACTION_TYPES.READ || action === ACTION_TYPES.ANALYZE || action === ACTION_TYPES.PLAN;
}

export function requiresDeploymentExecution(request = {}, deploymentIntent = {}) {
  if (deploymentIntent.requested === true) return true;
  if (deploymentIntent.requested === false) return false;
  const action = detectActionType(request);
  return action === ACTION_TYPES.DEPLOY;
}

export function requiresDeploymentDiscovery(request = {}, deploymentIntent = {}) {
  const text = `${request.objective || ''}`;
  if (/deployment target|deploy setup|deployment configuration|discover deployment/i.test(text)) {
    return true;
  }
  if (deploymentIntent.requested === true) return true;
  return false;
}
