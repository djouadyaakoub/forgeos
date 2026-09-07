/**
 * Stage 11 — Main Agent / Capability Orchestration tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeIntent } from '../intelligence/orchestrator/intent.mjs';
import { selectCapabilities } from '../intelligence/orchestrator/capability-selection.mjs';
import {
  planCapabilityDependencies,
  detectCapabilityCycles,
} from '../intelligence/orchestrator/dependency-planner.mjs';
import {
  planFromRequest,
  formatOrchestrationPlan,
  EXECUTION_STATUS_NOT_STARTED,
} from '../intelligence/orchestrator/main-agent.mjs';
import { createTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { executeApprovedCandidate } from '../intelligence/orchestrator/approved-execution.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { runForgeOsPlanCli } from '../cli/plan.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  createLocalExecutorBackend,
  clearLocalExecutorRuns,
} from '../runtime/adapters/local-executor.mjs';
import { clearLifecycleStore } from '../runtime/execution.mjs';
import { clearSession } from '../policy/authority.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearLifecycleStore();
    clearLocalExecutorRuns();
    clearSession();
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function writePi(dir) {
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage11
  name: Stage11
  type: application
  task_id_prefix: S11
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s11-'));
  writePi(dir);
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Stage11\n');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# Stack\n\nnode\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# Arch\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s11"}\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function registry() {
  const r = createRuntimeRegistry();
  r.register(createLocalExecutorBackend());
  return r;
}

console.log('Stage 11 — Main Agent / Capability Orchestration\n');

test('1 — simple request → one capability family', () => {
  const intent = analyzeIntent('Improve documentation for this project');
  assert.ok(intent.requested_capabilities.includes('documentation-sync'));
  assert.equal(intent.explicit_change_request, false);
});

test('2 — complex request → multiple capabilities', () => {
  const intent = analyzeIntent(
    'Organize this project professionally and improve its documentation.'
  );
  assert.ok(intent.requested_capabilities.includes('structure-audit'));
  assert.ok(intent.requested_capabilities.includes('codebase-organization'));
  assert.ok(intent.requested_capabilities.some((c) => c.startsWith('documentation')));
});

test('3 — dependency ordering structure-audit before codebase-organization', () => {
  const plan = planCapabilityDependencies({
    selected: [
      { capability_id: 'codebase-organization', requires: ['structure-audit'] },
      { capability_id: 'structure-audit', requires: [] },
    ],
  });
  assert.deepEqual(plan.ordered_capability_ids, ['structure-audit', 'codebase-organization']);
  assert.equal(plan.cycle_detected, false);
});

test('4 — independent capabilities are parallelizable hints', () => {
  const plan = planCapabilityDependencies({
    selected: [
      { capability_id: 'dead-code-analysis', requires: [] },
      { capability_id: 'dependency-audit', requires: [] },
    ],
  });
  assert.ok(plan.independent_capability_ids.includes('dead-code-analysis'));
  assert.ok(plan.independent_capability_ids.includes('dependency-audit'));
});

test('5 — duplicate requested capabilities deduped', () => {
  const bindings = loadCapabilityBindings();
  const selection = selectCapabilities({
    intent: {
      requested_capabilities: ['documentation-sync', 'documentation-sync'],
      explicit_change_request: true,
    },
    bindings,
    assessment: { assessments: [] },
  });
  assert.equal(selection.selected.filter((s) => s.capability_id === 'documentation-sync').length, 1);
});

test('6 — SATISFIED capability not unnecessarily remediated', () => {
  const bindings = loadCapabilityBindings();
  const selection = selectCapabilities({
    intent: {
      requested_capabilities: ['documentation-sync'],
      explicit_change_request: false,
    },
    bindings,
    assessment: {
      assessments: [{
        binding: { id: 'documentation-sync' },
        assessment: { capability_id: 'documentation-sync', state: 'SATISFIED' },
      }],
    },
  });
  assert.equal(selection.selected.length, 0);
  assert.equal(selection.skipped[0].reason, 'already_satisfied_or_not_applicable');
});

test('7 — unsatisfied capability selected', () => {
  const bindings = loadCapabilityBindings();
  const selection = selectCapabilities({
    intent: {
      requested_capabilities: ['documentation-sync'],
      explicit_change_request: false,
    },
    bindings,
    assessment: {
      assessments: [{
        binding: { id: 'documentation-sync' },
        assessment: { capability_id: 'documentation-sync', state: 'NEEDS_IMPROVEMENT' },
      }],
    },
  });
  assert.equal(selection.selected[0].capability_id, 'documentation-sync');
});

test('8 — unknown capability not invented', () => {
  const bindings = loadCapabilityBindings();
  const selection = selectCapabilities({
    intent: {
      requested_capabilities: ['teleportation-audit'],
      explicit_change_request: false,
    },
    bindings,
  });
  assert.equal(selection.selected.length, 0);
  assert.equal(selection.unresolved[0].reason, 'no_registered_capability');
  assert.equal(selection.unresolved[0].status, 'UNRESOLVED');
});

test('9 — unresolved question on empty/unclear request', () => {
  const intent = analyzeIntent('do the thing');
  assert.ok(intent.unresolved_questions.length >= 1);
});

test('10 — capability dependency cycle detected', () => {
  const plan = planCapabilityDependencies({
    selected: [
      { capability_id: 'a', requires: ['b'] },
      { capability_id: 'b', requires: ['a'] },
    ],
  });
  assert.equal(plan.cycle_detected, true);
  const cycle = detectCapabilityCycles({ a: ['b'], b: ['a'] });
  assert.equal(cycle.cycle_detected, true);
});

test('11 — host-native preference preserved in plan', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
    host_context: { host_id: 'cli', capabilities: ['read', 'analyze', 'plan', 'write', 'test'] },
  });
  const docs = out.plan.capabilities.find((c) => c.capability_id === 'documentation-sync');
  if (docs) {
    assert.equal(docs.preferred_implementation, 'host_native');
  }
  const task = out.plan.task_candidates.find((t) => t.capability_id === 'documentation-sync');
  if (task) {
    assert.ok(['host_native', 'forgeos_native'].includes(task.implementation.type));
  }
});

test('12 — forgeos-native capability appears for structure-audit', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Run a structure audit on this project',
    project_dir: dir,
    persist: false,
  });
  const cap = out.plan.capabilities.find((c) => c.capability_id === 'structure-audit');
  assert.ok(cap);
  assert.equal(cap.preferred_implementation, 'forgeos_native');
});

test('13 — oss_backed remains available on codebase-organization binding', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'codebase-organization');
  assert.ok(binding.implementation_types.includes('oss_backed'));
});

test('14/15 — stable repeated plan + fingerprint', () => {
  const dir = makeProject();
  const a = planFromRequest({
    request: 'Organize this project professionally and improve its documentation.',
    project_dir: dir,
    persist: false,
  });
  const b = planFromRequest({
    request: 'Organize this project professionally and improve its documentation.',
    project_dir: dir,
    persist: false,
  });
  assert.equal(a.plan.plan_fingerprint, b.plan.plan_fingerprint);
  assert.deepEqual(a.plan.ordered_capability_ids, b.plan.ordered_capability_ids);
  assert.equal(a.plan.execution_status, EXECUTION_STATUS_NOT_STARTED);
});

test('16 — task candidate generation preserves Stage 9 contract', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  for (const t of out.plan.task_candidates) {
    assert.equal(t.schema, 'forgeos-task-candidate');
    assert.equal(t.execute, false);
    assert.equal(t.auto_execute, false);
    assert.ok(t.task_id);
    assert.ok(t.capability_id);
    assert.ok(Array.isArray(t.depends_on));
  }
});

test('17 — JSON plan shape via CLI', () => {
  const dir = makeProject();
  const out = runForgeOsPlanCli([
    'node', 'cli/plan.mjs',
    'Organize this project professionally and improve its documentation.',
    '--project', dir,
    '--json',
  ], { print: false });
  assert.equal(out.execution_status, 'NOT_STARTED');
  assert.ok(out.intent);
  assert.ok(Array.isArray(out.capabilities));
  assert.ok(Array.isArray(out.tasks));
  assert.ok(Array.isArray(out.dependencies));
  assert.ok(out.risk_summary);
});

test('18 — CLI plan text is readable and plan-only', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Organize this project professionally',
    project_dir: dir,
    persist: false,
  });
  const text = formatOrchestrationPlan(out.plan);
  assert.match(text, /FORGEOS PLAN/);
  assert.match(text, /EXECUTION:\nNOT_STARTED/);
  assert.match(text, /APPROVAL:/);
});

test('19 — assessment integration drives selection', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  // Missing AGENTS.md → documentation capabilities actionable
  assert.ok(out.plan.task_candidates.some((t) => t.capability_id.startsWith('documentation')));
});

test('20 — Stage 9 task candidates from plan can enter governed execution', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  const candidate = out.plan.task_candidates.find((t) => t.capability_id === 'documentation-sync' && t.operation);
  assert.ok(candidate, 'expected documentation-sync candidate with operation');
  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: false,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'PASS');
});

test('21 — Stage 10 verification compatibility (runtime ≠ satisfied without PASS)', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Improve documentation',
    project_dir: dir,
    persist: false,
  });
  const base = out.plan.task_candidates.find((t) => t.capability_id === 'documentation-sync');
  const candidate = {
    ...base,
    verification_presence: ['AGENTS.md', 'missing-doc.md'],
  };
  const approval = createTaskApproval({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    approved: true,
    operation_fingerprint: candidate.operation_fingerprint,
  }).approval;
  const loop = executeApprovedCandidate({
    project_dir: dir,
    candidate,
    approval,
    runtime_registry: registry(),
    persist: false,
  });
  assert.equal(loop.governed.status, 'COMPLETED');
  assert.equal(loop.verification.result, 'FAIL');
  assert.equal(loop.capability_satisfied, false);
});

test('E2E planning — organize + docs, no mutation, no runtime', () => {
  const dir = makeProject();
  const yamlBefore = fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8');
  const filesBefore = fs.readdirSync(dir).sort().join('|');
  const out = planFromRequest({
    request: 'Organize this project professionally and improve its documentation.',
    project_dir: dir,
    persist: false,
  });
  assert.equal(out.execute, false);
  assert.equal(out.plan.execution_status, 'NOT_STARTED');
  assert.ok(out.plan.ordered_capability_ids.includes('structure-audit'));
  assert.ok(out.plan.ordered_capability_ids.includes('codebase-organization'));
  const orgIdx = out.plan.ordered_capability_ids.indexOf('codebase-organization');
  const auditIdx = out.plan.ordered_capability_ids.indexOf('structure-audit');
  assert.ok(auditIdx < orgIdx);
  assert.ok(out.plan.task_candidates.length >= 1);
  assert.equal(fs.readFileSync(path.join(dir, '.agent-os/project.yaml'), 'utf8'), yamlBefore);
  assert.equal(fs.readdirSync(dir).sort().join('|'), filesBefore);
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
  assert.equal(out.plan.boundaries.calls_backend_start, false);
});

test('registry requires field is loaded', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'codebase-organization');
  assert.deepEqual(binding.requires, ['structure-audit']);
  const safe = loadCapabilityBindings().capabilities.find((c) => c.id === 'safe-refactor');
  assert.deepEqual(safe.requires, ['architecture-guard']);
});

test('CLI rejects --execute / --yes / --force', () => {
  assert.equal(runForgeOsPlanCli(['node', 'cli/plan.mjs', '--execute', '--json'], { print: false }).reason, 'plan_is_plan_only');
  assert.equal(runForgeOsPlanCli(['node', 'cli/plan.mjs', '--yes', '--json'], { print: false }).reason, 'forbidden_global_bypass');
  assert.equal(runForgeOsPlanCli(['node', 'cli/plan.mjs', '--force', '--json'], { print: false }).reason, 'forbidden_global_bypass');
});

test('duplicate tasks eliminated in plan', () => {
  const dir = makeProject();
  const out = planFromRequest({
    request: 'Organize this project professionally and clean up the structure.',
    project_dir: dir,
    persist: false,
  });
  const ids = out.plan.task_candidates.map((t) => t.task_id);
  assert.equal(ids.length, new Set(ids).size);
});

console.log(`\nStage 11 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
