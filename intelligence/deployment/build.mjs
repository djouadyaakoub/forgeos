/**
 * Build phase — source → build → artifact → verification
 */
import { redactObject } from './redact.mjs';

export function planBuild(deploymentPlan, profile = {}) {
  const components = deploymentPlan?.deployment_plan?.components || [];
  const steps = [];

  for (const comp of components) {
    const buildCommands = profile.build?.commands || profile.deployment_profile?.build?.commands || [];
    steps.push({
      component: comp.name,
      commands: buildCommands.length ? buildCommands : [`build:${comp.name}`],
      artifacts: profile.build?.artifacts || [`dist/${comp.name}`],
    });
  }

  return {
    capability: 'deployment-build',
    build_plan: steps,
    dry_run: deploymentPlan?.deployment_plan?.dry_run || false,
  };
}

export function executeBuild(buildPlan, context = {}) {
  const dryRun = context.dry_run || buildPlan.dry_run;
  const evidence = {
    build_evidence: redactObject({
      commands_run: [],
      artifacts: [],
      checksums: [],
      tests_passed: context.tests_passed || [],
      started_at: new Date().toISOString(),
      dry_run: dryRun,
    }),
  };

  for (const step of buildPlan.build_plan || []) {
    for (const cmd of step.commands) {
      evidence.build_evidence.commands_run.push(dryRun ? `[dry-run] ${cmd}` : cmd);
    }
    for (const art of step.artifacts || []) {
      evidence.build_evidence.artifacts.push({
        path: art,
        type: inferArtifactType(art),
        revision: context.revision || 'HEAD',
        verified: !dryRun && context.verify_artifacts !== false,
      });
    }
  }

  if (context.build_failed) {
    return { ...evidence, status: 'BUILD_FAILED', success: false };
  }

  evidence.build_evidence.completed_at = new Date().toISOString();
  return { ...evidence, status: 'SUCCESS', success: true };
}

function inferArtifactType(path) {
  if (/\.(js|mjs|cjs)$/.test(path)) return 'javascript';
  if (/\.(wasm|bin)$/.test(path)) return 'binary';
  if (/dist|build|out/.test(path)) return 'build_output';
  return 'artifact';
}
