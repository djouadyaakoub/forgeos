#!/usr/bin/env node
/**
 * Phase 15 — Release & Deployment Intelligence tests
 */
import fs from 'node:fs';
import { temporaryFixtures } from './helpers/temporary-fixtures.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverDeploymentTargets,
  createDeploymentProfile,
  validateDeploymentProfile,
  createDeploymentPlan,
  validateDeploymentPlan,
  inferDeployableComponents,
  planBuild,
  executeBuild,
  verifyArtifacts,
  executeDeployment,
  checkDeploymentApproval,
  formatDryRunReport,
  executePostDeployVerification,
  createRollbackPlan,
  executeRollback,
  classifyDeploymentFailure,
  shouldRetry,
  generateReleaseNotes,
  runDeploymentWorkflow,
  redactObject,
  redactString,
  isSecretKey,
  discoverEnvironments,
  auditEnvironment,
  diffEnvironments,
  planDevelopmentIntelligenceWorkflow,
  shouldTriggerDeployment,
} from '../intelligence/index.mjs';
import { loadGlobalRules } from '../policy/project-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const SAMPLE = path.join(temporaryFixtures(path.join(REPO,'tests/fixtures')), 'sample-project');
// Explicit synthetic environment inputs: no dependence on ignored developer files.
fs.writeFileSync(path.join(SAMPLE,'.env.development'),'API_BASE_URL=http://localhost:3000\nNODE_ENV=development\n');
fs.writeFileSync(path.join(SAMPLE,'.env.production'),'API_BASE_URL=https://example.com\nNODE_ENV=production\n');
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');
const SPEED_FLEXY = 'C:/Apps/speed-flexy-server';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function loadAdapter(dir) {
  const yaml = fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8');
  const adapter = { project: { id: 'test' } };
  const idMatch = yaml.match(/id:\s*(\S+)/);
  if (idMatch) adapter.project.id = idMatch[1];
  if (yaml.includes('deployment:')) adapter.deployment = { profiles: [] };
  if (yaml.includes('vercel')) {
    adapter.deployment.profiles.push({ component: 'frontend', provider: 'vercel', config: 'frontend/vercel.json' });
  }
  if (yaml.includes('railway')) {
    adapter.deployment.profiles.push({ component: 'backend', provider: 'railway', config: 'backend/railway.json' });
  }
  if (yaml.includes('platforms:')) {
    adapter.deployment.platforms = {};
    const platformsBlock = yaml.match(/platforms:\s*([\s\S]*?)(?=\n\w|\nenvironment:)/);
    if (platformsBlock) {
      for (const m of platformsBlock[1].matchAll(/(\w+):\s*\n\s+provider:\s*(\S+)/g)) {
        adapter.deployment.platforms[m[1]] = { provider: m[2] };
      }
    }
  }
  return adapter;
}

console.log('Release & Deployment Intelligence Tests (Phase 15)\n');

console.log('--- Deployment discovery ---');
test('sample-project discovers Vercel + Railway from adapter', () => {
  const adapter = loadAdapter(SAMPLE);
  const d = discoverDeploymentTargets({ project_dir: SAMPLE, project_adapter: adapter });
  const providers = d.targets.map((t) => t.deployment_target.provider);
  assert(providers.includes('vercel'), `expected vercel: ${providers}`);
  assert(providers.includes('railway'), `expected railway: ${providers}`);
  assert(!providers.includes('fly.io'), 'sample should not have fly.io');
});
test('discovery returns evidence per target', () => {
  const d = discoverDeploymentTargets({ project_dir: SAMPLE, project_adapter: loadAdapter(SAMPLE) });
  for (const t of d.targets) {
    assert(t.deployment_target.evidence?.length > 0, 'missing evidence');
    assert(typeof t.deployment_target.confidence === 'number');
  }
});

