/**
 * Stage 7 — Production OpenHands HTTP adapter tests
 *
 * Mock Agent Server runs in a separate process (spawnSync HTTP must not
 * deadlock an in-process server).
 *
 * Live OpenHands is exercised only when OPENHANDS_AGENT_SERVER_URL is set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import {
  executeGoverned,
  cancelGoverned,
  clearLifecycleStore,
} from '../runtime/execution.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';
import {
  createOpenHandsBackend,
  clearOpenHandsRuns,
  redactSecrets,
  OPENHANDS_ADAPTER_VERSION,
} from '../runtime/adapters/openhands/index.mjs';
import { startMockAgentServerProcess } from '../runtime/adapters/openhands/mock-process.mjs';
import { httpRequestSync } from '../runtime/adapters/openhands/http-sync.mjs';
import { coordinateGovernedExecution } from '../intelligence/orchestrator/coordinator.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { validateRuntimeBackend } from '../runtime/backend-interface.mjs';

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    return false;
  }
}

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s7-oh-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project', 'stage7'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage7-openhands
  name: Stage7 OH
  task_id_prefix: S7
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

function mockPostCount(baseUrl) {
  const res = httpRequestSync({
    url: `${baseUrl}/__forgeos_mock/stats`,
    method: 'GET',
    timeoutMs: 5000,
  });
  return res.ok ? Number(res.data?.postConversations || 0) : -1;
}

let passed = 0;
let failed = 0;
console.log('Stage 7 OpenHands Production Adapter\n');

clearLifecycleStore();
clearOpenHandsRuns();

if (
  test('adapter version is Stage 7', () => {
    assert.equal(OPENHANDS_ADAPTER_VERSION, '0.3.0-stage15');
    const b = createOpenHandsBackend({ transport: 'probe' });
    assert.equal(validateRuntimeBackend(b).valid, true);
  })
)
  passed++;
else failed++;

if (
  test('J — secret redaction strips api keys from objects/strings', () => {
    const fakeKey = ['sk', '-', 'secretvalue123456'].join('');
    const sample = {};
    sample[['api', 'key'].join('_')] = fakeKey;
    sample.nested = { Authorization: ['Bearer', ' tok_abc'].join('') };
    sample.message = [['api', 'key'].join('_'), '=', fakeKey, ' leaked'].join('');
    const red = redactSecrets(sample);
    const dumped = JSON.stringify(red);
    assert.equal(dumped.includes(fakeKey), false);
    assert.equal(dumped.includes('tok_abc'), false);
    assert.ok(dumped.includes('***REDACTED***'));
  })
)
  passed++;
else failed++;

const httpSuite = await (async () => {
  let p = 0;
  let f = 0;

  if (
    await testAsync('HTTP health — configured URL must actually probe (mock process)', async () => {
      const mock = await startMockAgentServerProcess({ version: 'mock-0.1.0' });
      try {
        const backend = createOpenHandsBackend({
          transport: 'http',
          baseUrl: mock.baseUrl,
          timeoutMs: 10000,
        });
        const h = backend.health();
        assert.equal(h.status, 'healthy', JSON.stringify(h));
        assert.equal(h.detail.version, 'mock-0.1.0');
        const ha = await backend.healthAsync();
        assert.equal(ha.status, 'healthy');
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('E — Agent Server unavailable → not healthy / start fails', async () => {
      const backend = createOpenHandsBackend({
        transport: 'http',
        baseUrl: 'http://127.0.0.1:1',
        timeoutMs: 2000,
      });
      const h = backend.health();
      assert.ok(['unhealthy', 'unavailable'].includes(h.status), h.status);

      clearLifecycleStore();
      const dir = makeTempProject();
      const registry = createRuntimeRegistry();
      registry.register(backend);
      const result = executeGoverned({
        task_id: 'S7-E',
        project_dir: dir,
        objective: 'unavailable',
        operation: { type: 'noop' },
        evaluate_policy: false,
        policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 'test' },
        registry,
        backend_id: 'openhands',
        execution_id: 's7-e',
      });
      assert.ok(['ROUTING_FAILED', 'START_FAILED'].includes(result.status), result.status);
    })
  )
    p++;
  else f++;

  if (
    await testAsync('HTTP E2E — policy → router → POST → evidence → verification', async () => {
      clearLifecycleStore();
      clearOpenHandsRuns();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        const backend = createOpenHandsBackend({
          transport: 'http',
          baseUrl: mock.baseUrl,
        });
        registry.register(backend);

        const result = coordinateGovernedExecution({
          project_dir: dir,
          task_id: 'S7-E2E-1',
          objective: 'write marker via mock openhands http',
          execute: true,
          execution_id: 's7-http-e2e-1',
          operation: {
            type: 'write_file',
            path: 'docs/project/stage7/marker.txt',
            content: 's7',
          },
          allowed_paths: ['docs/**'],
          agent_id: 'codebase-organization',
          runtime_registry: registry,
          backend_id: 'openhands',
        });

        assert.equal(result.governed.status, 'COMPLETED', JSON.stringify(result.governed.error));
        assert.equal(result.governed.backend_id, 'openhands');
        assert.equal(result.governed.runtime_evidence.kind, 'runtime_native_evidence');
        assert.equal(result.governed.governance_evidence.kind, 'forgeos_governance_evidence');
        assert.ok(fs.existsSync(path.join(dir, 'docs/project/stage7/marker.txt')));
        assert.ok(mockPostCount(mock.baseUrl) >= 1);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('A — Policy DENY → zero HTTP POSTs', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const result = executeGoverned({
          task_id: 'S7-A',
          project_dir: dir,
          objective: 'protected',
          operation: { type: 'write_file', path: '.cursor/hooks.json', content: 'x' },
          allowed_paths: ['.cursor/**'],
          agent_id: 'codebase-organization',
          registry,
          backend_id: 'openhands',
          execution_id: 's7-a',
        });
        assert.equal(result.status, 'POLICY_DENIED');
        assert.equal(mockPostCount(mock.baseUrl), 0);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('B — Protected path denied before runtime', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      fs.mkdirSync(path.join(dir, 'policy'), { recursive: true });
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const result = executeGoverned({
          task_id: 'S7-B',
          project_dir: dir,
          objective: 'policy write',
          operation: { type: 'write_file', path: 'policy/rules.json', content: 'bad' },
          allowed_paths: ['policy/**'],
          agent_id: 'codebase-organization',
          registry,
          backend_id: 'openhands',
          execution_id: 's7-b',
        });
        assert.equal(result.status, 'POLICY_DENIED');
        assert.equal(mockPostCount(mock.baseUrl), 0);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('C — No compatible backend', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({
            transport: 'http',
            baseUrl: mock.baseUrl,
            capabilities: { sandbox: false, autonomous: true },
          })
        );
        const result = executeGoverned({
          task_id: 'S7-C',
          project_dir: dir,
          objective: 'sandbox',
          operation: { type: 'noop' },
          evaluate_policy: false,
          policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
          requirements: { sandbox: true, autonomous: true },
          registry,
          backend_id: 'openhands',
          execution_id: 's7-c',
        });
        assert.equal(result.status, 'ROUTING_FAILED');
        assert.equal(result.error?.code, 'NO_COMPATIBLE_BACKEND');
        assert.equal(mockPostCount(mock.baseUrl), 0);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('D — Duplicate execution_id → one POST', async () => {
      clearLifecycleStore();
      clearOpenHandsRuns();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const base = {
          task_id: 'S7-D',
          project_dir: dir,
          objective: 'once',
          operation: {
            type: 'write_file',
            path: 'docs/project/stage7/once.txt',
            content: '1',
          },
          allowed_paths: ['docs/**'],
          agent_id: 'codebase-organization',
          registry,
          backend_id: 'openhands',
          execution_id: 's7-d',
        };
        const first = executeGoverned(base);
        const second = executeGoverned(base);
        assert.equal(first.status, 'COMPLETED');
        assert.equal(second.status, 'ALREADY_COMPLETED');
        assert.equal(mockPostCount(mock.baseUrl), 1);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('F — Runtime execution failure', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess({ behavior: 'execution_failed' });
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const result = executeGoverned({
          task_id: 'S7-F',
          project_dir: dir,
          objective: 'fail',
          operation: { type: 'noop' },
          evaluate_policy: false,
          policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
          registry,
          backend_id: 'openhands',
          execution_id: 's7-f',
        });
        assert.ok(['EXECUTION_FAILED', 'START_FAILED'].includes(result.status), result.status);
        assert.notEqual(result.status, 'COMPLETED');
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('G — Verification failure', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess({ behavior: 'verification_fail' });
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const result = executeGoverned({
          task_id: 'S7-G',
          project_dir: dir,
          objective: 'verify fail',
          operation: {
            type: 'write_file',
            path: 'docs/project/stage7/g.txt',
            content: 'g',
          },
          allowed_paths: ['docs/**'],
          verification_commands: ['echo verify-g'],
          agent_id: 'codebase-organization',
          registry,
          backend_id: 'openhands',
          execution_id: 's7-g',
        });
        assert.equal(result.status, 'VERIFICATION_FAILED');
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('H — Evidence failure', async () => {
      clearLifecycleStore();
      const mock = await startMockAgentServerProcess({ behavior: 'evidence_unavailable' });
      const dir = makeTempProject();
      try {
        const registry = createRuntimeRegistry();
        registry.register(
          createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
        );
        const result = executeGoverned({
          task_id: 'S7-H',
          project_dir: dir,
          objective: 'evidence',
          operation: { type: 'noop' },
          evaluate_policy: false,
          policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
          registry,
          backend_id: 'openhands',
          execution_id: 's7-h',
        });
        assert.equal(result.status, 'EVIDENCE_FAILED');
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('I — No automatic fallback to Local Executor', async () => {
      clearLifecycleStore();
      const dir = makeTempProject();
      const registry = createRuntimeRegistry();
      registry.register(
        createOpenHandsBackend({
          transport: 'http',
          baseUrl: 'http://127.0.0.1:1',
          timeoutMs: 1500,
        })
      );
      registry.register(createLocalExecutorBackend());
      const result = executeGoverned({
        task_id: 'S7-I',
        project_dir: dir,
        objective: 'no fallback',
        operation: { type: 'noop' },
        evaluate_policy: false,
        policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
        registry,
        backend_id: 'openhands',
        execution_id: 's7-i',
      });
      assert.ok(['ROUTING_FAILED', 'START_FAILED'].includes(result.status), result.status);
      assert.notEqual(result.backend_id, 'local-executor');
    })
  )
    p++;
  else f++;

  if (
    await testAsync('Cancel via remote pause on mock HTTP', async () => {
      clearLifecycleStore();
      clearOpenHandsRuns();
      const mock = await startMockAgentServerProcess();
      const dir = makeTempProject();
      try {
        const backend = createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl });
        const registry = createRuntimeRegistry();
        registry.register(backend);
        const result = executeGoverned({
          task_id: 'S7-CANCEL',
          project_dir: dir,
          objective: 'cancelable',
          operation: {
            type: 'write_file',
            path: 'docs/project/stage7/c.txt',
            content: 'c',
          },
          allowed_paths: ['docs/**'],
          agent_id: 'codebase-organization',
          registry,
          backend_id: 'openhands',
          execution_id: 's7-cancel',
        });
        assert.equal(result.status, 'COMPLETED');
        const cancelled = cancelGoverned({
          task_id: 'S7-CANCEL',
          run_handle: result.run_handle,
          registry,
        });
        assert.equal(cancelled.ok, true);
        assert.equal(cancelled.status, 'CANCELLED');
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('J — session key never appears in errors/evidence', async () => {
      const session = ['super', '-', 'secret', '-', 'session', '-', 'key'].join('');
      const mock = await startMockAgentServerProcess({
        sessionKey: session,
      });
      try {
        const backend = createOpenHandsBackend({
          transport: 'http',
          baseUrl: mock.baseUrl,
          apiKey: session,
        });
        assert.equal(backend.health().status, 'healthy');
        const dumped = JSON.stringify(backend._getLastHealthDetail() || {});
        assert.equal(dumped.includes(session), false);
      } finally {
        await mock.close();
      }
    })
  )
    p++;
  else f++;

  if (
    await testAsync('Live Agent Server gate (env)', async () => {
      const url = process.env.OPENHANDS_AGENT_SERVER_URL;
      if (!url) {
        console.log('        Live Agent Server: UNKNOWN (OPENHANDS_AGENT_SERVER_URL unset)');
        assert.ok(true);
        return;
      }
      const backend = createOpenHandsBackend({ transport: 'http', baseUrl: url });
      const h = await backend.healthAsync();
      console.log(`        Live health: ${h.status} version=${h.detail?.version || 'n/a'}`);
      assert.ok(['healthy', 'unhealthy', 'unavailable', 'unknown'].includes(h.status));
    })
  )
    p++;
  else f++;

  return { p, f };
})();

passed += httpSuite.p;
failed += httpSuite.f;

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
