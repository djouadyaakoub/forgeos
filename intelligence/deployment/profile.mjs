/**
 * Deployment profile — project-scoped deployment configuration shape
 */
import { redactObject } from './redact.mjs';

export function createDeploymentProfile(component, provider, options = {}) {
  return {
    deployment_profile: redactObject({
      component,
      provider,
      build: {
        commands: options.build_commands || [],
        artifacts: options.artifacts || [],
      },
      deploy: {
        commands: options.deploy_commands || [],
        approval_required: options.approval_required !== false,
      },
      verify: {
        health_checks: options.health_checks || [],
        smoke_tests: options.smoke_tests || [],
      },
      rollback: {
        supported: options.rollback_supported !== false,
        method: options.rollback_method || '',
        approval_required: true,
      },
      post_deploy: {
        observation_window: options.observation_window || '10m',
      },
      environment: options.environment || 'staging',
    }),
  };
}

export function validateDeploymentProfile(profile) {
  const errors = [];
  const p = profile?.deployment_profile || profile;
  if (!p?.component) errors.push('missing component');
  if (!p?.provider) errors.push('missing provider');
  if (!p?.deploy) errors.push('missing deploy section');
  return { valid: errors.length === 0, errors };
}

export function profilesFromAdapter(adapter = {}) {
  const profiles = [];
  if (adapter.deployment?.profiles?.length) {
    for (const p of adapter.deployment.profiles) {
      profiles.push(createDeploymentProfile(p.component, p.provider, p));
    }
  }
  if (adapter.deployment?.platforms) {
    for (const [component, cfg] of Object.entries(adapter.deployment.platforms)) {
      profiles.push(createDeploymentProfile(component, cfg.provider, {
        build_commands: cfg.build?.commands,
        deploy_commands: cfg.deploy?.commands,
        health_checks: cfg.verify?.health_checks,
        smoke_tests: cfg.verify?.smoke_tests,
        environment: cfg.environment,
      }));
    }
  }
  return profiles;
}