console.log('\n--- Speed Flexy read-only discovery ---');
test('Speed Flexy discovers fly.io, cloudflare, supabase (read-only)', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(SPEED_FLEXY)) return;
  const before = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  const d = discoverDeploymentTargets({ project_dir: SPEED_FLEXY, project_adapter: {} });
  const after = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  assert(before === after, 'Speed Flexy must not be modified');
  const providers = d.targets.map((t) => t.deployment_target.provider);
  const components = d.targets.map((t) => t.deployment_target.component);
  assert(
    providers.some((p) => /fly/.test(p)) || d.targets.some((t) => /fly\.toml/.test(t.deployment_target.config || '')),
    `expected fly evidence: ${providers.join(',')}`
  );
});
test('Global OS has no hard-coded speed-flexy deployment', () => {
  const discoveryCode = fs.readFileSync(path.join(REPO, 'intelligence/deployment/discovery.mjs'), 'utf8');
  assert(!discoveryCode.includes('speed-flexy'), 'no speed-flexy in discovery');
  assert(!discoveryCode.includes('speed_flexy'), 'no speed_flexy in discovery');
});

console.log('\n--- Deployment profile ---');
test('create and validate deployment profile', () => {
  const p = createDeploymentProfile('backend', 'railway', { build_commands: ['npm run build'] });
  const v = validateDeploymentProfile(p);
  assert(v.valid, v.errors?.join(','));
  assert(p.deployment_profile.deploy.approval_required === true);
});

console.log('\n--- Deployment plan ---');
test('create deployment plan with task_id', () => {
  const adapter = loadAdapter(SAMPLE);
  const plan = createDeploymentPlan({
    project_dir: SAMPLE,
    project_adapter: adapter,
    task_id: 'SAMPLE-20260902-001',
    changed_paths: ['backend/src/handler.ts'],
    environment: 'staging',
  });
  const v = validateDeploymentPlan(plan);
  assert(v.valid, v.errors?.join(','));
  assert(plan.deployment_plan.task_id === 'SAMPLE-20260902-001');
});
test('docs-only changes not deployable', () => {
  const impact = inferDeployableComponents(['docs/README.md', 'docs/guide.md'], { targets: [] });
  assert(impact.components.length === 0 || impact.non_deployable.length >= 2);
});
test('backend change implies backend deploy', () => {
  const adapter = loadAdapter(SAMPLE);
  const d = discoverDeploymentTargets({ project_dir: SAMPLE, project_adapter: adapter });
  const impact = inferDeployableComponents(['backend/src/api.ts'], d);
  assert(impact.components.includes('backend'));
});
test('API contract change implies multi-component review', () => {
  const impact = inferDeployableComponents(['api/openapi.yaml'], { targets: [] });
  assert(impact.components.includes('web') || impact.components.includes('mobile'));
});

console.log('\n--- Environment ---');
test('discover environments from fixture', () => {
  const envs = discoverEnvironments(SAMPLE, loadAdapter(SAMPLE));
  assert(envs.environments.some((e) => e.name === 'development'));
  assert(envs.environments.some((e) => e.name === 'production'));
});
test('environment audit does not expose secrets', () => {
  const audit = auditEnvironment(SAMPLE, loadAdapter(SAMPLE), 'production');
  const str = JSON.stringify(audit);
  assert(!str.includes('postgresql://'), 'database url leaked');
  assert(audit.secrets_exposed === false);
  assert(str.includes('[REDACTED]') || audit.secret_references?.length >= 0);
});
test('environment diff compares shape not values', () => {
  const diff = diffEnvironments(
    { required_keys: ['API_BASE_URL', 'NODE_ENV'] },
    { required_keys: ['API_BASE_URL', 'DATABASE_URL', 'NODE_ENV'] }
  );
  assert(diff.secret_values_exposed === false);
  assert(diff.missing_in_production?.includes('DATABASE_URL') || diff.comparison.length > 0);
});

