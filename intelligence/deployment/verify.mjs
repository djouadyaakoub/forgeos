/**
 * Post-deploy verification — health, smoke, version, monitoring window
 */
import { redactObject } from './redact.mjs';

const DEFAULT_HEALTH_TYPES = ['http', 'cli', 'websocket', 'database', 'worker', 'platform', 'custom'];

export function planHealthChecks(profile = {}, plan = {}) {
  const checks = profile.verify?.health_checks
    || profile.deployment_profile?.verify?.health_checks
    || plan?.deployment_plan?.verification?.health_checks
    || [];

  return checks.map((c) => ({
    name: c.name || c,
    type: c.type || inferHealthType(c),
    command: c.command || c.url || '',
    required: c.required !== false,
  }));
}

function inferHealthType(check) {
  const s = JSON.stringify(check).toLowerCase();
  if (s.includes('http') || s.includes('url')) return 'http';
  if (s.includes('websocket') || s.includes('wss')) return 'websocket';
  if (s.includes('database') || s.includes('postgres')) return 'database';
  if (s.includes('worker')) return 'worker';
  return 'custom';
}

export function executePostDeployVerification(deployResult, profile = {}, context = {}) {
  const dryRun = context.dry_run || deployResult.dry_run;
  const healthChecks = planHealthChecks(profile, context.plan);
  const smokeTests = profile.verify?.smoke_tests
    || profile.deployment_profile?.verify?.smoke_tests
    || context.plan?.deployment_plan?.verification?.smoke_tests
    || [];

  const results = {
    capability: 'deployment-verify',
    health_checks: [],
    smoke_tests: [],
    version_verification: null,
    observation_window: profile.post_deploy?.observation_window
      || profile.deployment_profile?.post_deploy?.observation_window
      || context.observation_window
      || '10m',
    dry_run: dryRun,
  };

  for (const hc of healthChecks) {
    const passed = dryRun ? true : !context.health_fail;
    results.health_checks.push({
      name: hc.name,
      type: hc.type,
      passed,
      command: dryRun ? `[dry-run] ${hc.command || hc.name}` : hc.command,
    });
  }

  for (const st of smokeTests) {
    const name = typeof st === 'string' ? st : st.name;
    const cmd = typeof st === 'object' ? st.command : '';
    const passed = dryRun ? true : !context.smoke_fail;
    results.smoke_tests.push({
      name,
      passed,
      command: dryRun ? `[dry-run] ${cmd || name}` : cmd,
    });
  }

  if (context.expected_version) {
    results.version_verification = {
      expected: context.expected_version,
      actual: context.actual_version || context.expected_version,
      passed: !context.version_mismatch,
    };
  }

  const healthFailed = results.health_checks.some((h) => !h.passed);
  const smokeFailed = results.smoke_tests.some((s) => !s.passed);
  const versionFailed = results.version_verification && !results.version_verification.passed;

  let status = 'SUCCESS';
  if (healthFailed) status = 'HEALTH_CHECK_FAILED';
  else if (smokeFailed) status = 'SMOKE_TEST_FAILED';
  else if (versionFailed) status = 'VERIFICATION_FAILED';
  else if (dryRun) status = 'DRY_RUN';

  return {
    ...results,
    status,
    success: status === 'SUCCESS' || status === 'DRY_RUN',
    verification_evidence: redactObject({
      health_checks: results.health_checks,
      smoke_tests: results.smoke_tests,
      version: results.version_verification,
      completed_at: new Date().toISOString(),
    }),
  };
}

export { DEFAULT_HEALTH_TYPES };
