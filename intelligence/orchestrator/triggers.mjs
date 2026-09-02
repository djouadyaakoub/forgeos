/**
 * Trigger intelligence — when to invoke research, structure, architecture, security, docs, archaeology
 */
import { readResearchCache } from '../research/workflow.mjs';

const RESEARCH_TRIGGERS = [
  /new technology/i, /new architecture/i, /unknown protocol/i, /library selection/i,
  /which (library|framework)/i, /performance strategy/i, /security mechanism/i,
  /offline.?first|offline sync/i, /scaling problem/i, /external integration/i,
  /uncertain implementation/i, /evaluate technology/i, /technology x/i,
  /synchronization subsystem/i,
];

const STRUCTURE_TRIGGERS = [
  /many (new|moved) files/i, /new feature director/i, /mixed responsibilit/i,
  /large refactor/i, /module extraction/i, /new subsystem/i, /organize/i,
  /structure audit/i, /reorganize/i, /move files/i, /codebase organization/i,
];

const ARCHITECTURE_TRIGGERS = [
  /new subsystem/i, /public interface/i, /architectural dependenc/i,
  /database boundary/i, /external service/i, /cross-layer/i, /cross-component/i,
  /adr/i, /architecture change/i, /offline.?first/i, /synchronization/i,
];

const SECURITY_TRIGGERS = [
  /auth/i, /permission/i, /tenant/i, /database access/i, /payment/i, /ledger/i,
  /secret/i, /\bmcp\b/i, /credential/i, /sensitive data/i,
  /authorization/i, /kyc/i, /pii/i,
];

const DOCS_TRIGGERS = [
  /architecture/i, /public contract/i, /\bapi\b/i, /database behavior/i,
  /convention/i, /agent capabilit/i, /deployment/i, /adr/i, /new subsystem/i,
];

const ARCHAEOLOGY_TRIGGERS = [
  /unused/i, /old subsystem/i, /mysterious dependenc/i, /unexpected architecture/i,
  /unknown workaround/i, /legacy/i, /why does this exist/i, /seems unused/i,
];

const FAST_CHANGING_TOPICS = [/security library/i, /cursor api/i, /framework version/i, /cloud service/i];

export function shouldTriggerResearch(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const knowledge = context.project_knowledge || {};
  const reasons = [];

  if (RESEARCH_TRIGGERS.some((p) => p.test(text))) reasons.push('keyword match');

  if (context.knowledge_sufficient) {
    return { required: false, reason: 'Existing project knowledge is sufficient', reasons: ['knowledge_override'] };
  }

  if (knowledge.research_cache_hit) {
    const cache = readResearchCache(text, context.project_dir);
    if (cache && !cache.expired) {
      return { required: false, reason: 'Valid research cache exists', cache_path: cache.path };
    }
    if (cache?.expired && FAST_CHANGING_TOPICS.some((p) => p.test(text))) {
      reasons.push('fast-changing topic requires revalidation');
      return { required: true, reason: 'Research cache expired for fast-changing topic', reasons };
    }
    if (cache && !cache.expired) {
      return { required: false, reason: 'Research cache valid', cache_path: cache.path };
    }
  }

  if (request.signals?.unknowns || /unknown|uncertain|evaluate/i.test(text)) {
    reasons.push('uncertainty detected');
  }

  const required = reasons.length > 0 || RESEARCH_TRIGGERS.some((p) => p.test(text));
  if (/explain\b|rename variable/i.test(text) && !/evaluate|research/i.test(text)) {
    return { required: false, reason: 'Simple task does not need research' };
  }

  return { required, reason: required ? reasons.join('; ') : 'No research triggers', reasons };
}

export function shouldTriggerStructure(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const signals = request.signals || {};
  const reasons = [];

  if (STRUCTURE_TRIGGERS.some((p) => p.test(text))) reasons.push('structure keyword');
  if (signals.many_new_files || signals.many_moved_files) reasons.push('file volume');
  if (signals.large_refactor) reasons.push('large refactor');
  if (/refactor/i.test(text)) reasons.push('refactor');

  if (/bug\b|rename variable|explain\b/i.test(text) && !/refactor|organize|structure/i.test(text)) {
    return { required: false, reason: 'Small task — structure agent not needed' };
  }

  return { required: reasons.length > 0, reason: reasons.join('; ') || 'No structure triggers', reasons };
}

