/**
 * Deployment plan — required before any deployment execution
 */
import { redactObject } from './redact.mjs';
import { discoverDeploymentTargets } from './discovery.mjs';
import { analyzeChangeImpact } from '../change-impact/analyzer.mjs';

const NON_DEPLOYABLE_PATTERNS = [
  /^docs\//i, /^README/i, /\.md$/i, /^\.github\/ISSUE/i,
];

const COMPONENT_PATH_HINTS = {
  backend: [/backend\//i, /server\//i, /api\//i, /cmd\//i, /internal\//i, /\.go$/i],
  web: [/web\//i, /frontend\//i, /app\//i, /pages\//i, /wrangler/i],
  mobile: [/mobile\//i, /flutter\//i, /pubspec/i],
  database: [/supabase\/migrations/i, /migrations\//i, /schema/i],
  superadmin: [/superadmin\//i, /admin\//i],
};

export function inferDeployableComponents(changedPaths = [], discovery = {}) {
  const components = new Set();
  const nonDeploy = [];

  for (const p of changedPaths) {
    const rel = String(p).replace(/\\/g, '/');
    if (NON_DEPLOYABLE_PATTERNS.some((pat) => pat.test(rel))) {
      nonDeploy.push({ path: rel, reason: 'documentation or non-deployable' });
      continue;
    }

    let matched = false;
    for (const [component, patterns] of Object.entries(COMPONENT_PATH_HINTS)) {
      if (patterns.some((pat) => pat.test(rel))) {
        components.add(component);
        matched = true;
      }
    }
    if (!matched && !rel.startsWith('docs/')) {
      components.add('backend');
    }
  }

  const targets = discovery.targets || [];
  const available = new Set(targets.map((t) => t.deployment_target?.component).filter(Boolean));
  const deployable = [...components].filter((c) => available.size === 0 || available.has(c) || c === 'backend');

  if (changedPaths.some((p) => /contract|openapi|api\.yaml/i.test(p))) {
    deployable.push('web', 'mobile');
  }

  return {
    components: [...new Set(deployable)],
    non_deployable: nonDeploy,
    evidence_based: true,
  };
}

export function createDeploymentPlan(options = {}) {
  const projectDir = options.project_dir;
  const changedPaths = options.changed_paths || [];
  const discovery = options.discovery || discoverDeploymentTargets({
    project_dir: projectDir,
    project_adapter: options.project_adapter,
  });
  const impact = inferDeployableComponents(changedPaths, discovery);
  const environment = options.environment || 'staging';
  const isProduction = environment === 'production';

  const components = (options.components || impact.components).map((name) => {
    const target = discovery.targets.find((t) => t.deployment_target.component === name);
    return {
      name,
      provider: target?.deployment_target?.provider || options.project_adapter?.deployment?.platforms?.[name]?.provider || 'unknown',
      environment,
      config: target?.deployment_target?.config || '',
      evidence: target?.deployment_target?.evidence || [],
    };
  });

  const changes = changedPaths.map((p) => {
    const rel = String(p).replace(/\\/g, '/');
    const impactResult = analyzeChangeImpact(rel, projectDir || '.', { reason: 'deployment' });
    return {
      path: rel,
      impact: impactResult.deployment_impact?.join(',') || inferImpactLabel(rel),
      risk_level: impactResult.risk_level,
    };
  });

  return {
    deployment_plan: redactObject({
      release_id: options.release_id || `REL-${Date.now()}`,
      task_id: options.task_id || '',
      components,
      changes,
      build: { required: components.length > 0 },
      approvals: {
        required: isProduction || options.approval_required !== false,
        scopes: isProduction ? ['production_deploy'] : ['staging_deploy'],
        task_bound: true,
        operation_bound: true,
      },
      verification: {
        health_checks: options.health_checks || [],
        smoke_tests: options.smoke_tests || [],
      },
      rollback: {
        available: isProduction,
        trigger_conditions: ['health_check_failed', 'smoke_test_failed'],
        approval_required: true,
      },
      risks: changes.filter((c) => ['HIGH', 'CRITICAL'].includes(c.risk_level)).map((c) => c.path),
      environment,
      dry_run: options.dry_run || false,
      created_at: new Date().toISOString(),
    }),
  };
}

function inferImpactLabel(p) {
  if (/migration/i.test(p)) return 'database';
  if (/api|openapi|contract/i.test(p)) return 'api_contract';
  if (/backend|server/i.test(p)) return 'backend';
  if (/web|frontend/i.test(p)) return 'web';
  return 'general';
}

export function validateDeploymentPlan(plan) {
  const errors = [];
  const p = plan?.deployment_plan;
  if (!p) errors.push('missing deployment_plan');
  if (!p?.task_id && !p?.release_id) errors.push('missing task_id or release_id');
  if (!Array.isArray(p?.components)) errors.push('components must be array');
  return { valid: errors.length === 0, errors };
}

export function deploymentDiff(current = {}, candidate = {}) {
  return {
    capability: 'deployment-diff',
    current: {
      version: current.version || 'unknown',
      revision: current.revision || 'unknown',
      components: current.components || [],
    },
    candidate: {
      version: candidate.version || 'unknown',
      revision: candidate.revision || 'unknown',
      components: candidate.components || [],
    },
    configuration_changes: candidate.config_changes || [],
    migration_changes: candidate.migration_changes || [],
  };
}
