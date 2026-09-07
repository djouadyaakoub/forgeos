/**
 * Governed orchestration bridge — Architecture 2.0 Stage 6
 *
 * Closes:
 *   Planner / Coordinator → executeGoverned()
 *
 * Does NOT call backend.start() directly.
 * Does NOT invent a second policy authority or task identity.
 */
import path from 'node:path';
import { executeGoverned } from '../../runtime/execution.mjs';
import { coordinateDevelopmentWorkflow } from './coordinator.mjs';

/**
 * Plan-only coordination (existing behavior).
 * Re-exported for clarity at the Stage 6 boundary.
 */
export { coordinateDevelopmentWorkflow };

/**
 * Production control-plane closure:
 * Project Intelligence → Plan → Policy → Router → RuntimeBackend (via executeGoverned).
 *
 * @param {object} input — coordinator fields plus governed-execution fields
 * @param {boolean} [input.execute=false] — when false, plan only (backward compatible)
 * @param {boolean} [input.dry_run=false] — when true with execute, preview without backend.start
 * @param {object} [input.operation] — local/runtime operation for governed path
 * @param {object} [input.runtime_registry] — RuntimeBackend registry (not host registry)
 */
export function coordinateGovernedExecution(input = {}) {
  const coordination = coordinateDevelopmentWorkflow(input);
  if (coordination.blocked) {
    return {
      ...coordination,
      phase: coordination.phase || 'blocked_incompatible_environment',
      governed: null,
      control_plane: 'closed_blocked',
    };
  }

  const shouldExecute = input.execute === true || input.dry_run === true;
  if (!shouldExecute) {
    return {
      ...coordination,
      phase: 'development_intelligence_orchestration',
      governed: null,
      control_plane: 'plan_only',
      note: 'Set execute:true or dry_run:true to invoke executeGoverned',
    };
  }

  const taskId =
    input.task_id ||
    coordination.execution?.workflow_execution?.task_id ||
    null;

  if (!taskId) {
    return {
      ...coordination,
      phase: 'governed_execution_blocked',
      blocked: true,
      reason: 'missing_task_id',
      governed: null,
      control_plane: 'blocked_missing_task_id',
      policy_note: 'Governed execution requires task_id — no second task identity invented',
    };
  }

  const projectDir = path.resolve(
    coordination.project?.dir || input.project_dir || process.cwd()
  );

  const governed = executeGoverned({
    task_id: taskId,
    capability_id: input.capability_id || null,
    operation_id: input.operation_id,
    task_scope: input.task_scope,
    exact_approval_id: input.exact_approval_id,
    project_dir: projectDir,
    objective: input.objective || coordination.request?.objective || '',
    operation: input.operation,
    agent_id: input.agent_id || 'codebase-organization',
    allowed_paths: input.allowed_paths,
    forbidden_paths: input.forbidden_paths,
    verification_commands: input.verification_commands,
    evidence_requirements: input.evidence_requirements,
    isolation_requirements: input.isolation_requirements,
    approval_scopes: input.approval_scopes,
    requirements: input.requirements,
    backend_id: input.backend_id,
    registry: input.runtime_registry,
    dry_run: input.dry_run === true,
    execution_id: input.execution_id,
    execution_attempt: input.execution_attempt,
    evaluate_policy: input.evaluate_policy,
    policy_decision: input.policy_decision,
    default_decision: input.default_decision,
    timeout_ms: input.timeout_ms,
  });

  // Propagate lifecycle truth into workflow execution record (no second SoT)
  const execution = coordination.execution;
  if (execution?.workflow_execution) {
    execution.workflow_execution.governed_status = governed.status;
    execution.workflow_execution.governed_lifecycle = governed.lifecycle_status;
    execution.workflow_execution.governed_run_id = governed.run_id || null;
    execution.workflow_execution.governed_backend_id = governed.backend_id || null;
    execution.workflow_execution.governed_execution_id = governed.execution_id || null;
    if (governed.status === 'COMPLETED') {
      execution.workflow_execution.outcome = 'SUCCESS';
      execution.workflow_execution.verification.status = 'passed';
    } else if (governed.status === 'DRY_RUN') {
      execution.workflow_execution.outcome = 'DRY_RUN';
      execution.workflow_execution.verification.status = 'preview';
    } else if (
      governed.status === 'ALREADY_ACTIVE' ||
      governed.status === 'ALREADY_COMPLETED'
    ) {
      execution.workflow_execution.outcome = governed.status;
    } else if (governed.status === 'POLICY_DENIED') {
      execution.workflow_execution.outcome = 'POLICY_DENIED';
      execution.workflow_execution.verification.status = 'blocked';
    } else {
      execution.workflow_execution.outcome = governed.status;
      execution.workflow_execution.verification.status = 'failed';
    }
  }

  return {
    ...coordination,
    phase: 'governed_execution',
    task_id: taskId,
    governed,
    control_plane: 'closed',
    policy_note:
      'Policy Authority retains ALLOW/DENY — executeGoverned is the only production backend.start path',
  };
}
