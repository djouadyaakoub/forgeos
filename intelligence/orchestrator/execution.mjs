/**
 * Workflow execution — replanning, escalation, failure recovery, efficiency, records
 */
import { maxRiskLevel } from '../risk.mjs';
import { requiresApprovalInvalidation } from './risk-assessment.mjs';
import { planDevelopmentIntelligenceWorkflow } from './planner.mjs';

export const DEFAULT_MAX_RETRIES = 2;

export function createExecutionRecord(workflow, context = {}) {
  return {
    workflow_execution: {
      task_id: context.task_id || '',
      task_class: workflow.development_workflow?.task_class || '',
      complexity: workflow.development_workflow?.complexity || '',
      risk: workflow.development_workflow?.risk || '',
      planned_stages: (workflow.development_workflow?.stages || []).map((s) => s.name),
      executed_stages: [],
      skipped_stages: [],
      replans: 0,
      approvals_requested: [],
      approvals_granted: [],
      verification: { status: 'pending', evidence: [] },
      outcome: null,
      started_at: new Date().toISOString(),
    },
  };
}

export function recordStageEvidence(execution, stageName, evidence = {}) {
  const ex = execution.workflow_execution;
  if (!ex.executed_stages.includes(stageName)) ex.executed_stages.push(stageName);
  ex.verification.evidence.push({
    stage: stageName,
    timestamp: new Date().toISOString(),
    files_inspected: evidence.files_inspected || [],
    commands_run: evidence.commands_run || [],
    tests_passed: evidence.tests_passed || [],
    sources_consulted: evidence.sources_consulted || [],
    decisions: evidence.decisions || [],
  });
  return execution;
}

export function validateStageEvidence(stage, evidence = {}) {
  const required = stage.handoff?.evidence_required || [];
  if (!required.length) return { valid: true };
  const missing = required.filter((r) => {
    if (r === 'files_inspected') return !evidence.files_inspected?.length;
    if (r === 'commands_run') return !evidence.commands_run?.length;
    if (r === 'decision') return !evidence.decisions?.length;
    return false;
  });
  return { valid: missing.length === 0, missing };
}

export function replanWorkflow(originalRequest, discovery = {}, context = {}) {
  const newClasses = discovery.discovered_classes || [];
  const newRisk = discovery.discovered_risk || context.risk?.level;
  const updatedRequest = {
    ...originalRequest,
    signals: {
      ...originalRequest.signals,
      migration_required: discovery.migration_required || originalRequest.signals?.migration_required,
      unknowns: true,
    },
    description: `${originalRequest.description || ''} [replan: ${discovery.reason || 'scope changed'}]`.trim(),
  };

  if (newClasses.length) {
    updatedRequest._force_classes = newClasses;
  }

  const newPlan = planDevelopmentIntelligenceWorkflow(updatedRequest, context);
  const previousRisk = context.previous_risk || context.risk?.level || 'LOW';
  const escalated = newRisk && requiresApprovalInvalidation(previousRisk, newRisk);

  return {
    replan: true,
    reason: discovery.reason || 'scope changed during execution',
    previous_plan: context.previous_plan || null,
    new_plan: newPlan,
    risk_escalated: escalated,
    approval_invalidation_required: escalated,
    pause_required: escalated || newPlan.development_workflow?.risk === 'CRITICAL',
    discovered: discovery,
  };
}

export function handleRiskEscalation(execution, previousRisk, newRisk) {
  const invalidated = requiresApprovalInvalidation(previousRisk, newRisk);
  const ex = execution.workflow_execution;
  if (invalidated) {
    ex.approvals_granted = [];
    ex.approvals_requested.push({
      reason: 'risk_escalation',
      from: previousRisk,
      to: newRisk,
      timestamp: new Date().toISOString(),
    });
  }
  ex.risk = newRisk;
  return { invalidated, execution, action: invalidated ? 'pause_and_request_approval' : 'continue' };
}

export function handleAgentFailure(stage, error = {}, options = {}) {
  const maxRetries = options.max_retries ?? DEFAULT_MAX_RETRIES;
  const retries = (stage._retries || 0) + 1;
  const failureType = classifyFailure(error);

  let strategy = 'retry';
  if (retries > maxRetries) strategy = 'escalate';
  if (failureType === 'policy_denied') strategy = 'escalate';
  if (failureType === 'capability_gap') strategy = 'alternate_agent';

  const fallback = {
    agent_failure: true,
    stage: stage.name,
    failure_type: failureType,
    retries,
    max_retries: maxRetries,
    strategy,
    fallback_agent: strategy === 'escalate' ? 'architect' : stage.agent,
    error_message: error.message || 'unknown',
  };

  return fallback;
}

function classifyFailure(error = {}) {
  const msg = String(error.message || error.type || '').toLowerCase();
  if (msg.includes('deny') || msg.includes('policy')) return 'policy_denied';
  if (msg.includes('not found') || msg.includes('unavailable')) return 'agent_unavailable';
  if (msg.includes('capability')) return 'capability_gap';
  return 'transient';
}

export function computeWorkflowEfficiency(execution, workflow) {
  const ex = execution.workflow_execution;
  const planned = ex.planned_stages.length;
  const executed = ex.executed_stages.length;
  const skipped = ex.skipped_stages.length;
  const unnecessary = Math.max(0, executed - planned);
  const parallelizable = (workflow.development_workflow?.stages || []).filter((s) => s.parallelizable).length;

  return {
    workflow_efficiency: {
      required_stages: planned,
      executed_stages: executed,
      skipped_stages: skipped,
      unnecessary_stages: unnecessary,
      parallelization_opportunities: parallelizable,
      replanning_count: ex.replans,
      verification_failures: ex.verification.status === 'failed' ? 1 : 0,
      score: Math.max(0, 100 - unnecessary * 10 - ex.replans * 15 - (ex.verification.status === 'failed' ? 20 : 0)),
    },
  };
}

export function finalizeWorkflow(execution, outcome = 'SUCCESS', learningInput = {}) {
  const ex = execution.workflow_execution;
  ex.outcome = outcome;
  ex.completed_at = new Date().toISOString();
  ex.verification.status = outcome === 'SUCCESS' ? 'passed' : outcome === 'PARTIAL' ? 'partial' : 'failed';

  return {
    execution,
    learning: {
      collect_outcome: true,
      knowledge_curator: true,
      learning_factory: true,
      proposal_only: true,
      silent_global_modification: false,
      input: {
        title: learningInput.title || `Workflow ${ex.task_id}`,
        type: learningInput.type || 'operational_lesson',
        evidence: ex.verification.evidence,
        outcome,
      },
    },
  };
}
