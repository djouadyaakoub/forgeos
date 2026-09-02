#!/usr/bin/env node
/**
 * Universal Agent OS test matrix
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverProject, loadEffectiveRules, checkAgentOsCompatibility } from '../policy/project-adapter.mjs';
import { dryRunScenario } from '../policy/engine.mjs';
import { validateEphemeralSpec, generateAgentId } from '../policy/ephemeral-factory.mjs';
import { createLearningProposal } from '../policy/learning-factory.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(ROOT);
const FIXTURE_A = path.join(ROOT, 'fixtures/project-a');
const FIXTURE_B = path.join(ROOT, 'fixtures/project-b');
const FIXTURE_EMPTY = path.join(ROOT, 'fixtures/empty-project');

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

console.log('Universal Agent OS Test Matrix\n');

// Existing project simulation
console.log('--- Existing project ---');
test('Project A is INITIALIZED', () => {
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const d = discoverProject(FIXTURE_A);
  assert(d.mode === 'INITIALIZED', `expected INITIALIZED got ${d.mode}`);
});
test('Project A loads postgres-specialist', () => {
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const rules = loadEffectiveRules(FIXTURE_A);
  assert(rules.agents['postgres-specialist'], 'missing postgres-specialist');
});

// New project
console.log('\n--- New project ---');
test('Empty project is UNINITIALIZED', () => {
  process.env.AGENT_OS_TEST_DIR = FIXTURE_EMPTY;
  const d = discoverProject(FIXTURE_EMPTY);
  assert(d.mode === 'UNINITIALIZED', `expected UNINITIALIZED got ${d.mode}`);
});

// Multi-project isolation
console.log('\n--- Multi-project ---');
test('Project A and B have different capabilities', () => {
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const rulesA = loadEffectiveRules(FIXTURE_A);
  process.env.AGENT_OS_TEST_DIR = FIXTURE_B;
  const rulesB = loadEffectiveRules(FIXTURE_B);
  assert(rulesA.agents['postgres-specialist'], 'A missing postgres');
  assert(rulesB.agents['sqlite-specialist'], 'B missing sqlite');
  assert(!rulesA.agents['sqlite-specialist'], 'A leaked sqlite');
  assert(!rulesB.agents['postgres-specialist'], 'B leaked postgres');
});

// Project override
console.log('\n--- Project override ---');
test('Project A postgres-specialist can write db/', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const r = dryRunScenario('write', { agent: 'postgres-specialist', path: 'db/schema.sql' });
  assert(r.permission === 'allow', `expected allow got ${r.permission}`);
});

// Global safety
console.log('\n--- Global safety ---');
test('Project cannot disable protected path enforcement', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const r = dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' });
  assert(r.permission === 'deny', 'protected path should be denied');
});

// Tier 3
console.log('\n--- Tier 3 ---');
test('git push blocked without task approval', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const r = dryRunScenario('shell', { agent: 'postgres-specialist', command: 'git push origin main' });
  assert(r.permission === 'deny', 'git push should require approval');
});

// Ephemeral
console.log('\n--- Ephemeral ---');
test('Ephemeral spec validates flat path pattern', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const id = generateAgentId('PROJA-20260902-001', 'migration-helper');
  const spec = {
    agent_id: id,
    task_id: 'PROJA-20260902-001',
    title: 'Test',
    purpose: 'Test ephemeral',
    allowed_paths: ['db/migrations/**'],
    tool_profile: 'implement-local',
    retirement_condition: 'task_completed',
  };
  const v = validateEphemeralSpec(spec);
  assert(v.valid, v.errors?.join(', '));
});
test('Ephemeral cannot write registry', () => {
  process.env.CURSOR_PROJECT_DIR = FIXTURE_A;
  const id = generateAgentId('PROJA-20260902-002', 'bad');
  const r = dryRunScenario('write', { agent: id, path: '.cursor/agents/registry.yaml' });
  assert(r.permission === 'deny', 'ephemeral registry write denied');
});

// Learning isolation
console.log('\n--- Learning ---');
test('Learning proposal created in project A only', () => {
  const tmpA = path.join(FIXTURE_A, 'docs/agents/learning/proposals');
  fs.mkdirSync(tmpA, { recursive: true });
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const p = createLearningProposal({ title: 'A lesson', evidence: ['e1'], project_id: 'project-a' }, FIXTURE_A);
  assert(p.proposal.project_id === 'project-a' || p.ok, 'proposal created');
  const filesB = fs.existsSync(path.join(FIXTURE_B, 'docs/agents/learning/proposals', `${p.proposal.proposal_id}.yaml`));
  assert(!filesB, 'learning leaked to project B');
});

// Versioning
console.log('\n--- Versioning ---');
test('Compatible version detected', () => {
  process.env.AGENT_OS_TEST_DIR = FIXTURE_A;
  const c = checkAgentOsCompatibility(FIXTURE_A);
  assert(c.compatible, c.reason);
});
test('Unsupported version detected', () => {
  const badFixture = path.join(ROOT, 'fixtures/version-bad');
  fs.mkdirSync(path.join(badFixture, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(badFixture, '.agent-os/project.yaml'),
    'schema_version: 1\nagent_os:\n  version: ">=99.0 <100.0"\nproject:\n  id: bad\n  task_id_prefix: BAD\n',
    'utf8'
  );
  process.env.AGENT_OS_TEST_DIR = badFixture;
  const c = checkAgentOsCompatibility(badFixture);
  assert(!c.compatible || c.reason === 'major_version_too_old', 'should detect version mismatch');
});

// Migration
console.log('\n--- Migration ---');
test('Bootstrap dry-run proposes rather than silently applies', () => {
  const bootstrapPath = path.join(REPO_ROOT, 'bootstrap/initialize.mjs');
  const out = execSync(`node "${bootstrapPath}" --dry-run --project-dir "${FIXTURE_EMPTY}"`, {
    encoding: 'utf8',
    env: { ...process.env, AGENT_OS_TEST_DIR: FIXTURE_EMPTY },
  });
  assert(out.includes('planned_actions'), 'dry-run should output plan');
  assert(!fs.existsSync(path.join(FIXTURE_EMPTY, '.agent-os/project.yaml')), 'dry-run must not write manifest');
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
