/**
 * Full deployment workflow orchestration
 */
import { discoverDeploymentTargets } from './discovery.mjs';
import { createDeploymentPlan, validateDeploymentPlan } from './plan.mjs';
import { planBuild, executeBuild } from './build.mjs';
import { verifyArtifacts } from './artifact.mjs';
import { executeDeployment, formatDryRunReport } from './executor.mjs';
import { executePostDeployVerification } from './verify.mjs';
import { createRollbackPlan, executeRollback, isRollbackEligible } from './rollback.mjs';
import { classifyDeploymentFailure, shouldRetry, diagnoseFailure } from './failure.mjs';
import { generateReleaseNotes } from './release-notes.mjs';
import { planPostDeployMonitoring, executePostDeployMonitoring } from './monitoring.mjs';
import { auditEnvironment } from '../environment/audit.mjs';
import { assessReleaseReadiness } from '../release/readiness.mjs';
import { redactObject } from './redact.mjs';

export function runDeploymentWorkflow(options = {}) {
  const dryRun = options.dry_run || false;
  const projectDir = options.project_dir;
  const adapter = options.project_adapter || {};
  const context = { ...options, dry_run: dryRun, project_dir: projectDir };

  const discovery = options.discovery || discoverDeploymentTargets({
    project_dir: projectDir,
    project_adapter: adapter,
  });

  if (options.release_readiness_required !== false) {
    const readiness = assessReleaseReadiness(projectDir, options.release_evidence || {});
    if (readiness.release_readiness.status === 'BLOCKED' && !dryRun) {
      return {
        status: 'BLOCKED',
        reason: 'release_readiness_failed',
        readiness,
        deployment_evidence: redactObject({ outcome: 'BLOCKED', reason: 'release_readiness' }),
      };
    }
    context.readiness = readiness;
  }

  if (options.environment === 'production' || options.environment_audit) {
    context.environment_audit = auditEnvironment(projectDir, adapter, options.environment || 'production');
    if (context.environment_audit.status === 'BLOCKED' && !dryRun) {
      return {
        status: 'BLOCKED',
        reason: 'environment_audit_failed',
        environment_audit: context.environment_audit,
      };
    }
  }

  const plan = createDeploymentPlan({
    project_dir: projectDir,
    project_adapter: adapter,
    discovery,
    changed_paths: options.changed_paths || [],
    environment: options.environment || 'staging',
    task_id: options.task_id,
    release_id: options.release_id,
    dry_run: dryRun,
  });

  const planValidation = validateDeploymentPlan(plan);
  if (!planValidation.valid) {
    return { status: 'BLOCKED', reason: 'invalid_deployment_plan', errors: planValidation.errors };
  }

  const buildPlan = planBuild(plan, adapter.deployment?.profiles?.[0] || {});
  const buildResult = executeBuild(buildPlan, { ...context, dry_run: dryRun });
  if (!buildResult.success && !dryRun) {
    return {
      status: 'BUILD_FAILED',
      failure: classifyDeploymentFailure('BUILD_FAILED'),
      diagnosis: diagnoseFailure('BUILD_FAILED', context),
      build: buildResult,
    };
  }

  const artifactCheck = verifyArtifacts(buildResult, context);
  if (!artifactCheck.valid && !dryRun) {
    return {
      status: 'VERIFICATION_FAILED',
      artifact_check: artifactCheck,
      failure: classifyDeploymentFailure('VERIFICATION_FAILED'),
    };
  }

  if (dryRun) {
    return {
      status: 'DRY_RUN',
      dry_run_report: formatDryRunReport(plan, buildPlan, context),
      plan,
      discovery,
      build: buildResult,
      artifact_check: artifactCheck,
    };
  }

  const deployResult = executeDeployment(plan, options.approval || {}, {
    ...context,
    build_evidence: buildResult,
    policy_result: options.policy_result,
  });

  if (deployResult.status === 'BLOCKED' || deployResult.status === 'DEPLOY_FAILED') {
    const failureType = deployResult.failure || classifyDeploymentFailure(deployResult.status);
    const retry = shouldRetry(failureType, options.attempt || 0);
    return {
      ...deployResult,
      retry,
      diagnosis: diagnoseFailure(failureType, context),
      rollback_plan: createRollbackPlan(plan, deployResult),
    };
  }

  const profile = adapter.deployment?.profiles?.[0] || {};
  const verifyResult = executePostDeployVerification(deployResult, profile, {
    ...context,
    plan,
    dry_run: dryRun,
  });

  const monitoringPlan = planPostDeployMonitoring(profile, context);
  const monitoringResult = executePostDeployMonitoring(monitoringPlan, context);

  if (!verifyResult.success) {
    const rollbackPlan = createRollbackPlan(plan, deployResult);
    const eligible = isRollbackEligible(verifyResult.status, rollbackPlan);
    return {
      status: verifyResult.status,
      deploy: deployResult,
      verify: verifyResult,
      monitoring: monitoringResult,
      rollback_plan: rollbackPlan,
      rollback_eligible: eligible,
      failure: classifyDeploymentFailure(verifyResult.status),
    };
  }

  const releaseNotes = generateReleaseNotes({
    release_id: plan.deployment_plan.release_id,
    changed_components: plan.deployment_plan.components.map((c) => c.name),
    completed_tasks: options.completed_tasks || [{ task_id: options.task_id }],
    deployment_notes: [`Deployed to ${plan.deployment_plan.environment}`],
  });

  return redactObject({
    status: 'SUCCESS',
    discovery,
    plan,
    build: buildResult,
    deploy: deployResult,
    verify: verifyResult,
    monitoring: monitoringResult,
    release_notes: releaseNotes,
    deployment_evidence: {
      ...deployResult.deployment_evidence?.deployment_evidence,
      verification: verifyResult.verification_evidence,
      monitoring: monitoringResult,
      outcome: 'SUCCESS',
    },
  });
}
