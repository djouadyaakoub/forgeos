/**
 * Stage 15 — Production OpenHands Runtime Gate (unit / contract / live gate)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  assessOpenHandsEnvironment,
  isOpenHandsProviderConfigured,
  runOpenHandsLiveProof,
} from '../runtime/adapters/openhands/index.mjs';
import { startMockAgentServerProcess } from '../runtime/adapters/openhands/mock-process.mjs';
import { validateRuntimeBackend } from '../runtime/backend-interface.mjs';
import { route } from '../runtime/router.mjs';
import { resolveCapabilityOperation } from '../intelligence/capability/resolver.mjs';
import { getOperation } from '../intelligence/capability/operations.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { coordinateGovernedExecution } from '../intelligence/orchestrator/governed.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s15-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage15-openhands
  name: Stage15 OH
  task_id_prefix: S15
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
`,
    'utf8'
  );
  return dir;
}

let passed = 0;
let failed = 0;
console.log('Stage 15 OpenHands Production Runtime Gate\n');

clearLifecycleStore();
clearOpenHandsRuns();

if (
  test('adapter validates RuntimeBackend contract', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const v = validateRuntimeBackend(backend);
    assert.equal(v.valid, true, v.issues?.join(','));
    assert.equal(backend.id, 'openhands');
    assert.equal(backend.version, OPENHANDS_ADAPTER_VERSION);
    assert.equal(OPENHANDS_ADAPTER_VERSION, '0.3.0-stage15');
    assert.equal(backend._claims_policy_authority, false);
  })
)
  passed++;
else failed++;

if (
  test('verified capabilities — no doc-only claims', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const vc = backend._verified_capabilities;
    assert.equal(vc.interactive, false);
    assert.equal(vc.parallel, false);
    assert.equal(vc.pr_delivery, false);
    assert.equal(vc.hooks_callback, false);
    assert.equal(vc.cost_telemetry, false);
    assert.equal(vc.autonomous, true);
  })
)
  passed++;
else failed++;

if (
  test('environment gate — unset URL → BLOCKED agent_server_url_unset', () => {
    const prev = process.env.OPENHANDS_AGENT_SERVER_URL;
    delete process.env.OPENHANDS_AGENT_SERVER_URL;
    try {
      const gate = assessOpenHandsEnvironment({});
      assert.equal(gate.status, 'BLOCKED');
      assert.equal(gate.live_capable, false);
      assert.equal(gate.reason, 'agent_server_url_unset');
      assert.equal(gate.bundled_in_forgeos, false);
      assert.equal(gate.installation, 'external_optional_runtime');
    } finally {
      if (prev != null) process.env.OPENHANDS_AGENT_SERVER_URL = prev;
    }
  })
)
  passed++;
else failed++;

if (
  test('provider gate — URL alone insufficient without LLM key', () => {
    assert.equal(
      isOpenHandsProviderConfigured({}),
      Boolean(process.env.OPENHANDS_LLM_API_KEY)
    );
    assert.equal(isOpenHandsProviderConfigured({ provider_configured: true }), true);
    assert.equal(isOpenHandsProviderConfigured({ llm_api_key: 'sk-test' }), true);
  })
)
  passed++;
else failed++;

if (
  test('canHandle match — healthy probe, no authorize/start', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const r = backend.canHandle(
      { requirements: {}, operation: { implementation_types: ['oss_backed'] } },
      { project_dir: '/tmp/p' },
      {}
    );
    assert.equal(r.match, true);
    assert.ok(r.reasons.some((x) => x.code === 'openhands_capable'));
  })
)
  passed++;
else failed++;

if (
  test('canHandle — unsupported interactive / missing oss_backed', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const a = backend.canHandle({ requirements: { interactive: true } }, null, {});
    assert.equal(a.match, false);
    const b = backend.canHandle(
      { capability_operation: { implementation_types: ['host_native'] } },
      null,
      {}
    );
    assert.equal(b.match, false);
    assert.ok(b.reasons.some((x) => x.code === 'operation_not_oss_backed'));
  })
)
  passed++;
else failed++;

if (
  test('canHandle — policy DENY never match', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const r = backend.canHandle({}, null, { policy_decision: 'deny' });
    assert.equal(r.match, false);
    assert.ok(r.reasons.some((x) => x.code === 'policy_deny'));
  })
)
  passed++;
else failed++;

if (
  test('canHandle — project_dir mismatch', () => {
    const backend = createOpenHandsBackend({ transport: 'probe' });
    const r = backend.canHandle(
      { execution_constraints: { project_dir: '/a' } },
      { project_dir: '/b' },
      {}
    );
    assert.equal(r.match, false);
    assert.ok(r.reasons.some((x) => x.code === 'project_dir_mismatch'));
  })
)
  passed++;
else failed++;

if (
  test('operation create-missing-project-docs → oss_backed openhands', () => {
    const op = getOperation('create-missing-project-docs');
    assert.ok(op.implementation_types.includes('oss_backed'));
    const r = resolveCapabilityOperation({
      operation_id: 'create-missing-project-docs',
      preference: 'oss_backed',
      runtime_backend_id: 'openhands',
      host_context: { host_id: 'cli', capabilities: ['read'] },
    });
    assert.equal(r.resolved, true);
    assert.equal(r.implementation_type, 'oss_backed');
    assert.equal(r.implementation_id, 'openhands');
    assert.equal(r.execution_boundary, 'resolver_does_not_execute');
    assert.equal(r.requirements.runtime_router_required, true);
  })
)
  passed++;
else failed++;

if (
  test('secret redaction', () => {
    const secret = 'sk-' + 'abcdefghijklmnop';
    const out = redactSecrets(`token=${secret}`);
    assert.equal(out.includes(secret), false);
    assert.ok(out.includes('***REDACTED***'));
  })
)
  passed++;
else failed++;

if (
  await testAsync('HTTP health/ready/server_info via mock', async () => {
    const mock = await startMockAgentServerProcess();
    try {
      const backend = createOpenHandsBackend({
        transport: 'http',
        baseUrl: mock.baseUrl,
      });
      const h = backend.health();
      assert.equal(h.status, 'healthy');
      assert.ok(h.detail?.version || h.detail?.versionWarning);
      const env = backend.assessEnvironment();
      // Provider typically unset → live_capable false even if healthy
      if (!isOpenHandsProviderConfigured({ provider_configured: false })) {
        assert.equal(env.live_capable, false);
        assert.ok(
          ['provider_not_configured', 'agent_server_url_unset'].includes(env.reason)
            || env.status === 'BLOCKED'
            || env.status === 'READY'
        );
      }
    } finally {
      await mock.close();
    }
  })
)
  passed++;
else failed++;

if (
  await testAsync('mock HTTP governed E2E — runtime ≠ verification authority', async () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const mock = await startMockAgentServerProcess();
    const dir = makeTempProject();
    try {
      const registry = createRuntimeRegistry();
      registry.register(
        createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
      );
      const result = coordinateGovernedExecution({
        project_dir: dir,
        task_id: 'S15-MOCK-1',
        objective: 'write stage15 marker',
        execute: true,
        execution_id: 's15-mock-1',
        operation: {
          type: 'write_file',
          path: 'docs/project/stage15-marker.md',
          content: 's15\n',
        },
        allowed_paths: ['docs/**'],
        agent_id: 'docs-sync',
        runtime_registry: registry,
        backend_id: 'openhands',
      });
      assert.equal(result.governed.status, 'COMPLETED');
      assert.equal(result.governed.backend_id, 'openhands');
      assert.equal(result.governed.runtime_evidence.kind, 'runtime_native_evidence');
      assert.equal(result.governed.governance_evidence.kind, 'forgeos_governance_evidence');
      assert.ok(fs.existsSync(path.join(dir, 'docs/project/stage15-marker.md')));
    } finally {
      await mock.close();
    }
  })
)
  passed++;
else failed++;

if (
  await testAsync('require_live_provider blocks start without provider', async () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const mock = await startMockAgentServerProcess();
    const dir = makeTempProject();
    const prevKey = process.env.OPENHANDS_LLM_API_KEY;
    delete process.env.OPENHANDS_LLM_API_KEY;
    try {
      const registry = createRuntimeRegistry();
      registry.register(
        createOpenHandsBackend({
          transport: 'http',
          baseUrl: mock.baseUrl,
          require_live_provider: true,
          provider_configured: false,
        })
      );
      const result = executeGoverned({
        task_id: 'S15-PROV',
        project_dir: dir,
        objective: 'provider gate',
        operation: { type: 'noop' },
        evaluate_policy: false,
        policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
        registry,
        backend_id: 'openhands',
        execution_id: 's15-prov',
      });
      assert.ok(['START_FAILED', 'ROUTING_FAILED'].includes(result.status), result.status);
      assert.notEqual(result.backend_id, 'local-executor');
    } finally {
      if (prevKey != null) process.env.OPENHANDS_LLM_API_KEY = prevKey;
      await mock.close();
    }
  })
)
  passed++;
else failed++;

if (
  await testAsync('explicit openhands unavailable — no fallback to local-executor', async () => {
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
      task_id: 'S15-NOFB',
      project_dir: dir,
      objective: 'no fallback',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
      registry,
      backend_id: 'openhands',
      execution_id: 's15-nofb',
    });
    assert.ok(['ROUTING_FAILED', 'START_FAILED'].includes(result.status), result.status);
    assert.notEqual(result.backend_id, 'local-executor');
  })
)
  passed++;
else failed++;

if (
  await testAsync('router explicit openhands — NO_COMPATIBLE when unhealthy', async () => {
    const registry = createRuntimeRegistry();
    registry.register(
      createOpenHandsBackend({ healthStatus: 'unavailable', transport: 'probe' })
    );
    const decision = route({
      task: { task_id: 'S15-R', requirements: {} },
      registry,
      backend_id: 'openhands',
    });
    assert.notEqual(decision.status, 'ROUTED');
    assert.ok(
      ['NO_COMPATIBLE_BACKEND', 'BACKEND_UNAVAILABLE', 'ROUTING_FAILED'].includes(decision.status)
        || decision.status !== 'ROUTED',
      decision.status
    );
  })
)
  passed++;
else failed++;

if (
  await testAsync('cancellation not success', async () => {
    clearLifecycleStore();
    clearOpenHandsRuns();
    const mock = await startMockAgentServerProcess();
    const dir = makeTempProject();
    try {
      const backend = createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl });
      const registry = createRuntimeRegistry();
      registry.register(backend);
      const result = executeGoverned({
        task_id: 'S15-CANCEL',
        project_dir: dir,
        objective: 'cancel',
        operation: {
          type: 'write_file',
          path: 'docs/project/c.md',
          content: 'c',
        },
        allowed_paths: ['docs/**'],
        agent_id: 'docs-sync',
        registry,
        backend_id: 'openhands',
        execution_id: 's15-cancel',
      });
      assert.equal(result.status, 'COMPLETED');
      const cancelled = cancelGoverned({
        task_id: 'S15-CANCEL',
        run_handle: result.run_handle,
        registry,
      });
      assert.equal(cancelled.ok, true);
      assert.equal(cancelled.status, 'CANCELLED');
      assert.notEqual(cancelled.status, 'COMPLETED');
    } finally {
      await mock.close();
    }
  })
)
  passed++;
else failed++;

if (
  await testAsync('malformed / timeout / server unavailable', async () => {
    const backend = createOpenHandsBackend({
      transport: 'http',
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 800,
    });
    const h = backend.health();
    assert.ok(['unavailable', 'unhealthy'].includes(h.status), h.status);

    clearLifecycleStore();
    clearOpenHandsRuns();
    const dir = makeTempProject();
    const registry = createRuntimeRegistry();
    registry.register(backend);
    const result = executeGoverned({
      task_id: 'S15-DOWN',
      project_dir: dir,
      objective: 'down',
      operation: { type: 'noop' },
      evaluate_policy: false,
      policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
      registry,
      backend_id: 'openhands',
      execution_id: 's15-down',
    });
    assert.ok(['ROUTING_FAILED', 'START_FAILED'].includes(result.status), result.status);
  })
)
  passed++;
else failed++;

if (
  await testAsync('live proof gate — BLOCKED or real (never fake PASS)', async () => {
    const proof = await runOpenHandsLiveProof({});
    const urlSet = Boolean(process.env.OPENHANDS_AGENT_SERVER_URL);
    const providerSet = isOpenHandsProviderConfigured({});
    if (!urlSet || !providerSet) {
      assert.equal(proof.ok, false);
      assert.ok(['BLOCKED', 'NOT_RUN'].includes(proof.live_e2e) || proof.status === 'BLOCKED');
      assert.ok(
        ['agent_server_url_unset', 'provider_not_configured', 'health_failed', 'ready_failed', 'agent_server_unreachable']
          .includes(proof.reason)
          || proof.environment?.reason,
        proof.reason
      );
      assert.notEqual(proof.live_e2e, 'PASS');
      console.log(
        `        Live Environment: BLOCKED (${proof.reason || proof.environment?.reason})`
      );
      console.log('        Live E2E: NOT_RUN / BLOCKED (not labeled PASS)');
    } else {
      // Real environment — report truth without forcing PASS
      console.log(`        Live Environment: ${proof.environment?.status}`);
      console.log(`        Live E2E: ${proof.live_e2e}`);
      assert.ok(['PASS', 'BLOCKED'].includes(proof.live_e2e));
    }
  })
)
  passed++;
else failed++;

console.log(`\nStage 15 OpenHands: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
