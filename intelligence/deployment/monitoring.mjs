/**
 * Post-deploy monitoring — bounded observation window
 */
import { redactObject } from './redact.mjs';

export function planPostDeployMonitoring(profile = {}, context = {}) {
  const window = profile.post_deploy?.observation_window
    || profile.deployment_profile?.post_deploy?.observation_window
    || context.observation_window
    || '10m';

  return {
    capability: 'post-deploy-monitoring',
    observation_window: window,
    signals: ['logs', 'health', 'metrics', 'deployment_status'].filter((s) => context[`has_${s}`] !== false),
    bounded: true,
    indefinite_monitoring: false,
  };
}

export function executePostDeployMonitoring(plan, context = {}) {
  const dryRun = context.dry_run;
  const window = plan.observation_window || '10m';

  const observations = {
    logs: dryRun ? '[dry-run] log scan' : (context.log_errors || []),
    health: context.health_stable !== false ? 'stable' : 'degraded',
    metrics: context.metrics || { error_rate: context.error_rate || 0 },
    deployment_status: context.deployment_status || 'active',
  };

  const alert = !dryRun && (context.error_rate > (context.error_threshold || 0.05) || context.health_stable === false);

  return redactObject({
    capability: 'post-deploy-monitoring',
    observation_window: window,
    observations,
    alert,
    completed_at: new Date().toISOString(),
    dry_run: dryRun,
    status: alert ? 'ALERT' : dryRun ? 'DRY_RUN' : 'OK',
  });
}
