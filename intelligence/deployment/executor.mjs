/**
 * Deployment execution — policy-gated, never self-approves
 */
import { redactObject } from './redact.mjs';
import { verifyArtifacts } from './artifact.mjs';
import { classifyDeploymentFailure } from './failure.mjs';

const TIER3_OPS = new Set([
  'production_deploy', 'production_rollback', 'production_migration',
  'production_configuration_change', 'credential_environment_mutation',
]);

export function checkDeploymentApproval(plan, approval = {}, context = {}) {
  const env = plan?.deployment_plan?.environment || 'staging';
  const isProduction = env === 'production';
  const required = plan?.deployment_plan?.approvals?.required || isProduction;

  if (!required) return { approved: true, reason: 'approval_not_required' };

  const scopes = plan?.deployment_plan?.approvals?.scopes || [];
  const taskId = plan?.deployment_plan?.task_id;

  if (!approval.granted) {
    return { approved: false, reason: 'missing_approval', block: true };
  }
  if (taskId && approval.task_id && approval.task_id !== taskId) {
    return { approved: false, reason: 'wrong_task_approval', block: true };
  }
  if (approval.scope && scopes.length && !scopes.includes(approval.scope)) {
    return { approved: false, reason: 'wrong_approval_scope', block: true };
  }
  if (approval.agent_id === 'release-deployment') {
    return { approved: false, reason: 'self_approval_forbidden', block: true };
  }
  if (approval.expired) {
    return { approved: false, reason: 'approval_expired', block: true };
  }

  return { approved: true, reason: 'approval_valid' };
}

export function checkDeploymentPolicy(plan, policyResult = {}) {
  if (policyResult.permission === 'deny') {
    return { allowed: false, reason: policyResult.reason || 'policy_denied', block: true };
  }
  const env = plan?.deployment_plan?.environment;
  if (env === 'production' && policyResult.tier === 3 && !policyResult.approved) {
    return { allowed: false, reason: 'tier_3_production_requires_approval', block: true };
  }
  return { allowed: true, reason: 'policy_allowed' };
}

export function executeDeployment(plan, approval = {}, context = {}) {
  const dryRun = context.dry_run || plan?.deployment_plan?.dry_run;
  const checks = {
    policy: checkDeploymentPolicy(plan, context.policy_result || {}),
    approval: checkDeploymentApproval(plan, approval, context),
    environment: context.environment_check || { valid: true },
    artifacts: verifyArtifacts(context.build_evidence || {}, context),
  };

  const blocked = Object.values(checks).some((c) => c.block || c.valid === false || c.approved === false || c.allowed === false);

  if (blocked) {
    const reason = checks.policy.allowed === false ? checks.policy.reason
      : checks.approval.approved === false ? checks.approval.reason
        : checks.artifacts.valid === false ? 'artifact_verification_failed'
          : 'precheck_failed';
    return {
      capability: 'deployment-execute',
      status: 'BLOCKED',
      dry_run: dryRun,
      checks,
      failure: classifyDeploymentFailure(reason),
      deployment_evidence: redactObject({
        task_id: plan?.deployment_plan?.task_id,
        outcome: 'BLOCKED',
        reason,
      }),
    };
  }

  const components = plan?.deployment_plan?.components || [];
  const deploySteps = [];

  for (const comp of components) {
    const cmd = context.deploy_commands?.[comp.name] || `deploy:${comp.provider}:${comp.name}:${comp.environment}`;
    deploySteps.push({
      component: comp.name,
      provider: comp.provider,
      environment: comp.environment,
      command: dryRun ? `[dry-run] ${cmd}` : cmd,
      executed: !dryRun && context.simulate_execute !== false,
    });
  }

  if (context.deploy_failed) {
    return {
      capability: 'deployment-execute',
      status: 'DEPLOY_FAILED',
      dry_run: dryRun,
      checks,
      failure: classifyDeploymentFailure('DEPLOY_FAILED'),
      deployment_evidence: buildEvidence(plan, deploySteps, 'DEPLOY_FAILED', context),
    };
  }

  return {
    capability: 'deployment-execute',
    status: dryRun ? 'DRY_RUN' : 'DEPLOYED',
    dry_run: dryRun,
    checks,
    deploy_steps: deploySteps,
    deployment_evidence: buildEvidence(plan, deploySteps, dryRun ? 'DRY_RUN' : 'DEPLOYED', context),
  };
}

function buildEvidence(plan, deploySteps, outcome, context) {
  return redactObject({
    deployment_evidence: {
      task_id: plan?.deployment_plan?.task_id,
      revision: context.revision || 'HEAD',
      target: deploySteps.map((s) => s.component).join(','),
      environment: plan?.deployment_plan?.environment,
      build: context.build_evidence || {},
      approval: { granted: true, scope: context.approval?.scope },
      deploy: { steps: deploySteps },
      verification: {},
      rollback: { available: plan?.deployment_plan?.rollback?.available },
      outcome,
      dry_run: context.dry_run,
    },
  });
}

export function formatDryRunReport(plan, buildPlan, context = {}) {
  const p = plan?.deployment_plan;
  return {
    dry_run: true,
    target: p?.components?.map((c) => `${c.name} (${c.provider})`).join(', '),
    environment: p?.environment,
    build: buildPlan?.build_plan || [],
    deploy: p?.components?.map((c) => ({
      component: c.name,
      command: `[dry-run] deploy:${c.provider}:${c.name}`,
    })),
    verification: p?.verification,
    rollback: p?.rollback,
    approval_required: p?.approvals?.required,
    policy_tier: p?.environment === 'production' ? 3 : 2,
  };
}
