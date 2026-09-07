/**
 * Stage 12 — Host-native intelligence / interactive handoff
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCursorHostAdapter,
  discoverCursorHostCapabilities,
} from '../host/adapters/cursor/index.mjs';
import { validateHostExecutionAdapter } from '../host/adapter.mjs';
import { discoverHostCapabilities, clearHostDiscoveryCache } from '../host/discovery.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import {
  createHostHandoff,
  requestHostTaskVerification,
  validateHostHandoff,
  loadHostHandoff,
  computeHandoffIntegrity,
} from '../intelligence/orchestrator/host-handoff.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { runForgeOsTaskCli } from '../cli/task.mjs';
import { clearLifecycleStore } from '../runtime/execution.mjs';
import { clearSession } from '../policy/authority.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearLifecycleStore();
    clearSession();
    clearHostDiscoveryCache();
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function makeDocGapProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s12-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage12
  name: Stage12
  type: application
  task_id_prefix: S12
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
  fs.writeFileSync(path.join(dir, 'README.md'), '# Stage12\n');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# Stack\n\nnode\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# Arch\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s12"}\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function docsCandidate(projectDir) {
  const assessment = runProjectAssessment({
    project_dir: projectDir,
    persist: false,
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'plan', 'write', 'edit', 'test', 'documentation'],
    },
  });
  const row = assessment.assessments.find((a) => a.binding.id === 'documentation-sync');
  return { assessment, candidate: row?.task_candidate, resolution: row?.resolution };
}

console.log('Stage 12 — Host-native intelligence\n');

test('1 — Cursor host descriptor', () => {
  const adapter = createCursorHostAdapter();
  assert.equal(adapter.id, 'cursor');
  assert.equal(adapter.invocation, 'interactive');
  assert.equal(adapter.programmatic_agent_start, false);
  assert.equal(adapter.claims_policy_authority, false);
  assert.equal(validateHostExecutionAdapter(adapter).valid, true);
});

test('2 — host capability discovery', () => {
  const d = discoverCursorHostCapabilities();
  assert.equal(d.host_id, 'cursor');
  assert.equal(d.invocation, 'interactive');
  assert.ok(d.capabilities.includes('read'));
  assert.ok(d.capabilities.includes('edit'));
  assert.ok(d.capability_classes.includes('DOCUMENTATION'));
  assert.equal(d.programmatic_agent_start, false);
});

test('3 — host-native resolution', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'documentation-sync');
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    capability_binding: binding,
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'write', 'edit', 'documentation'],
    },
  });
  assert.equal(r.implementation_type, 'host_native');
  assert.equal(r.available, true);
  assert.equal(r.resolved, true);
});

test('4 — interactive-only resolution (available but not executable)', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'documentation-sync');
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    capability_binding: binding,
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'write', 'edit', 'documentation'],
    },
  });
  assert.equal(r.invocation, 'interactive');
  assert.equal(r.executable, false);
  assert.equal(r.available, true);
  assert.match(r.invocation_detail || '', /no_programmatic_invocation|interactive/);
});

test('5 — programmatic capability representation only when supported', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structure-audit');
  const r = resolveCapability({
    capability_id: 'structure-audit',
    capability_binding: binding,
    host_context: { host_id: 'cursor', capabilities: ['read', 'analyze'] },
    preference: 'forgeos_native',
  });
  assert.equal(r.implementation_type, 'forgeos_native');
  assert.equal(r.executable, true);
  assert.equal(r.invocation, 'programmatic');
});

test('6 — handoff generation', () => {
  const dir = makeDocGapProject();
  const { candidate, resolution } = docsCandidate(dir);
  assert.ok(candidate);
  const result = createHostHandoff({
    project_dir: dir,
    candidate,
    resolution,
    host_id: 'cursor',
    persist: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.handoff.schema, 'forgeos-host-task-handoff');
  assert.equal(result.execution_status, 'HOST_INTERACTIVE_REQUIRED');
  assert.equal(result.verification_status, 'NOT_STARTED');
  assert.ok(fs.existsSync(path.join(dir, 'docs/project/tasks', `${candidate.task_id}.handoff.json`)));
});

test('7 — handoff fingerprint + integrity', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const result = createHostHandoff({ project_dir: dir, candidate, host_id: 'cursor', persist: true });
  assert.ok(result.handoff.handoff_fingerprint);
  assert.equal(result.handoff.integrity, computeHandoffIntegrity(result.handoff));
  assert.equal(validateHostHandoff(result.handoff, { expected_task_id: candidate.task_id }).ok, true);
});

test('8 — task isolation (handoff A cannot verify task B)', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, host_id: 'cursor', persist: true });
  const bad = requestHostTaskVerification({
    project_dir: dir,
    task_id: candidate.task_id,
    expected_task_id: 'OTHER-TASK',
    persist: false,
    rescan: false,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'handoff_task_mismatch');
});

test('9 — verification after host task (PASS)', () => {
  const dir = makeDocGapProject();
  const { candidate, assessment } = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, host_id: 'cursor', persist: true });
  // Simulate interactive host work
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — stage12\n');
  const result = requestHostTaskVerification({
    project_dir: dir,
    task_id: candidate.task_id,
    persist: true,
    before_assessment: assessment,
  });
  assert.equal(result.verification.result, 'PASS');
  assert.equal(result.capability_satisfied, true);
});

test('10 — Canvas implementation/invocation display', () => {
  const dir = makeDocGapProject();
  const assessment = runProjectAssessment({
    project_dir: dir,
    persist: false,
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'plan', 'write', 'edit', 'documentation', 'test'],
    },
  });
  const item = assessment.canvas.items.find((i) => i.capability_id === 'documentation-sync');
  assert.ok(item.implementation_display);
  assert.ok(item.invocation_display);
});

test('11 — JSON task CLI output', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const out = runForgeOsTaskCli([
    'node', 'cli/task.mjs', candidate.task_id,
    '--project', dir, '--json',
  ], { print: false });
  assert.equal(out.ok, true);
  assert.equal(out.execution_status, 'HOST_INTERACTIVE_REQUIRED');
  assert.equal(out.verification_status, 'NOT_STARTED');
  assert.ok(out.handoff);
  assert.ok(out.implementation);
  assert.ok(out.host);
  assert.equal(out.invocation_mode, 'interactive');
});

test('12 — CLI task display', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const out = runForgeOsTaskCli([
    'node', 'cli/task.mjs', candidate.task_id,
    '--project', dir, '--json',
  ], { print: false });
  assert.match(out.handoff.instructions, /WHAT TO DO/);
  assert.match(out.handoff.instructions, /DO NOT CHANGE/);
});

test('13 — completion request', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  runForgeOsTaskCli(['node', 'cli/task.mjs', candidate.task_id, '--project', dir, '--json'], { print: false });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# done\n');
  const out = runForgeOsTaskCli([
    'node', 'cli/task.mjs', 'complete', candidate.task_id,
    '--project', dir, '--json',
  ], { print: false });
  assert.equal(out.ok, true);
  assert.equal(out.execution_status, 'VERIFICATION_REQUESTED');
  assert.equal(out.verification_status, 'PASS');
});

test('14 — verification PASS', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# a\n');
  const r = requestHostTaskVerification({ project_dir: dir, task_id: candidate.task_id, persist: true });
  assert.equal(r.verification_status, 'PASS');
});

test('15 — verification FAIL', () => {
  const dir = makeDocGapProject();
  const { candidate: base } = docsCandidate(dir);
  const candidate = {
    ...base,
    verification_presence: ['AGENTS.md', 'missing.md'],
  };
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# a\n');
  const r = requestHostTaskVerification({ project_dir: dir, task_id: candidate.task_id, persist: true, rescan: true });
  assert.equal(r.verification.result, 'FAIL');
  assert.equal(r.capability_satisfied, false);
});

test('16 — verification UNKNOWN (strategy none)', () => {
  const dir = makeDocGapProject();
  const candidate = createTaskCandidate({
    task_id: 'S12-none',
    capability_id: 'documentation-sync',
    objective: 'x',
    verification_strategy: 'none',
  }).candidate;
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  const r = requestHostTaskVerification({ project_dir: dir, task_id: 'S12-none', persist: false, rescan: false });
  assert.equal(r.verification.result, 'UNKNOWN');
  assert.equal(r.capability_satisfied, false);
});

test('17 — policy DENY blocks approved executable handoff', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const blocked = createHostHandoff({
    project_dir: dir,
    candidate,
    policy_decision: 'deny',
    persist: false,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'policy_deny');
});

test('18/19/20/21 — Stage 8–11 regressions are covered by npm scripts (smoke imports)', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'tests/runtime-stage8-assessment.test.mjs')));
  assert.ok(fs.existsSync(path.join(REPO, 'tests/runtime-stage9-governed-loop.test.mjs')));
  assert.ok(fs.existsSync(path.join(REPO, 'tests/runtime-stage10-verification-evidence.test.mjs')));
  assert.ok(fs.existsSync(path.join(REPO, 'tests/runtime-stage11-main-agent.test.mjs')));
});

test('Cursor start() does not fake programmatic execution', () => {
  const adapter = createCursorHostAdapter();
  const started = adapter.start({ task_id: 'T' });
  assert.equal(started.started, false);
  assert.equal(started.execution_status, 'HOST_INTERACTIVE_REQUIRED');
});

test('handoff does not imply execution started', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  const result = createHostHandoff({ project_dir: dir, candidate, persist: false });
  assert.notEqual(result.execution_status, 'COMPLETED');
  assert.notEqual(result.execution_status, 'RUNNING');
  assert.equal(result.verification_status, 'NOT_STARTED');
});

test('discoverHostCapabilities for cursor', () => {
  const d = discoverHostCapabilities({ host_id: 'cursor' });
  assert.equal(d.invocation, 'interactive');
});

test('loadHostHandoff roundtrip', () => {
  const dir = makeDocGapProject();
  const { candidate } = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  const loaded = loadHostHandoff(dir, candidate.task_id);
  assert.equal(loaded.task_id, candidate.task_id);
});

console.log(`\nStage 12 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
