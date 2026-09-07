#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 5 — Execution lifecycle unit/security tests
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { executeGoverned, cancelGoverned, clearLifecycleStore } from '../runtime/execution.mjs';
import { createLocalExecutorBackend, clearLocalExecutorRuns } from '../runtime/adapters/local-executor.mjs';
import { createContractProbeBackend } from './fixtures/runtime-backend/contract-probe.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { clearSession } from '../runtime/../policy/authority.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-exec-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os/project.yaml'),
    `contract:\n  version: 1\nproject:\n  id: exec-tmp\n  name: exec-tmp\n  task_id_prefix: EXEC\ncapabilities: []\nagents: {}\nownership: []\nverification:\n  commands: []\nruntime:\n  requirements: {}\n`,
    'utf8'
  );
  return dir;
}

console.log('Runtime Execution Lifecycle (Stage 5)\n');

test('Test 1 — DENY prevents execution (start never called)', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  let startCalls = 0;
  const backend = createLocalExecutorBackend({ id: 'local-executor' });
  const orig = backend.start.bind(backend);
  backend.start = (...args) => {
    startCalls++;
    return orig(...args);
  };
  registry.register(backend);

  const result = executeGoverned({
    task_id: 'EXEC-DENY-1',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    operation: { type: 'write_file', path: '.cursor/hooks.json', content: 'hack' },
    allowed_paths: ['docs/**'],
    registry,
  });

  assert(result.status === 'POLICY_DENIED', `got ${result.status}`);
  assert(startCalls === 0, `start called ${startCalls}`);
  assert(result.route_decision == null || result.lifecycle_status === 'POLICY_DENIED');
});

test('Test 2 — ALLOW + compatible → ROUTED → start → COMPLETED', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const outRel = 'docs/project/runtime-e2e/out.txt';
  const result = executeGoverned({
    task_id: 'EXEC-OK-1',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    objective: 'write marker file',
    operation: { type: 'write_file', path: outRel, content: 'hello-forgeos' },
    allowed_paths: ['docs/**'],
    verification_commands: [],
    registry,
  });
  assert(result.status === 'COMPLETED', `got ${result.status}: ${result.error?.message}`);
  assert(result.backend_id === 'local-executor');
  assert(result.run_id);
  assert(fs.readFileSync(path.join(projectDir, outRel), 'utf8') === 'hello-forgeos');
  assert(result.governance_evidence?.kind === 'forgeos_governance_evidence');
  assert(result.runtime_evidence?.kind === 'runtime_native_evidence');
});

test('Test 3 — incompatible backend → no execution', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(
    createContractProbeBackend({
      id: 'probe-only',
      capabilities: { languages: ['rust'], sandbox: true, autonomous: false },
    })
  );
  const result = executeGoverned({
    task_id: 'EXEC-INCOMP',
    project_dir: projectDir,
    evaluate_policy: false,
    policy_decision: { decision: 'allow', authority: POLICY_AUTHORITY },
    requirements: { language: 'javascript', autonomous: true },
    operation: { type: 'noop' },
    registry,
  });
  assert(result.status === 'ROUTING_FAILED', `got ${result.status}`);
});

test('Test 4 — unhealthy backend → no execution', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend({ healthStatus: 'unhealthy' }));
  const result = executeGoverned({
    task_id: 'EXEC-SICK',
    project_dir: projectDir,
    evaluate_policy: false,
    policy_decision: { decision: 'allow', authority: POLICY_AUTHORITY },
    operation: { type: 'noop' },
    registry,
  });
  assert(result.status === 'ROUTING_FAILED');
});

test('Test 5 — task isolation on cancel', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'TASK-A',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    operation: {
      type: 'write_file',
      path: 'docs/project/runtime-e2e/a.txt',
      content: 'a',
    },
    allowed_paths: ['docs/**'],
    registry,
  });
  assert(result.status === 'COMPLETED');
  const cancel = cancelGoverned({
    task_id: 'TASK-B',
    run_handle: result.run_handle,
    registry,
  });
  assert(cancel.ok === false);
  assert(cancel.status === 'TASK_MISMATCH' || cancel.error?.code === 'TASK_MISMATCH');
});

test('Test 6 — execution success + verification failure → not successful', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'EXEC-VER-FAIL',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    operation: {
      type: 'write_file',
      path: 'docs/project/runtime-e2e/v.txt',
      content: 'x',
    },
    allowed_paths: ['docs/**'],
    verification_commands: ['node -e "process.exit(1)"'],
    registry,
  });
  assert(result.status === 'VERIFICATION_FAILED', `got ${result.status}`);
  assert(result.verification_assessment?.satisfied === false);
  assert(fs.existsSync(path.join(projectDir, 'docs/project/runtime-e2e/v.txt')));
});

test('Test 7 — runtime vs governance evidence distinct', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'EXEC-EV',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    operation: {
      type: 'write_file',
      path: 'docs/project/runtime-e2e/e.txt',
      content: 'e',
    },
    allowed_paths: ['docs/**'],
    registry,
  });
  assert(result.runtime_evidence.kind === 'runtime_native_evidence');
  assert(result.governance_evidence.kind === 'forgeos_governance_evidence');
  assert(result.governance_evidence.authority === POLICY_AUTHORITY);
  assert(result.runtime_evidence.authority == null);
});

test('Test 8 — runtime cannot claim forgeos authority in policy_decision', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'EXEC-AUTH',
    project_dir: projectDir,
    evaluate_policy: false,
    policy_decision: { authority: 'runtime', decision: 'allow' },
    operation: { type: 'noop' },
    registry,
  });
  assert(result.status === 'INVALID_REQUEST');
});

test('local-executor rejects hard-forbidden path even if policy wrongly allows', () => {
  const projectDir = makeProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'EXEC-HARD',
    project_dir: projectDir,
    evaluate_policy: false,
    policy_decision: { decision: 'allow', authority: POLICY_AUTHORITY },
    operation: {
      type: 'write_file',
      path: '.cursor/hooks.json',
      content: 'nope',
    },
    allowed_paths: ['.cursor/**', 'docs/**'],
    registry,
  });
  assert(
    result.status === 'START_FAILED' || result.status === 'EXECUTION_FAILED',
    `got ${result.status}`
  );
  assert(!fs.existsSync(path.join(projectDir, '.cursor/hooks.json')));
});

test('docs exist', () => {
  assert(fs.existsSync(path.join(ROOT, 'docs/architecture/EXECUTION-LIFECYCLE.md')));
  assert(
    fs.existsSync(path.join(ROOT, 'docs/architecture/RUNTIME-ADAPTER-LOCAL-EXECUTOR.md'))
  );
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