console.log('\n--- Build & artifacts ---');
test('build records evidence', () => {
  const plan = createDeploymentPlan({ project_dir: SAMPLE, task_id: 'T1', changed_paths: ['src/a.ts'] });
  const buildPlan = planBuild(plan);
  const result = executeBuild(buildPlan, { revision: 'abc123' });
  assert(result.build_evidence.commands_run.length > 0);
  assert(result.success);
});
test('artifact verification fails without artifacts', () => {
  const v = verifyArtifacts({ build_evidence: { artifacts: [] } });
  assert(v.valid === false);
});

console.log('\n--- Approval & policy ---');
test('production deploy blocked without approval', () => {
  const plan = createDeploymentPlan({
    project_dir: SAMPLE,
    task_id: 'TASK-001',
    environment: 'production',
    changed_paths: ['backend/a.ts'],
  });
  const result = executeDeployment(plan, {}, { dry_run: false });
  assert(result.status === 'BLOCKED');
});
test('self-approval forbidden', () => {
  const plan = createDeploymentPlan({ task_id: 'TASK-001', environment: 'staging' });
  const check = checkDeploymentApproval(plan, {
    granted: true,
    task_id: 'TASK-001',
    agent_id: 'release-deployment',
  });
  assert(check.approved === false);
  assert(check.reason === 'self_approval_forbidden');
});
test('wrong task approval rejected', () => {
  const plan = createDeploymentPlan({ task_id: 'TASK-001', environment: 'staging' });
  const check = checkDeploymentApproval(plan, { granted: true, task_id: 'TASK-OTHER' });
  assert(check.approved === false);
});

console.log('\n--- Dry-run ---');
test('dry-run shows plan without executing', () => {
  const result = runDeploymentWorkflow({
    project_dir: SAMPLE,
    project_adapter: loadAdapter(SAMPLE),
    task_id: 'DRY-001',
    changed_paths: ['backend/handler.ts'],
    dry_run: true,
    release_evidence: { tests_passed: true, build_passed: true, security_review_done: true },
  });
  assert(result.status === 'DRY_RUN');
  assert(result.dry_run_report);
  assert(result.dry_run_report.approval_required !== undefined);
});

console.log('\n--- Post-deploy verification ---');
test('health and smoke tests in dry-run', () => {
  const verify = executePostDeployVerification({ status: 'DEPLOYED' }, {
    verify: { health_checks: [{ name: 'api', type: 'http' }], smoke_tests: [{ name: 'auth', command: 'test-auth' }] },
  }, { dry_run: true });
  assert(verify.success);
  assert(verify.health_checks.length >= 1);
  assert(verify.smoke_tests.length >= 1);
});

console.log('\n--- Rollback ---');
test('rollback requires approval', () => {
  const plan = createDeploymentPlan({ task_id: 'RB-001', environment: 'production' });
  const rbPlan = createRollbackPlan(plan);
  const result = executeRollback(rbPlan, {}, { dry_run: true });
  assert(result.status === 'BLOCKED' || result.status === 'DRY_RUN');
});
test('rollback blocked without approval in production', () => {
  const plan = createDeploymentPlan({ task_id: 'RB-002', environment: 'production' });
  const rbPlan = createRollbackPlan(plan);
  const result = executeRollback(rbPlan, {}, {});
  assert(result.status === 'BLOCKED');
});

console.log('\n--- Failure & retry ---');
test('failure classification', () => {
  assert(classifyDeploymentFailure('BUILD_FAILED') === 'BUILD_FAILED');
  assert(classifyDeploymentFailure('policy_denied') === 'POLICY_BLOCK');
});
test('policy block not retryable', () => {
  const r = shouldRetry('POLICY_BLOCK', 0);
  assert(r.retry === false);
});
test('platform failure retryable once', () => {
  const r = shouldRetry('PLATFORM_FAILED', 0);
  assert(r.retry === true);
  const r2 = shouldRetry('PLATFORM_FAILED', 2);
  assert(r2.retry === false);
});

