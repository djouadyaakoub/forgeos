/**
 * Rollback planning and execution — approval-gated
 */
import { redactObject } from './redact.mjs';
import { checkDeploymentApproval, checkDeploymentPolicy } from './executor.mjs';
import { classifyDeploymentFailure, getRetryPolicy } from './failure.mjs';

export function createRollbackPlan(deploymentPlan, deployResult = {}) {
  const env = deploymentPlan?.deployment_plan?.environment;
  return {
    rollback_plan: redactObject({
      release_id: deploymentPlan?.deployment_plan?.release_id,
      task_id: deploymentPlan?.deployment_plan?.task_id,
      environment: env,
      supported: deploymentPlan?.deployment_plan?.rollback?.available !== false,
      trigger_conditions: deploymentPlan?.deployment_plan?.rollback?.trigger_conditions || [
        'health_check_failed', 'smoke_test_failed',
      ],
      method: deploymentPlan?.deployment_plan?.rollback?.method || 'revert_previous_release',
      approval_required: true,
      auto_rollback: false,
      previous_revision: deployResult.previous_revision || 'previous',
      created_at: new Date().toISOString(),
    }),
  };
}

export function executeRollback(rollbackPlan, approval = {}, context = {}) {
  const dryRun = context.dry_run;
  const plan = { deployment_plan: {
    environment: rollbackPlan?.rollback_plan?.environment,
    task_id: rollbackPlan?.rollback_plan?.task_id,
    approvals: { required: true, scopes: ['production_rollback'] },
  }};

  const approvalCheck = checkDeploymentApproval(plan, {
    ...approval,
    scope: approval.scope || 'production_rollback',
  }, context);

  const policyCheck = checkDeploymentPolicy(plan, context.policy_result || {});

  if (!approvalCheck.approved || !policyCheck.allowed) {
    return {
      capability: 'rollback-execute',
      status: 'BLOCKED',
      reason: approvalCheck.reason || policyCheck.reason,
      dry_run: dryRun,
      failure: classifyDeploymentFailure('policy_block'),
    };
  }

  if (!rollbackPlan?.rollback_plan?.supported) {
    return {
      capability: 'rollback-execute',
      status: 'BLOCKED',
      reason: 'rollback_not_supported',
    };
  }

  const cmd = `[${dryRun ? 'dry-run' : 'execute'}] rollback:${rollbackPlan.rollback_plan.method}`;

  return {
    capability: 'rollback-execute',
    status: dryRun ? 'DRY_RUN' : 'ROLLED_BACK',
    command: cmd,
    dry_run: dryRun,
    deployment_evidence: redactObject({
      rollback: { executed: !dryRun, method: rollbackPlan.rollback_plan.method },
      outcome: dryRun ? 'DRY_RUN' : 'ROLLED_BACK',
    }),
  };
}

export function isRollbackEligible(failureType, rollbackPlan) {
  const triggers = rollbackPlan?.rollback_plan?.trigger_conditions || [];
  const map = {
    HEALTH_CHECK_FAILED: 'health_check_failed',
    SMOKE_TEST_FAILED: 'smoke_test_failed',
    DEPLOY_FAILED: 'deploy_failed',
  };
  return triggers.includes(map[failureType] || failureType?.toLowerCase());
}
