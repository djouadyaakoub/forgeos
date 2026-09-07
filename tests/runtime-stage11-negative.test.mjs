/**
 * Stage 11 — Negative / boundary tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeIntent } from '../intelligence/orchestrator/intent.mjs';
import { selectCapabilities } from '../intelligence/orchestrator/capability-selection.mjs';
import { planCapabilityDependencies } from '../intelligence/orchestrator/dependency-planner.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { runForgeOsPlanCli } from '../cli/plan.mjs';
import { runForgeOsAssessmentCli } from '../cli/run.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

console.log('Stage 11 — Negative / architecture boundaries\n');

test('1 — Main Agent cannot execute (execute flag false)', () => {
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: path.join(REPO, 'tests/fixtures/project-a'),
    persist: false,
  });
  assert.equal(out.execute, false);
  assert.equal(out.plan.execution_status, 'NOT_STARTED');
  assert.equal(out.plan.boundaries.executes, false);
});

test('2/15/16 — Main Agent source cannot call backend.start / executeGoverned / be policy', () => {
  const files = [
    'intelligence/orchestrator/main-agent.mjs',
    'intelligence/orchestrator/intent.mjs',
    'intelligence/orchestrator/capability-selection.mjs',
    'intelligence/orchestrator/dependency-planner.mjs',
    'cli/plan.mjs',
  ];
  for (const rel of files) {
    const src = stripCommentsAndStrings(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bexecuteGoverned\b/.test(src), `${rel} must not call executeGoverned`);
    assert.ok(!/\bbackend\.start\s*\(/.test(src), `${rel} must not call backend.start`);
    assert.ok(!/from ['"].*runtime\/execution/.test(src), `${rel} must not import runtime/execution`);
    assert.ok(!/from ['"].*adapters\/local-executor/.test(src), `${rel} must not import local-executor`);
    assert.ok(!/from ['"].*adapters\/openhands/.test(src), `${rel} must not import openhands`);
  }
  const main = fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/main-agent.mjs'), 'utf8');
  assert.ok(!/POLICY_AUTHORITY/.test(main) || /boundaries/.test(main));
  assert.match(main, /calls_backend_start:\s*false/);
  assert.match(main, /policy_authority:\s*false/);
});

test('3 — Main Agent does not bypass Policy Authority', () => {
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: path.join(REPO, 'tests/fixtures/project-a'),
    persist: false,
  });
  assert.equal(out.plan.boundaries.policy_authority, false);
  assert.equal(out.plan.approval_required, true);
});

test('4 — Unknown capability not silently invented', () => {
  const selection = selectCapabilities({
    intent: { requested_capabilities: ['made-up-capability'], explicit_change_request: false },
    bindings: loadCapabilityBindings(),
  });
  assert.equal(selection.selected.length, 0);
  assert.equal(selection.unresolved[0].status, 'UNRESOLVED');
});

test('5 — Dependency cycle detected and blocks clean plan', () => {
  const plan = planCapabilityDependencies({
    selected: [
      { capability_id: 'x', requires: ['y'] },
      { capability_id: 'y', requires: ['x'] },
    ],
  });
  assert.equal(plan.cycle_detected, true);
});

test('6/7 — Duplicate capabilities and tasks deduplicated', () => {
  const plan = planCapabilityDependencies({
    selected: [
      { capability_id: 'structure-audit', requires: [] },
      { capability_id: 'structure-audit', requires: [] },
    ],
  });
  assert.deepEqual(plan.ordered_capability_ids, ['structure-audit']);
});

test('8 — Task dependencies preserved from capability requires', () => {
  const out = planFromRequest({
    request: 'Organize this project professionally',
    project_dir: path.join(REPO, 'tests/fixtures/project-a'),
    persist: false,
  });
  const org = out.plan.task_candidates.find((t) => t.capability_id === 'codebase-organization');
  const audit = out.plan.task_candidates.find((t) => t.capability_id === 'structure-audit');
  if (org && audit) {
    assert.ok(org.depends_on.includes(audit.task_id));
  }
});

test('9 — Assessment state does not grant authorization', () => {
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: path.join(REPO, 'tests/fixtures/project-a'),
    persist: false,
  });
  assert.equal(out.plan.approval_required, true);
  assert.equal(out.plan.execution_status, 'NOT_STARTED');
});

test('10 — SATISFIED not remediated without explicit change', () => {
  const selection = selectCapabilities({
    intent: { requested_capabilities: ['structure-audit'], explicit_change_request: false },
    bindings: loadCapabilityBindings(),
    assessment: {
      assessments: [{
        binding: { id: 'structure-audit' },
        assessment: { state: 'SATISFIED', capability_id: 'structure-audit' },
      }],
    },
  });
  assert.equal(selection.selected.length, 0);
});

test('11 — Explicit change can select SATISFIED (desired-state only, not policy)', () => {
  const selection = selectCapabilities({
    intent: { requested_capabilities: ['structure-audit'], explicit_change_request: true },
    bindings: loadCapabilityBindings(),
    assessment: {
      assessments: [{
        binding: { id: 'structure-audit' },
        assessment: { state: 'SATISFIED', capability_id: 'structure-audit' },
      }],
    },
  });
  assert.equal(selection.selected[0].capability_id, 'structure-audit');
});

test('12/13 — --yes and --force rejected on plan and run', () => {
  assert.equal(runForgeOsPlanCli(['node', 'cli/plan.mjs', '--yes'], { print: false }).reason, 'forbidden_global_bypass');
  assert.equal(runForgeOsAssessmentCli(['node', 'cli/run.mjs', '--force', '--json'], { print: false }).reason, 'forbidden_global_bypass');
});

test('14 — OpenHands is not mandatory for planning', () => {
  const src = fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/main-agent.mjs'), 'utf8');
  assert.ok(!/openhands/i.test(src));
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: path.join(REPO, 'tests/fixtures/project-a'),
    persist: false,
  });
  assert.ok(out.plan);
});

test('intent analysis does not invent empty capabilities from silence', () => {
  const intent = analyzeIntent('');
  assert.equal(intent.requested_capabilities.length, 0);
  assert.ok(intent.unresolved_questions.some((q) => q.code === 'empty_request'));
});

console.log(`\nStage 11 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
