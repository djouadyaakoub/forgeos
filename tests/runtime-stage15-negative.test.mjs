/**
 * Stage 15 — Negative / architecture boundary tests for OpenHands Runtime
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
} from '../runtime/execution.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';
import {
  createOpenHandsBackend,
  clearOpenHandsRuns,
  redactSecrets,
} from '../runtime/adapters/openhands/index.mjs';
import { startMockAgentServerProcess } from '../runtime/adapters/openhands/mock-process.mjs';
import { httpRequestSync } from '../runtime/adapters/openhands/http-sync.mjs';
import { resolveCapabilityOperation, resolverDoesNotExecute } from '../intelligence/capability/resolver.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s15n-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: s15n\n  name: s15n\n  type: application\n',
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

console.log('Stage 15 — Negative / security / architecture\n');

test('OpenHands adapter cannot claim Policy Authority', () => {
  const backend = createOpenHandsBackend({ transport: 'probe' });
  assert.equal(backend._claims_policy_authority, false);
  assert.ok(!/policy.?authority/i.test(JSON.stringify(backend.capabilities)));
});

test('Resolver cannot execute / does not call backend.start', () => {
  assert.equal(resolverDoesNotExecute(), true);
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/capability/resolver.mjs'), 'utf8'));
  assert.ok(!/\bexecuteGoverned\b/.test(src));
  assert.ok(!/backend\.start\s*\(/.test(src));
  assert.ok(!/createOpenHandsBackend/.test(src));
  const r = resolveCapabilityOperation({
    operation_id: 'create-missing-project-docs',
    preference: 'oss_backed',
    runtime_backend_id: 'openhands',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
  assert.equal(r.implementation_type, 'oss_backed');
});

test('Router source does not evaluate Policy as authority or invent lifecycle', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'runtime/router.mjs'), 'utf8'));
  assert.ok(!/from ['"].*policy\/authority/.test(src));
  assert.ok(!/\bevaluate\s*\(/.test(src));
  assert.ok(!/SATISFIED/.test(src));
  assert.ok(!/createVerificationAssessment/.test(src));
});

test('OpenHands adapter source cannot mark verification PASS or Canvas SATISFIED', () => {
  const files = [
    'runtime/adapters/openhands/index.mjs',
    'runtime/adapters/openhands/environment-gate.mjs',
    'runtime/adapters/openhands/live-proof.mjs',
    'runtime/adapters/openhands/mapping.mjs',
    'runtime/adapters/openhands/client.mjs',
  ];
  for (const rel of files) {
    const src = strip(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bSATISFIED\b/.test(src), rel);
    assert.ok(!/markCanvas|canvas\.satisfied|setSatisfied/.test(src), rel);
    assert.ok(!/claims_policy_authority\s*[:=]\s*true/.test(src), rel);
  }
});

test('OpenHands adapter does not modify Project Intelligence authority modules', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'runtime/adapters/openhands/index.mjs'), 'utf8'));
  assert.ok(!/project-intelligence-contract/.test(src));
  assert.ok(!/writeProjectIntelligence|persistProjectYaml/.test(src));
});

test('Only executeGoverned path starts backends — no second lifecycle in openhands live-proof', () => {
  const live = strip(fs.readFileSync(path.join(REPO, 'runtime/adapters/openhands/live-proof.mjs'), 'utf8'));
  assert.ok(/coordinateGovernedExecution|executeGoverned/.test(live));
  assert.ok(!/backend\.start\s*\(/.test(live));
  assert.ok(!/startConversationSync/.test(live));
});

test('OpenHands not bundled as Core dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const all = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  for (const name of Object.keys(all)) {
    assert.ok(!/openhands/i.test(name), name);
  }
});

await testAsync('Policy DENY → zero OpenHands HTTP POSTs', async () => {
  clearLifecycleStore();
  clearOpenHandsRuns();
  const mock = await startMockAgentServerProcess();
  const dir = makeDir();
  try {
    const registry = createRuntimeRegistry();
    registry.register(
      createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
    );
    const before = mockPostCount(mock.baseUrl);
    const result = executeGoverned({
      task_id: 'S15N-DENY',
      project_dir: dir,
      objective: 'protected',
      operation: { type: 'write_file', path: '.cursor/hooks.json', content: 'x' },
      allowed_paths: ['.cursor/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 's15n-deny',
    });
    assert.equal(result.status, 'POLICY_DENIED');
    assert.equal(mockPostCount(mock.baseUrl), before);
  } finally {
    await mock.close();
  }
});

await testAsync('Protected path DENY — OpenHands cannot authorize', async () => {
  clearLifecycleStore();
  const mock = await startMockAgentServerProcess();
  const dir = makeDir();
  try {
    const registry = createRuntimeRegistry();
    registry.register(
      createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl })
    );
    const result = executeGoverned({
      task_id: 'S15N-PROT',
      project_dir: dir,
      objective: 'policy',
      operation: { type: 'write_file', path: 'policy/rules.json', content: '{}' },
      allowed_paths: ['policy/**'],
      agent_id: 'codebase-organization',
      registry,
      backend_id: 'openhands',
      execution_id: 's15n-prot',
    });
    assert.ok(
      ['POLICY_DENIED', 'START_FAILED'].includes(result.status)
        || result.policy_decision?.decision === 'deny'
        || result.status === 'POLICY_DENIED',
      result.status
    );
    // Regardless of path classification, OpenHands must not become authority
    assert.equal(result.governance_evidence?.authority || POLICY_AUTHORITY, POLICY_AUTHORITY);
  } finally {
    await mock.close();
  }
});

await testAsync('No automatic fallback OpenHands → Local Executor', async () => {
  clearLifecycleStore();
  const dir = makeDir();
  const registry = createRuntimeRegistry();
  registry.register(
    createOpenHandsBackend({
      transport: 'http',
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 1200,
    })
  );
  registry.register(createLocalExecutorBackend());
  const result = executeGoverned({
    task_id: 'S15N-FB',
    project_dir: dir,
    objective: 'no silent fallback',
    operation: { type: 'noop' },
    evaluate_policy: false,
    policy_decision: { authority: POLICY_AUTHORITY, decision: 'allow', reason: 't' },
    registry,
    backend_id: 'openhands',
    execution_id: 's15n-fb',
  });
  assert.ok(['ROUTING_FAILED', 'START_FAILED'].includes(result.status), result.status);
  assert.notEqual(result.backend_id, 'local-executor');
});

await testAsync('Scope mismatch / canHandle does not start OpenHands', async () => {
  const mock = await startMockAgentServerProcess();
  try {
    const backend = createOpenHandsBackend({ transport: 'http', baseUrl: mock.baseUrl });
    const before = mockPostCount(mock.baseUrl);
    const r = backend.canHandle(
      {
        execution_constraints: { project_dir: path.join(os.tmpdir(), 'other') },
        operation: { implementation_types: ['oss_backed'] },
      },
      { project_dir: makeDir() },
      {}
    );
    assert.equal(r.match, false);
    assert.equal(mockPostCount(mock.baseUrl), before);
  } finally {
    await mock.close();
  }
});

await testAsync('Secrets never persist in evidence notes', async () => {
  const secret = ['sk-', 'liveproofsecretkey99'].join('');
  const redacted = redactSecrets({ notes: `key=${secret}`, api_key: secret });
  const dumped = JSON.stringify(redacted);
  assert.equal(dumped.includes(secret), false);
});

test('Cursor Stage 12 unchanged — host_native interactive not substituted', () => {
  const host = fs.readFileSync(path.join(REPO, 'host/adapters/cursor/index.mjs'), 'utf8');
  assert.ok(/programmatic_agent_start/.test(host) || /interactive/.test(host));
  // OpenHands remains separate provider id
  const backend = createOpenHandsBackend({ transport: 'probe' });
  assert.equal(backend.id, 'openhands');
  assert.notEqual(backend.id, 'cursor');
});

console.log(`\nStage 15 Negative: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
