#!/usr/bin/env node
/**
 * Phase 14 — Autonomous Development Intelligence Orchestration tests
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  classifyTaskClasses,
  TASK_CLASSES,
  estimateComplexity,
  assessTaskRisk,
  requiresApprovalInvalidation,
  shouldTriggerResearch,
  shouldTriggerStructure,
  shouldTriggerArchitecture,
  shouldTriggerSecurity,
  shouldTriggerDocs,
  planDevelopmentIntelligenceWorkflow,
  formatWorkflowSummary,
  coordinateDevelopmentWorkflow,
  replanWorkflow,
  createExecutionRecord,
  recordStageEvidence,
  handleRiskEscalation,
  handleAgentFailure,
  computeWorkflowEfficiency,
  finalizeWorkflow,
  discoverCapabilities,
  scoreSpecialist,
  selectBestSpecialist,
  classifyTaskType,
  requiresSecurityReview,
} from '../intelligence/index.mjs';
import { loadEffectiveRules } from '../policy/project-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const SAMPLE = path.join(REPO, 'tests/fixtures/sample-project');
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

function stageAgents(plan) {
  return plan.development_workflow.stages.map((s) => s.agent);
}

function skipped(plan) {
  return plan.development_workflow.skipped_agents || [];
}

console.log('Autonomous Development Intelligence Orchestration (Phase 14)\n');

console.log('--- Task classification ---');
test('multi-label classification FEATURE + DATABASE', () => {
  const c = classifyTaskClasses({ objective: 'Add database migration for users table' });
  assert(c.task_classes.includes(TASK_CLASSES.FEATURE) || c.task_classes.includes(TASK_CLASSES.MIGRATION));
  assert(c.task_classes.includes(TASK_CLASSES.DATABASE) || c.task_classes.includes(TASK_CLASSES.MIGRATION));
});
test('INVESTIGATION for explain requests', () => {
  const c = classifyTaskClasses({ objective: 'Explain backend queue implementation' });
  assert(c.task_classes.includes(TASK_CLASSES.INVESTIGATION));
});

console.log('\n--- Complexity ---');
test('explain task is LOW complexity', () => {
  const cx = estimateComplexity({ objective: 'Explain backend queue implementation' });
  assert(cx.level === 'LOW', cx.level);
});
test('offline sync is HIGH complexity', () => {
  const cx = estimateComplexity({
    objective: 'Design an offline-first synchronization subsystem',
    domains: ['backend', 'mobile', 'database'],
  });
  assert(['HIGH', 'CRITICAL'].includes(cx.level), cx.level);
});

console.log('\n--- Risk (separate from complexity) ---');
test('rename variable LOW risk', () => {
  const r = assessTaskRisk({ objective: 'rename local variable in handler' });
  assert(r.level === 'LOW', r.level);
});
test('migration LOW complexity can be CRITICAL risk', () => {
  const r = assessTaskRisk({ objective: 'change one migration file', signals: { migration_required: true } });
  assert(r.level === 'CRITICAL', r.level);
});
test('risk escalation invalidates approval', () => {
  assert(requiresApprovalInvalidation('LOW', 'HIGH') === true);
  assert(requiresApprovalInvalidation('HIGH', 'HIGH') === false);
});

console.log('\n--- Trigger intelligence ---');
test('research not triggered for explain', () => {
  const t = shouldTriggerResearch({ objective: 'Explain backend queue implementation' });
  assert(t.required === false, t.reason);
});
test('research triggered for unknown technology', () => {
  const t = shouldTriggerResearch({ objective: 'Evaluate technology X for project' });
  assert(t.required === true);
});
test('structure triggered for refactor', () => {
  const t = shouldTriggerStructure({ objective: 'Refactor backend queue module into clearer structure' });
  assert(t.required === true);
});
test('structure not triggered for rename variable', () => {
  const t = shouldTriggerStructure({ objective: 'rename variable x' });
  assert(t.required === false);
});
test('architecture triggered for offline sync', () => {
  const t = shouldTriggerArchitecture(
    { objective: 'Design an offline-first synchronization subsystem' },
    { complexity: { level: 'HIGH' }, task_classes: [TASK_CLASSES.FEATURE] }
  );
  assert(t.required === true);
});
test('security triggered for tenant authorization', () => {
  const t = shouldTriggerSecurity({ objective: 'Change tenant authorization behavior' });
  assert(t.required === true);
});
test('docs not required for rename variable', () => {
  const t = shouldTriggerDocs(
    { objective: 'rename internal variable' },
    { complexity: { level: 'LOW' } }
  );
  assert(t.required === false);
});

console.log('\n--- E2E Scenario A: Simple explain ---');
test('Scenario A — explain queue, minimal workflow', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Explain backend queue implementation' },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  const agents = stageAgents(plan);
  assert(!agents.includes('solution-research'), `research should be skipped: ${agents}`);
  assert(!agents.includes('security'), `security should be skipped: ${agents}`);
  assert(skipped(plan).includes('solution-research') || plan.development_workflow.research.required === false);
  assert(plan.development_workflow.complexity === 'LOW');
});

console.log('\n--- E2E Scenario B: Complex feature ---');
test('Scenario B — offline sync dynamic workflow', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    {
      objective: 'Design an offline-first synchronization subsystem',
      domains: ['backend', 'mobile', 'database'],
    },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' }, capabilities: [] } }
  );
  const agents = stageAgents(plan);
  assert(agents.includes('solution-research'), `expected research: ${agents}`);
  assert(
    agents.includes('architect') || plan.development_workflow.architecture_review.required,
    'architecture required'
  );
  assert(plan.development_workflow.complexity !== 'LOW');
});

console.log('\n--- E2E Scenario C: Refactor ---');
test('Scenario C — refactor workflow', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Refactor backend queue module into clearer structure' },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  const caps = plan.development_workflow.required_capabilities;
  const agents = stageAgents(plan);
  assert(caps.includes('change-impact') || agents.includes('architect'));
  assert(caps.includes('safe-refactor') || agents.includes('codebase-organization'));
});

console.log('\n--- E2E Scenario D: Security-sensitive ---');
test('Scenario D — tenant auth triggers security', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Change tenant authorization behavior' },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  assert(plan.development_workflow.security_review.required === true);
  assert(stageAgents(plan).includes('security'));
});

console.log('\n--- E2E Scenario E: Unknown technology ---');
test('Scenario E — research before architecture', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Evaluate technology X for project' },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  const stages = plan.development_workflow.stages;
  const researchIdx = stages.findIndex((s) => s.agent === 'solution-research');
  const archIdx = stages.findIndex((s) => s.agent === 'architect');
  assert(researchIdx >= 0, 'research stage required');
  if (archIdx >= 0 && researchIdx >= 0) {
    const archStage = stages[archIdx];
    assert(archStage.depends_on.includes('research') || researchIdx < archIdx, 'research before architect');
  }
});

console.log('\n--- E2E Scenario F: Risk escalation / replan ---');
test('Scenario F — replan on discovered migration', () => {
  const original = planDevelopmentIntelligenceWorkflow(
    { objective: 'Add user preference field', signals: {} },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  const replanned = replanWorkflow(
    { objective: 'Add user preference field' },
    { discovered_risk: 'CRITICAL', migration_required: true, reason: 'migration requirement discovered' },
    { previous_risk: original.risk.level, previous_plan: original, project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  assert(replanned.replan === true);
  assert(replanned.approval_invalidation_required === true);
  assert(replanned.pause_required === true);
  assert(replanned.new_plan.risk.level === 'CRITICAL');
});

console.log('\n--- Parallelism & dependencies ---');
test('stages have depends_on for architect after research', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Evaluate new caching technology for API' },
    { project_dir: SAMPLE, project_adapter: { project: { id: 'sample-project' } } }
  );
  const arch = plan.development_workflow.stages.find((s) => s.name === 'architecture-review');
  if (arch) assert(Array.isArray(arch.depends_on));
});

console.log('\n--- Handoff & evidence ---');
test('execution record tracks stages', () => {
  const plan = planDevelopmentIntelligenceWorkflow({ objective: 'Fix bug in handler' }, { project_dir: SAMPLE });
  const ex = createExecutionRecord(plan, { task_id: 'TEST-001' });
  assert(ex.workflow_execution.planned_stages.length > 0);
  recordStageEvidence(ex, 'investigation', { files_inspected: ['src/handler.ts'] });
  assert(ex.workflow_execution.executed_stages.includes('investigation'));
});

console.log('\n--- Agent scoring ---');
test('scoreSpecialist respects path ownership', () => {
  const score = scoreSpecialist('api-specialist', { paths_writable: ['src/**'] }, { paths: ['src/handler.ts'] }, {});
  assert(score.score >= 30);
  assert(score.policy_authoritative === true);
});

console.log('\n--- Multi-agent workflow ---');
test('multi-domain feature plans multiple specialists', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    {
      objective: 'Design offline-first sync across Go backend and Flutter mobile',
      domains: ['backend', 'mobile'],
    },
    {
      project_dir: SAMPLE,
      project_adapter: {
        project: { id: 'sample-project' },
        agents: { 'api-specialist': { paths_writable: ['src/**'] } },
      },
    }
  );
  assert(plan.development_workflow.stages.length >= 2);
});

console.log('\n--- Coordinator integration ---');
test('coordinateDevelopmentWorkflow connects planner to project', () => {
  const result = coordinateDevelopmentWorkflow({
    project_dir: SAMPLE,
    objective: 'Explain backend queue implementation',
    task_id: 'COORD-001',
  });
  assert(result.phase === 'development_intelligence_orchestration');
  assert(result.plan.development_workflow);
  assert(result.user_summary.includes('Task classified as'));
  assert(result.policy_note.includes('Policy Engine'));
});

console.log('\n--- Failure recovery ---');
test('agent failure has max retries and fallback', () => {
  const fb = handleAgentFailure({ name: 'implementation', agent: 'api-specialist' }, { message: 'agent unavailable' });
  assert(fb.max_retries === 2);
  assert(fb.strategy === 'retry');
});

console.log('\n--- Workflow efficiency ---');
test('efficiency metric computed', () => {
  const plan = planDevelopmentIntelligenceWorkflow({ objective: 'Fix typo in README' }, { project_dir: SAMPLE });
  const ex = createExecutionRecord(plan);
  const eff = computeWorkflowEfficiency(ex, plan);
  assert(typeof eff.workflow_efficiency.score === 'number');
});

console.log('\n--- Learning integration ---');
test('finalize produces learning proposal only', () => {
  const plan = planDevelopmentIntelligenceWorkflow({ objective: 'test' }, { project_dir: SAMPLE });
  const ex = createExecutionRecord(plan);
  const fin = finalizeWorkflow(ex, 'SUCCESS');
  assert(fin.learning.proposal_only === true);
  assert(fin.learning.silent_global_modification === false);
});

console.log('\n--- User summary ---');
test('formatWorkflowSummary is readable', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Change tenant authorization behavior' },
    { project_dir: SAMPLE }
  );
  const summary = formatWorkflowSummary(plan.development_workflow);
  assert(summary.includes('Task classified as'));
  assert(summary.includes('Planned:'));
});

console.log('\n--- Project isolation (sample-project) ---');
test('sample-project planner has no Speed Flexy paths', () => {
  const result = coordinateDevelopmentWorkflow({
    project_dir: SAMPLE,
    objective: 'Implement feature',
  });
  const planStr = JSON.stringify(result.plan);
  assert(!planStr.includes('speed-flexy'), 'no speed flexy in plan');
  assert(!planStr.includes('backend-api'), 'no SF specialist hardcoded');
  assert(result.project.id === 'sample-project');
});

test('sample-project uses only its capabilities', () => {
  const rules = loadEffectiveRules(SAMPLE);
  const caps = discoverCapabilities({ capabilities: [] }, { capabilities: [{ id: 'node-api', agent: 'api-specialist' }] });
  assert(caps.some((c) => c.id === 'node-api'));
  assert(!rules.agents['backend-api'], 'SF agent not in sample');
});

console.log('\n--- Speed Flexy read-only ---');
test('Speed Flexy E2E planner read-only', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(SPEED_FLEXY)) return;
  const before = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  const result = coordinateDevelopmentWorkflow({
    project_dir: SPEED_FLEXY,
    objective: 'Explain backend queue implementation',
  });
  const after = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  assert(before === after, 'Speed Flexy must not be modified');
  assert(result.plan.development_workflow.complexity === 'LOW');
});

console.log('\n--- Backward compatibility (Phase 13) ---');
test('legacy classifyTaskType still works', () => {
  assert(classifyTaskType({ objective: 'refactor the auth module structure' }) === 'refactor');
});
test('legacy requiresSecurityReview', () => {
  assert(requiresSecurityReview({ objective: 'update auth middleware' }) === true);
});
test('legacy complex feature triggers security and high complexity', () => {
  const w = planDevelopmentIntelligenceWorkflow({
    objective: 'add payment processing across services',
    domains: ['backend', 'payments', 'api'],
    complexity: 'high',
  });
  assert(w.security_review_required === true);
  assert(['HIGH', 'CRITICAL'].includes(w.complexity.level));
  assert(w.workflow.includes('security') || w.development_workflow.security_review.required);
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
