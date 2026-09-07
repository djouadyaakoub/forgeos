/**
 * Stage 6 — Control-plane closure: Planner/Coordinator → executeGoverned
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  executeGoverned,
  clearLifecycleStore,
  clearExecutionGuards,
  buildExecutionIdentity,
} from '../runtime/execution.mjs';
import { createLocalExecutorBackend, clearLocalExecutorRuns } from '../runtime/adapters/local-executor.mjs';
import { coordinateDevelopmentWorkflow, coordinateGovernedExecution } from '../intelligence/orchestrator/coordinator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s6-cp-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project', 'stage6'), { recursive: true });
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

console.log('Stage 6 Control-Plane Closure\n');

clearLifecycleStore();
clearLocalExecutorRuns();

if (
  test('plan-only coordination remains backward compatible', () => {
    const dir = makeTempProject();
    const result = coordinateDevelopmentWorkflow({
      project_dir: dir,
      task_id: 'S6-PLAN-1',
      objective: 'inspect project structure',
    });
    assert.equal(result.phase, 'development_intelligence_orchestration');
    assert.equal(result.governed, undefined);
    assert.ok(result.plan);
  })
)
  passed++;
else failed++;

if (
  test('coordinateGovernedExecution plan_only without execute flag', () => {
    const dir = makeTempProject();
    const result = coordinateGovernedExecution({
      project_dir: dir,
      task_id: 'S6-PLAN-2',
      objective: 'inspect only',
    });
    assert.equal(result.control_plane, 'plan_only');
    assert.equal(result.governed, null);
  })
)
  passed++;
else failed++;

if (
  test('Planner → executeGoverned dry_run never starts backend', () => {
    clearLifecycleStore();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    let starts = 0;
    const backend = createLocalExecutorBackend();
    const orig = backend.start.bind(backend);
    backend.start = (req) => {
      starts += 1;
      return orig(req);
    };
    registry.register(backend);

    const result = coordinateGovernedExecution({
      project_dir: dir,
      task_id: 'S6-DRY-1',
      objective: 'preview write',
      dry_run: true,
      operation: {
        type: 'write_file',
        path: 'docs/project/stage6/preview.txt',
        content: 'nope',
      },
      allowed_paths: ['docs/**'],
      agent_id: 'codebase-organization',
      runtime_registry: registry,
      backend_id: 'local-executor',
    });

    assert.equal(result.control_plane, 'closed');
    assert.equal(result.governed.status, 'DRY_RUN');
    assert.equal(starts, 0);
    assert.ok(result.governed.selected_backend);
    assert.ok(result.governed.verification_plan);
    assert.equal(fs.existsSync(path.join(dir, 'docs', 'project', 'stage6', 'preview.txt')), false);
  })
)
  passed++;
else failed++;

if (
  test('Planner → executeGoverned executes via lifecycle only', () => {
    clearLifecycleStore();
    clearLocalExecutorRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    let starts = 0;
    const backend = createLocalExecutorBackend();
    const orig = backend.start.bind(backend);
    backend.start = (req) => {
      starts += 1;
      return orig(req);
    };
    registry.register(backend);

    const result = coordinateGovernedExecution({
      project_dir: dir,
      task_id: 'S6-EXEC-1',
      objective: 'write marker',
      execute: true,
      execution_id: 's6-exec-1',
      operation: {
        type: 'write_file',
        path: 'docs/project/stage6/marker.txt',
        content: 'governed\n',
      },
      allowed_paths: ['docs/**'],
      agent_id: 'codebase-organization',
      runtime_registry: registry,
      backend_id: 'local-executor',
    });

    assert.equal(result.phase, 'governed_execution');
    assert.equal(result.governed.status, 'COMPLETED');
    assert.equal(starts, 1);
    assert.equal(
      result.execution.workflow_execution.governed_status,
      'COMPLETED'
    );
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'project', 'stage6', 'marker.txt')));
  })
)
  passed++;
else failed++;

if (
  test('duplicate execution identity → exactly one backend.start', () => {
    clearLifecycleStore();
    clearLocalExecutorRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    let starts = 0;
    const backend = createLocalExecutorBackend();
    const orig = backend.start.bind(backend);
    backend.start = (req) => {
      starts += 1;
      return orig(req);
    };
    registry.register(backend);

    const input = {
      project_dir: dir,
      task_id: 'S6-DUP-1',
      objective: 'once',
      execute: true,
      execution_id: 'dup-identity-1',
      operation: { type: 'write_file', path: 'docs/project/stage6/once.txt', content: '1' },
      allowed_paths: ['docs/**'],
      agent_id: 'codebase-organization',
      runtime_registry: registry,
      backend_id: 'local-executor',
    };

    const first = coordinateGovernedExecution(input);
    const second = coordinateGovernedExecution(input);
    assert.equal(first.governed.status, 'COMPLETED');
    assert.equal(second.governed.status, 'ALREADY_COMPLETED');
    assert.equal(starts, 1);
  })
)
  passed++;
else failed++;

if (
  test('buildExecutionIdentity is deterministic', () => {
    const a = buildExecutionIdentity({
      task_id: 'T1',
      execution_attempt: '1',
      objective: 'x',
      operation: { type: 'noop' },
    });
    const b = buildExecutionIdentity({
      task_id: 'T1',
      execution_attempt: '1',
      objective: 'x',
      operation: { type: 'noop' },
    });
    assert.equal(a, b);
  })
)
  passed++;
else failed++;

if (
  test('Core does not import OpenHands packages', () => {
    const coreFiles = [
      path.join(ROOT, 'runtime', 'execution.mjs'),
      path.join(ROOT, 'runtime', 'router.mjs'),
      path.join(ROOT, 'runtime', 'backend-interface.mjs'),
      path.join(ROOT, 'intelligence', 'orchestrator', 'governed.mjs'),
    ];
    for (const f of coreFiles) {
      const src = fs.readFileSync(f, 'utf8');
      assert.equal(src.includes('openhands-sdk'), false);
      assert.equal(/from ['"]openhands/.test(src), false);
    }
  })
)
  passed++;
else failed++;

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