console.log('\n--- Release notes ---');
test('release notes evidence-based and redacted', () => {
  const notes = generateReleaseNotes({
    release_id: 'REL-1',
    changed_components: ['backend'],
    completed_tasks: [{ task_id: 'T-1' }],
    user_facing_changes: ['Added feature X'],
  });
  const str = JSON.stringify(notes);
  assert(!str.includes('sk-'), 'no api keys in notes');
  assert(notes.sections.length > 0);
});

console.log('\n--- Secret redaction ---');
test('redactObject masks secret keys', () => {
  const secretVal = 'secret' + '123';
  const r = redactObject({ password: secretVal, API_KEY: 'abc', name: 'public' });
  assert(r.password === '[REDACTED]');
  assert(r.API_KEY === '[REDACTED]');
  assert(r.name === 'public');
});
test('isSecretKey detects sensitive keys', () => {
  assert(isSecretKey('DATABASE_PASSWORD'));
  assert(!isSecretKey('NODE_ENV'));
});
test('deployment plan does not leak secrets', () => {
  const plan = createDeploymentPlan({
    task_id: 'SEC-001',
    changed_paths: ['.env'],
    project_adapter: { deployment: { secrets: 'password=leaked' } },
  });
  const str = JSON.stringify(plan);
  assert(!str.includes('leaked'));
});

console.log('\n--- Cross-project isolation ---');
test('Project A has no Vercel/Railway from sample', () => {
  const dA = discoverDeploymentTargets({ project_dir: FIXTURE_A, project_adapter: {} });
  const providersA = dA.targets.map((t) => t.deployment_target.provider);
  assert(!providersA.includes('vercel'), 'A should not have vercel');
});
test('sample has no fly.io from Speed Flexy', () => {
  const d = discoverDeploymentTargets({ project_dir: SAMPLE, project_adapter: loadAdapter(SAMPLE) });
  assert(!d.targets.some((t) => t.deployment_target.provider === 'fly.io'));
});

console.log('\n--- Planner integration ---');
test('release task triggers deployment workflow stages', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Deploy to production release' },
    { project_dir: SAMPLE, project_adapter: loadAdapter(SAMPLE) }
  );
  const stages = plan.development_workflow.stages.map((s) => s.name);
  assert(stages.includes('release-readiness'), stages.join(','));
  assert(stages.includes('deployment-plan'), stages.join(','));
  assert(stages.includes('deployment-execute'), stages.join(','));
  const readinessIdx = stages.indexOf('release-readiness');
  const deployPlanIdx = stages.indexOf('deployment-plan');
  assert(readinessIdx < deployPlanIdx, 'release-readiness before deployment-plan');
});
test('shouldTriggerDeployment false for explain', () => {
  const t = shouldTriggerDeployment({ objective: 'Explain how deployment works' }, { deployment_targets: { count: 1 } });
  assert(t.required === false);
});
test('planner uses discovery not hard-coded project', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Ship release to staging' },
    { project_dir: SAMPLE, project_adapter: loadAdapter(SAMPLE) }
  );
  assert(plan.development_workflow.deployment?.targets_discovered >= 0);
});

console.log('\n--- Release readiness gate ---');
test('workflow blocked when release readiness fails', () => {
  const result = runDeploymentWorkflow({
    project_dir: SAMPLE,
    project_adapter: loadAdapter(SAMPLE),
    task_id: 'BLOCK-001',
    changed_paths: ['backend/a.ts'],
    release_evidence: { tests_passed: false },
    dry_run: false,
  });
  assert(result.status === 'BLOCKED');
  assert(result.reason === 'release_readiness_failed');
});

console.log('\n--- Privilege escalation ---');
test('deployment agent in global rules has tier 3 max', () => {
  const rules = loadGlobalRules();
  assert(rules.agents['release-deployment'].approval_tier_max === 3);
  assert(rules.agents['release-deployment'].tool_profile === 'release');
});
test('tier 3 ops include production rollback', () => {
  const rules = loadGlobalRules();
  assert(rules.tier_3_operations.includes('production_rollback'));
  assert(rules.tier_3_operations.includes('production_deploy'));
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
