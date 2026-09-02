/**
 * Deployment intent detection — discovery vs execution
 */
import { detectActionType, ACTION_TYPES } from './action-risk.mjs';

export function detectDeploymentIntent(request = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const evidence = [];

  if (/deploy to|ship to production|release to|go live|execute deployment|run deployment/i.test(text)) {
    evidence.push('explicit deploy execution language');
    return {
      requested: true,
      discovery_only: false,
      target: inferTarget(text),
      environment: inferEnvironment(text),
      evidence,
    };
  }

  if (/discover deployment|deployment target|deployment setup|analyze deployment|inspect deployment/i.test(text)) {
    evidence.push('discovery/analysis language');
    return {
      requested: false,
      discovery_only: true,
      target: inferTarget(text),
      environment: inferEnvironment(text),
      evidence,
    };
  }

  if (/do not modify|without modifying|read.?only/i.test(text)) {
    evidence.push('read-only constraint');
    return {
      requested: false,
      discovery_only: detectActionType(request) === ACTION_TYPES.ANALYZE,
      target: null,
      environment: inferEnvironment(text),
      evidence,
    };
  }

  if (/^explain\b|^analyze\b|^audit\b|^identify\b/i.test(text.trim())) {
    evidence.push('analysis objective');
    return {
      requested: false,
      discovery_only: false,
      target: null,
      environment: inferEnvironment(text),
      evidence,
    };
  }

  return {
    requested: false,
    discovery_only: false,
    target: null,
    environment: inferEnvironment(text),
    evidence: ['no deployment intent detected'],
  };
}

function inferTarget(text) {
  const t = text.toLowerCase();
  if (/admin.?web|pages/i.test(t)) return 'admin-web';
  if (/supabase|migration|database/i.test(t)) return 'database';
  if (/mobile|flutter|apk|pdv|distributeur/i.test(t)) return 'mobile';
  if (/worker|download/i.test(t)) return 'worker';
  if (/backend|api/i.test(t)) return 'backend';
  return null;
}

function inferEnvironment(text) {
  if (/production/i.test(text)) return 'production';
  if (/staging/i.test(text)) return 'staging';
  return null;
}

export function formatDeploymentIntentExplanation(intent = {}) {
  if (intent.requested) return 'Deployment included: explicit deployment execution requested.';
  if (intent.discovery_only) return 'Deployment discovery only: analysis requested without execution.';
  return 'Deployment excluded: no deployment intent detected.';
}