export function shouldTriggerArchitecture(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const complexity = context.complexity?.level || 'LOW';
  const reasons = [];

  if (ARCHITECTURE_TRIGGERS.some((p) => p.test(text))) reasons.push('architecture keyword');
  if (complexity === 'HIGH' || complexity === 'CRITICAL') reasons.push('high complexity');
  if (request.domains?.length > 2) reasons.push('multi-domain');
  if (context.task_classes?.includes('ARCHITECTURE_CHANGE')) reasons.push('architecture class');

  if (/explain\b|rename variable/i.test(text) && complexity === 'LOW') {
    return { required: false, reason: 'Low complexity explanation — architect not required' };
  }

  return { required: reasons.length > 0, reason: reasons.join('; ') || 'No architecture triggers', reasons };
}

export function shouldTriggerSecurity(request = {}) {
  const text = `${request.objective || ''} ${request.description || ''} ${(request.paths || []).join(' ')}`;
  const required = SECURITY_TRIGGERS.some((p) => p.test(text)) || request.sensitive_flags?.length > 0;
  return {
    required,
    reason: required ? 'Sensitive domain detected — policy engine retains ALLOW/BLOCK authority' : 'No security triggers',
    policy_authority: 'policy_engine',
  };
}

export function shouldTriggerDocs(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const complexity = context.complexity?.level || 'LOW';
  if (/rename.*variable|internal refactor/i.test(text) && complexity === 'LOW') {
    return { required: false, reason: 'Internal change does not alter documented truth' };
  }

  const classes = context.task_classes || [];
  const docsByClass = classes.some((c) => ['ARCHITECTURE_CHANGE', 'RELEASE'].includes(c));
  const required = DOCS_TRIGGERS.some((p) => p.test(text))
    || ['HIGH', 'CRITICAL'].includes(complexity)
    || docsByClass;

  return { required, reason: required ? 'Documented truth may change' : 'No docs triggers' };
}

export function shouldTriggerArchaeology(request = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const required = ARCHAEOLOGY_TRIGGERS.some((p) => p.test(text));
  return { required, reason: required ? 'Unclear legacy context' : 'No archaeology triggers' };
}

export function shouldTriggerQA(request = {}, context = {}) {
  const classes = context.task_classes || [];
  if (classes.includes('INVESTIGATION') && context.complexity?.level === 'LOW') {
    return { required: false, reason: 'Read-only investigation' };
  }
  if (classes.includes('DOCUMENTATION') && classes.length === 1) {
    return { required: false, reason: 'Docs-only task' };
  }
  if (classes.includes('RESEARCH') && classes.length === 1) {
    return { required: false, reason: 'Research-only task' };
  }
  return { required: true, reason: 'Verification required for implementation work' };
}

export function shouldTriggerRelease(request = {}, context = {}) {
  const classes = context.task_classes || [];
  const required = classes.includes('RELEASE') || /release|deploy readiness|go live/i.test(`${request.objective || ''}`);
  return { required, reason: required ? 'Release-related task' : 'Not a release task' };
}

export function shouldTriggerDeployment(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`;
  const classes = context.task_classes || [];
  const deploymentIntent = context.deployment_intent || {};

  if (deploymentIntent.requested === true) {
    const environment = deploymentIntent.environment || (/production/i.test(text) ? 'production' : 'staging');
    return {
      required: true,
      execution: true,
      discovery_only: false,
      reason: 'Explicit deployment intent',
      environment,
      environment_audit_required: environment === 'production',
    };
  }

  if (deploymentIntent.discovery_only) {
    return {
      required: false,
      execution: false,
      discovery_only: true,
      reason: 'Deployment discovery only — no execution',
      environment: deploymentIntent.environment || null,
      environment_audit_required: false,
    };
  }

  if (/do not modify|without modifying|read.?only/i.test(text)) {
    return { required: false, execution: false, discovery_only: false, reason: 'Read-only task' };
  }
  if (/^explain\b|how does\b|what is\b|discover deployment target/i.test(text) && !/deploy to|release to/i.test(text)) {
    return { required: false, execution: false, discovery_only: /discover|deployment target|deployment setup/i.test(text), reason: 'Investigation — no deployment execution' };
  }
  if (/docs?\s+only|update readme/i.test(text)) {
    return { required: false, execution: false, reason: 'Docs change — no deployment' };
  }

  const required =
    classes.includes('RELEASE') || /deploy to|release to|ship to production|go live/i.test(text);

  const environment = /production/i.test(text) ? 'production' : /staging/i.test(text) ? 'staging' : 'staging';

  return {
    required,
    execution: required,
    discovery_only: false,
    reason: required ? 'Deployment workflow required' : 'No deployment triggers',
    environment,
    environment_audit_required: environment === 'production',
  };
}
