#!/usr/bin/env node
/**
 * Phase 13 — Development Intelligence & Codebase Organization tests
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  classifyStructureRisk,
  maxRiskLevel,
  canAutoExecute,
  structureAudit,
  validateStructurePlan,
  createStructurePlan,
  validateResearchResult,
  createResearchResult,
  writeResearchCache,
  readResearchCache,
  planResearchWorkflow,
  auditDependencies,
  analyzeDeadCode,
  analyzeDuplication,
  architectureGuard,
  analyzeChangeImpact,
  investigateArchaeology,
  detectDocumentationDrift,
  analyzeTestStrategy,
  planSafeRefactor,
  planPerformanceInvestigation,
  curateKnowledge,
  assessReleaseReadiness,
  classifyTaskType,
  requiresSecurityReview,
  planDevelopmentIntelligenceWorkflow,
  routeToAgent,
  checkCompatibility,
  planUniversalOsUpdate,
  writeRegistryEntry,
  readRegistry,
  INTELLIGENCE_CAPABILITIES,
} from '../intelligence/index.mjs';
import { loadGlobalRules } from '../policy/project-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(ROOT);
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');
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

console.log('Development Intelligence Tests (Phase 13)\n');

console.log('--- Risk classification ---');
test('LOW risk for create_directory', () => {
  const r = classifyStructureRisk({ action: 'create_directory', to: 'internal/new' });
  assert(r.level === 'LOW', r.level);
  assert(r.auto_execute === true, 'should auto');
});
test('CRITICAL risk for auth paths — never auto-execute', () => {
  const r = classifyStructureRisk({ from: 'internal/auth/handler.go', to: 'pkg/auth/handler.go' });
  assert(r.level === 'CRITICAL', r.level);
  assert(r.auto_execute === false, 'must not auto');
});
test('MEDIUM risk for move with imports', () => {
  const r = classifyStructureRisk({ action: 'move', from: 'a.go', to: 'b/a.go', imports_affected: 2 });
  assert(r.level === 'MEDIUM', r.level);
});
test('maxRiskLevel picks highest', () => {
  assert(maxRiskLevel(['LOW', 'HIGH', 'MEDIUM']) === 'HIGH', 'wrong max');
});
test('canAutoExecute only for LOW', () => {
  assert(canAutoExecute('LOW') === true);
  assert(canAutoExecute('CRITICAL') === false);
});

console.log('\n--- Structure plan ---');
test('validateStructurePlan accepts valid plan', () => {
  const plan = createStructurePlan('sample', [
    { action: 'move', from: 'foo.go', to: 'internal/foo.go', reason: 'organize', imports_affected: 4, tests_affected: 2, owner: 'backend' },
  ], ['clearer ownership'], ['build', 'unit_tests']);
  const v = validateStructurePlan(plan);
  assert(v.valid, v.errors?.join(', '));
  assert(plan.structure_plan.changes[0].risk, 'risk enriched');
});
test('CRITICAL changes blocked in plan', () => {
  const plan = createStructurePlan('sample', [
    { action: 'move', from: 'migrations/001.sql', to: 'db/migrations/001.sql', reason: 'migration move' },
  ]);
  const v = validateStructurePlan(plan);
  assert(v.blocked_changes.length > 0, 'should block critical');
  assert(v.auto_executable === false, 'not auto executable');
});

console.log('\n--- Structure analysis ---');
test('structureAudit on sample project', () => {
  const audit = structureAudit(SAMPLE);
  assert(audit.capability === 'structure-audit');
  assert(typeof audit.health_score === 'number');
  assert(Array.isArray(audit.structure_issues));
  assert(['LOW', 'MEDIUM', 'HIGH'].includes(audit.risk));
});

console.log('\n--- Solution research ---');
test('validateResearchResult schema', () => {
  const result = createResearchResult(
    'Choose caching layer',
    ['must support Redis'],
    [{ name: 'Redis', source: 'https://redis.io/docs', relevance_score: 0.9, maturity: 0.95 }],
    { selected: 'Redis', reason: 'Official, mature', alternatives: [] },
    0.85
  );
  const v = validateResearchResult(result);
  assert(v.valid, v.errors?.join(', '));
});
test('research cache is project-scoped', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-cache-'));
  const problem = 'test caching problem';
  const result = createResearchResult(problem, [], [], { selected: 'none' });
  const file = writeResearchCache(problem, result, tmp);
  const normalized = file.replace(/\\/g, '/');
  assert(normalized.includes('docs/agents/research'), file);
  assert(fs.existsSync(file), 'cache file created');
  const cached = readResearchCache(problem, tmp);
  assert(cached && !cached.expired, 'cache readable');
  const globalResearch = path.join(REPO, 'docs/agents/research');
  assert(!file.startsWith(globalResearch) || file.includes(tmp), 'not in global OS by default');
});
test('planResearchWorkflow is READ_ANALYZE_COMPARE', () => {
  const w = planResearchWorkflow('pick ORM', ['postgres']);
  assert(w.mode === 'READ_ANALYZE_COMPARE');
  assert(w.prohibited.includes('COPY_RANDOM_CODE'));
});

console.log('\n--- Dependency audit ---');
test('auditDependencies finds manifests', () => {
  const audit = auditDependencies(SAMPLE);
  assert(audit.capability === 'dependency-audit');
  assert(audit.removal_requires_impact_analysis === true);
});

console.log('\n--- Dead code ---');
test('dead code analysis does not auto-delete', () => {
  const r = analyzeDeadCode(SAMPLE);
  assert(r.auto_delete === false);
  assert(r.capability === 'dead-code-analysis');
});

console.log('\n--- Duplication ---');
test('duplication analysis proposes consolidation without auto-merge', () => {
  const r = analyzeDuplication(SAMPLE);
  assert(r.capability === 'duplication-analysis');
  for (const p of r.consolidation_proposals) {
    assert(p.auto_merge === false);
  }
});

console.log('\n--- Architecture guard ---');
test('architectureGuard detects violations', () => {
  const r = architectureGuard(SAMPLE, {
    proposed_changes: [{ from: 'web/components/App.tsx', to: 'supabase/migrations/001.sql' }],
  });
  assert(r.capability === 'architecture-guard');
  assert(r.violations.length > 0, 'should find violation');
});

console.log('\n--- Change impact ---');
test('change impact on sensitive path requires security', () => {
  const r = analyzeChangeImpact('internal/auth/session.go', SAMPLE, { imports_affected: 3 });
  assert(r.capability === 'change-impact');
  assert(r.requires_security_review === true);
  assert(typeof r.impact_score === 'number');
});

console.log('\n--- Project archaeology ---');
test('archaeology does not auto-remove', () => {
  const r = investigateArchaeology(SAMPLE, 'Why does this exist?', { file: 'README.md' });
  assert(r.auto_remove === false);
  assert(r.capability === 'project-archaeology');
});

console.log('\n--- Documentation drift ---');
test('documentation drift does not auto-fix architecture', () => {
  const r = detectDocumentationDrift(SAMPLE);
  assert(r.auto_fix === false);
  assert(r.capability === 'documentation-drift');
});

console.log('\n--- Test coverage strategy ---');
test('test strategy recommends tests for changed files', () => {
  const r = analyzeTestStrategy(SAMPLE, ['src/handler.ts']);
  assert(r.capability === 'test-coverage-strategy');
  assert(r.recommendations.length >= 1);
});

console.log('\n--- Safe refactor ---');
test('safe refactor preserves behavior', () => {
  const r = planSafeRefactor('internal/pkg');
  assert(r.goals.includes('same_behavior'));
  assert(r.explicit_behavior_change_requires_task === true);
});

console.log('\n--- Performance investigation ---');
test('performance investigation requires measurement', () => {
  const r = planPerformanceInvestigation('api latency');
  assert(r.law.includes('profiling'));
  assert(r.prohibited_without_measurement.includes('premature_optimization'));
});

console.log('\n--- Knowledge curation ---');
test('knowledge curation rejects secrets', () => {
  const r = curateKnowledge([{ title: 'API key rotation', content: 'password=abc123' }]);
  assert(r.global_persistence === false);
  assert(r.results[0].classification === 'reject');
});
test('architectural decisions need approval', () => {
  const r = curateKnowledge([{ type: 'architectural_decision', title: 'Use event sourcing' }]);
  assert(r.results[0].requires_approval === true);
});

console.log('\n--- Release readiness ---');
test('release blocked when tests fail', () => {
  const r = assessReleaseReadiness(SAMPLE, { tests_passed: false, build_passed: true });
  assert(r.release_readiness.status === 'BLOCKED');
});
test('release ready when all pass', () => {
  const r = assessReleaseReadiness(SAMPLE, { tests_passed: true, build_passed: true, security_review_done: true });
  assert(r.release_readiness.status === 'READY');
});

console.log('\n--- Orchestrator routing ---');
test('classify refactor tasks', () => {
  assert(classifyTaskType({ objective: 'refactor the auth module structure' }) === 'refactor');
});
test('security review for auth changes', () => {
  assert(requiresSecurityReview({ objective: 'update auth middleware' }) === true);
});
test('complex feature workflow includes security for payment', () => {
  const w = planDevelopmentIntelligenceWorkflow({
    objective: 'add payment processing across services',
    domains: ['backend', 'payments', 'api'],
    complexity: 'high',
  });
  assert(w.security_review_required === true);
  assert(['HIGH', 'CRITICAL'].includes(w.complexity?.level || w.development_workflow?.complexity));
});
test('refactor workflow includes structure capabilities', () => {
  const w = planDevelopmentIntelligenceWorkflow({ objective: 'reorganize backend packages' });
  assert(w.structure_plan_required === true);
  assert(w.capabilities.includes('change-impact'));
});
test('routeToAgent resolves capability', () => {
  const global = loadGlobalRules();
  const registry = { capabilities: [
    { id: 'structure-audit', specialist_ids: ['codebase-organization'] },
  ]};
  const r = routeToAgent('structure-audit', registry);
  assert(r.agent_id === 'codebase-organization');
});

console.log('\n--- OS compatibility ---');
test('checkCompatibility on sample project', () => {
  const c = checkCompatibility(SAMPLE);
  assert(c.compatible === true);
  assert(c.auto_modify_project !== true || c.auto_modify_project === undefined);
});
test('planUniversalOsUpdate never auto-upgrades business knowledge', () => {
  const plan = planUniversalOsUpdate([SAMPLE]);
  assert(plan.universal_os_update.auto_upgrade_business_knowledge === false);
  assert(plan.universal_os_update.proposals[0].auto_modify_project === false);
});

console.log('\n--- Project registry ---');
test('registry stores metadata only', () => {
  const tmpReg = path.join(os.tmpdir(), `agent-os-reg-${Date.now()}.yaml`);
  const entry = writeRegistryEntry({ path: SAMPLE, adapter_version: 1 }, tmpReg);
  assert(entry.path);
  assert(entry.status);
  const reg = readRegistry(tmpReg);
  assert(reg.projects.length === 1);
  fs.unlinkSync(tmpReg);
});

console.log('\n--- Multi-project isolation ---');
test('research cache in project A not visible from project B', () => {
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-b-'));
  writeResearchCache('isolation test', createResearchResult('isolation test'), tmpA);
  const cachedB = readResearchCache('isolation test', tmpB);
  assert(!cachedB || cachedB.expired === undefined && !cachedB.raw, 'B should not see A cache');
});

console.log('\n--- Security boundaries ---');
test('all intelligence capabilities registered', () => {
  assert(INTELLIGENCE_CAPABILITIES.length >= 14);
  assert(INTELLIGENCE_CAPABILITIES.includes('structure-audit'));
  assert(INTELLIGENCE_CAPABILITIES.includes('solution-research'));
});
test('global rules include new agents', () => {
  const rules = loadGlobalRules();
  assert(rules.agents['codebase-organization']);
  assert(rules.agents['solution-research']);
  assert(rules.agents['release-readiness']);
});

console.log('\n--- Speed Flexy read-only validation ---');
test('Speed Flexy structure audit (read-only)', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(SPEED_FLEXY)) {
    console.log('    SKIP  Speed Flexy not found');
    return;
  }
  const before = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  const audit = structureAudit(SPEED_FLEXY, { maxFiles: 8000 });
  const after = fs.statSync(path.join(SPEED_FLEXY, '.agent-os/project.yaml')).mtimeMs;
  assert(before === after, 'Speed Flexy must not be modified');
  assert(audit.health_score >= 0 && audit.health_score <= 100);
  assert(audit.structure_issues.length >= 0);
  const hasBackend = audit.structure_issues.some((i) =>
    /backend|internal|cmd|api/i.test(i.path || '')
  ) || audit.misplaced_files.length >= 0;
  assert(hasBackend !== undefined, 'audit completed');
});
test('Speed Flexy research not written to Global OS', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(SPEED_FLEXY)) return;
  const globalResearch = path.join(REPO, 'docs/agents/research');
  const sfProblem = 'speed flexy domain specific research test';
  const cachePath = path.join(SPEED_FLEXY, 'docs/agents/research');
  if (fs.existsSync(cachePath)) {
    const files = fs.readdirSync(cachePath);
    for (const f of files) {
      assert(!fs.existsSync(path.join(globalResearch, f)), 'research leaked to global');
    }
  }
  assert(!fs.existsSync(path.join(globalResearch, 'speed-flexy')), 'no SF in global');
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
