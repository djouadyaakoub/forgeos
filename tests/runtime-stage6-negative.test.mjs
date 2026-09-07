/**
 * Stage 6 — Mandatory negative tests A–H
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  executeGoverned,
  clearLifecycleStore,
} from '../runtime/execution.mjs';
import {
  createOpenHandsBackend,
  clearOpenHandsRuns,
  createOpenHandsProbeTransport,
} from '../runtime/adapters/openhands/index.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    return false;
  }
}

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s6-neg-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project', 'stage6'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage6-fixture
  name: Stage6 Fixture
  task_id_prefix: S6
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
runtime:
  requirements: {}
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
  return dir;
}

let passed = 0;
let failed = 0;
console.log('Stage 6 Negative Tests A–H\n');

clearLifecycleStore();
clearOpenHandsRuns();

// --- A Policy DENY ---
if (
  test('A — Policy DENY → OpenHands must NOT start', () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport();
    const backend = createOpenHandsBackend({ transport: 'probe', probe });
    registry.register(backend);

    const result = executeGoverned({
      task_id: 'S6-A',
      project_dir: dir,
      objective: 'mutate protected',
      operation: {
        type: 'write_file',
        path: '.cursor/hooks.json',
        content: 'x',
      },
      allowed_paths: ['.cursor/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-a',
    });

    assert.equal(result.status, 'POLICY_DENIED');
    assert.equal(probe.getStartCount(), 0);
  })
)
  passed++;
else failed++;

// --- B Protected path ---
if (
  test('B — Protected path DENY before OpenHands', () => {
    clearLifecycleStore();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport();
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    for (const p of ['.cursor/x', '.agent-os/project.yaml', 'policy/rules.json', 'docs/agents/RUNTIME_LAW.md']) {
      // ensure parent dirs for path strings that don't exist yet
      const abs = path.join(dir, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
    }

    const result = executeGoverned({
      task_id: 'S6-B',
      project_dir: dir,
      objective: 'touch policy',
      operation: { type: 'write_file', path: 'policy/rules.json', content: 'bad' },
      allowed_paths: ['policy/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-b',
    });

    assert.equal(result.status, 'POLICY_DENIED');
    assert.equal(probe.getStartCount(), 0);
  })
)
  passed++;
else failed++;

// --- C No compatible backend ---
if (
  test('C — No compatible OpenHands capability → NO_COMPATIBLE_BACKEND', () => {
    clearLifecycleStore();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    registry.register(
      createOpenHandsBackend({
        transport: 'probe',
        capabilities: { sandbox: false, autonomous: true },
      })
    );

    const result = executeGoverned({
      task_id: 'S6-C',
      project_dir: dir,
      objective: 'needs sandbox',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: {
        authority: POLICY_AUTHORITY,
        decision: 'allow',
        reason: 'test',
      },
      requirements: { sandbox: true, autonomous: true },
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-c',
      default_decision: 'allow',
    });

    assert.equal(result.status, 'ROUTING_FAILED');
    assert.equal(result.error?.code, 'NO_COMPATIBLE_BACKEND');
  })
)
  passed++;
else failed++;

// --- D Duplicate execution ---
if (
  test('D — Duplicate execution identity → one start', () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport();
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    const base = {
      task_id: 'S6-D',
      project_dir: dir,
      objective: 'once',
      operation: { type: 'write_file', path: 'docs/project/stage6/d.txt', content: 'd' },
      allowed_paths: ['docs/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-d',
    };
    const first = executeGoverned(base);
    const second = executeGoverned(base);
    assert.equal(first.status, 'COMPLETED');
    assert.equal(second.status, 'ALREADY_COMPLETED');
    assert.equal(probe.getStartCount(), 1);
  })
)
  passed++;
else failed++;

// --- E Dry run ---
if (
  test('E — dryRun=true → no backend.start, no mutation', () => {
    clearLifecycleStore();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport();
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    const result = executeGoverned({
      task_id: 'S6-E',
      project_dir: dir,
      objective: 'dry',
      dry_run: true,
      operation: { type: 'write_file', path: 'docs/project/stage6/e.txt', content: 'e' },
      allowed_paths: ['docs/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-e',
    });

    assert.equal(result.status, 'DRY_RUN');
    assert.equal(probe.getStartCount(), 0);
    assert.equal(fs.existsSync(path.join(dir, 'docs', 'project', 'stage6', 'e.txt')), false);
  })
)
  passed++;
else failed++;

// --- F Runtime failure ---
if (
  test('F — OpenHands failure → EXECUTION_FAILED / START_FAILED, not COMPLETED', () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport({ behavior: 'execution_failed' });
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    const result = executeGoverned({
      task_id: 'S6-F',
      project_dir: dir,
      objective: 'fail',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: {
        authority: POLICY_AUTHORITY,
        decision: 'allow',
        reason: 'test',
      },
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-f',
    });

    assert.ok(['EXECUTION_FAILED', 'START_FAILED'].includes(result.status), result.status);
    assert.notEqual(result.status, 'COMPLETED');
  })
)
  passed++;
else failed++;

// --- G Verification failure ---
if (
  test('G — runtime completes but verification fails → VERIFICATION_FAILED', () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport({ behavior: 'verification_fail' });
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    const result = executeGoverned({
      task_id: 'S6-G',
      project_dir: dir,
      objective: 'verify fail',
      operation: { type: 'write_file', path: 'docs/project/stage6/g.txt', content: 'g' },
      allowed_paths: ['docs/**'],
      verification_commands: ['echo verify-g'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-g',
    });

    assert.equal(result.status, 'VERIFICATION_FAILED');
    assert.equal(result.verification_assessment.satisfied, false);
    assert.notEqual(result.governance_evidence.final_status, 'COMPLETED');
  })
)
  passed++;
else failed++;

// --- H Evidence failure ---
if (
  test('H — evidence unavailable → EVIDENCE_FAILED', () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    const probe = createOpenHandsProbeTransport({ behavior: 'evidence_unavailable' });
    registry.register(createOpenHandsBackend({ transport: 'probe', probe }));

    const result = executeGoverned({
      task_id: 'S6-H',
      project_dir: dir,
      objective: 'evidence fail',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: {
        authority: POLICY_AUTHORITY,
        decision: 'allow',
        reason: 'test',
      },
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-h',
    });

    assert.equal(result.status, 'EVIDENCE_FAILED');
    assert.notEqual(result.status, 'COMPLETED');
  })
)
  passed++;
else failed++;

if (
  test('No automatic fallback OpenHands → Local Executor', () => {
    clearLifecycleStore();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    // Only OpenHands with forced unavailable health
    registry.register(
      createOpenHandsBackend({ transport: 'probe', healthStatus: 'unavailable' })
    );
    registry.register(createLocalExecutorBackend());

    const result = executeGoverned({
      task_id: 'S6-NOFB',
      project_dir: dir,
      objective: 'no fallback',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: {
        authority: POLICY_AUTHORITY,
        decision: 'allow',
        reason: 'test',
      },
      registry,
      backend_id: 'openhands',
      execution_id: 'neg-nofb',
    });

    assert.equal(result.status, 'ROUTING_FAILED');
    assert.notEqual(result.backend_id, 'local-executor');
  })
)
  passed++;
else failed++;

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
