#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 4 — Runtime Router tests
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { route, RuntimeRouter, ROUTE_STATUSES } from '../runtime/router.mjs';
import { createContractProbeBackend } from './fixtures/runtime-backend/contract-probe.mjs';
import { createRunRequest } from '../runtime/backend-interface.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { getHostAdapter } from '../runtime/host-registry.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  if (!cond) throw new Error(msg || 'assertion failed');
}

function allowPolicy(extra = {}) {
  return {
    authority: POLICY_AUTHORITY,
    decision: 'allow',
    reason: 'test_allow',
    ...extra,
  };
}

function denyPolicy(extra = {}) {
  return {
    authority: POLICY_AUTHORITY,
    decision: 'deny',
    reason: 'test_deny',
    ...extra,
  };
}

console.log('Runtime Router (Stage 4)\n');

test('empty registry → NO_BACKENDS_REGISTERED', () => {
  const registry = createRuntimeRegistry();
  const d = route({
    task: { task_id: 'T-1' },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'NO_BACKENDS_REGISTERED');
  assert(d.backend_id === null);
  assert(d.task_id === 'T-1');
  assert(d.execution === null);
});

test('valid registration + list/get', () => {
  const registry = createRuntimeRegistry();
  const backend = createContractProbeBackend({ id: 'probe-a' });
  const r = registry.register(backend);
  assert(r.ok);
  assert(registry.get('probe-a')?.id === 'probe-a');
  assert(registry.list().length === 1);
});

test('invalid registration rejected', () => {
  const registry = createRuntimeRegistry();
  const r = registry.register({ id: 'bad', name: 'Bad' });
  assert(!r.ok);
  assert(r.error === 'CONTRACT_INVALID');
  assert(registry.size() === 0);
});

test('duplicate backend id rejected', () => {
  const registry = createRuntimeRegistry();
  assert(registry.register(createContractProbeBackend({ id: 'dup' })).ok);
  const r = registry.register(createContractProbeBackend({ id: 'dup' }));
  assert(!r.ok && r.error === 'DUPLICATE_BACKEND_ID');
});

test('Invariant 1 — ForgeOS DENY → no backend selected', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'probe-deny' }));
  const d = route({
    task: { task_id: 'T-DENY' },
    policyContext: denyPolicy(),
    registry,
  });
  assert(d.status === 'DENIED');
  assert(d.backend_id === null);
  assert(d.policy_decision.authority === POLICY_AUTHORITY);
  assert(d.candidates.length === 0);
});

test('Invariant 2 — ALLOW + incompatible → NO_COMPATIBLE_BACKEND', () => {
  const registry = createRuntimeRegistry();
  registry.register(
    createContractProbeBackend({
      id: 'probe-js',
      capabilities: { languages: ['javascript'], sandbox: false },
    })
  );
  const d = route({
    task: { task_id: 'T-INCOMP', requirements: { language: 'rust', sandbox: true } },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'NO_COMPATIBLE_BACKEND');
  assert(d.backend_id === null);
  assert(d.policy_decision.decision === 'allow');
});

test('Invariant 3 — ALLOW + compatible → ROUTED', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'probe-ok' }));
  const d = route({
    task: { task_id: 'T-OK', requirements: { sandbox: true } },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'ROUTED');
  assert(d.backend_id === 'probe-ok');
  assert(d.authorization === null);
});

test('Invariant 4 — capability ≠ authorization', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'probe-cap' }));
  const d = route({
    task: { task_id: 'T-CAP' },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'ROUTED');
  assert(d.authorization === null);
  assert(d.candidates[0].can_handle.authorization === null);
});

test('Invariant 5 — unhealthy backend not selected', () => {
  const registry = createRuntimeRegistry();
  registry.register(
    createContractProbeBackend({ id: 'probe-sick', healthStatus: 'unhealthy' })
  );
  const d = route({
    task: { task_id: 'T-SICK' },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'NO_COMPATIBLE_BACKEND');
  assert(d.candidates[0].reasons.some((r) => r.code === 'backend_unhealthy'));
});

test('unavailable and unknown health not selected', () => {
  for (const healthStatus of ['unavailable', 'unknown']) {
    const registry = createRuntimeRegistry();
    registry.register(createContractProbeBackend({ id: `probe-${healthStatus}`, healthStatus }));
    const d = route({
      task: { task_id: `T-${healthStatus}` },
      policyContext: allowPolicy(),
      registry,
    });
    assert(d.status === 'NO_COMPATIBLE_BACKEND', healthStatus);
  }
});

test('Invariant 6 — Task A route ≠ Task B authorization', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'probe-iso' }));
  const a = route({
    task: { task_id: 'TASK-A' },
    policyContext: allowPolicy(),
    registry,
  });
  const b = route({
    task: { task_id: 'TASK-B' },
    policyContext: denyPolicy(),
    registry,
  });
  assert(a.status === 'ROUTED' && a.task_id === 'TASK-A');
  assert(b.status === 'DENIED' && b.task_id === 'TASK-B');
  assert(a.backend_id !== null);
  assert(b.backend_id === null);
});

test('multiple compatible → registration order (first wins)', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'first' }));
  registry.register(createContractProbeBackend({ id: 'second' }));
  const d = route({
    task: { task_id: 'T-MULTI' },
    policyContext: allowPolicy(),
    registry,
  });
  assert(d.status === 'ROUTED');
  assert(d.backend_id === 'first');
  assert(d.selection.strategy === 'registration_order');
  assert(d.selection.eligible_count === 2);
  assert(d.selection.note);
});

test('explicit backend selection when eligible', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'first' }));
  registry.register(createContractProbeBackend({ id: 'second' }));
  const d = route({
    task: { task_id: 'T-EX' },
    policyContext: allowPolicy(),
    backend_id: 'second',
    registry,
  });
  assert(d.status === 'ROUTED');
  assert(d.backend_id === 'second');
  assert(d.selection.strategy === 'explicit_backend_id');
});

test('explicit nonexistent backend → NO_COMPATIBLE_BACKEND', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'only' }));
  const d = route({
    task: { task_id: 'T-MISS' },
    policyContext: allowPolicy(),
    backend_id: 'does-not-exist',
    registry,
  });
  assert(d.status === 'NO_COMPATIBLE_BACKEND');
  assert(d.reasons.some((r) => r.code === 'explicit_backend_not_found'));
});

test('explicit backend still requires policy ALLOW', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'explicit' }));
  const d = route({
    task: { task_id: 'T-EX-DENY' },
    policyContext: denyPolicy(),
    backend_id: 'explicit',
    registry,
  });
  assert(d.status === 'DENIED');
  assert(d.backend_id === null);
});

test('explicit unhealthy backend not routed', () => {
  const registry = createRuntimeRegistry();
  registry.register(
    createContractProbeBackend({ id: 'explicit-sick', healthStatus: 'unhealthy' })
  );
  const d = route({
    task: { task_id: 'T-EX-SICK' },
    policyContext: allowPolicy(),
    backend_id: 'explicit-sick',
    registry,
  });
  assert(d.status === 'NO_COMPATIBLE_BACKEND');
});

test('INVALID_REQUEST when task_id missing', () => {
  const d = route({
    task: {},
    policyContext: allowPolicy(),
    registry: createRuntimeRegistry(),
  });
  assert(d.status === 'INVALID_REQUEST');
});

test('INVALID_REQUEST when policy authority is not forgeos', () => {
  let threw = false;
  try {
    route({
      task: { task_id: 'T-1' },
      policyContext: { authority: 'runtime', decision: 'allow' },
      registry: createRuntimeRegistry(),
    });
  } catch {
    threw = true;
  }
  // Router catches and returns INVALID_REQUEST
  const d = route({
    task: { task_id: 'T-1' },
    policyContext: { authority: 'runtime', decision: 'allow' },
    registry: createRuntimeRegistry(),
  });
  assert(d.status === 'INVALID_REQUEST' || threw);
});

test('routing evidence present on ROUTED', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'ev' }));
  const d = route({
    task: { task_id: 'T-EV' },
    policyContext: allowPolicy({ allowed_paths: ['src/**'] }),
    registry,
  });
  assert(d.evidence?.selected_backend_id === 'ev');
  assert(d.evidence?.policy_decision?.decision === 'allow');
  assert(d.evidence.task_id === 'T-EV');
});

test('Router never calls start during route()', () => {
  const registry = createRuntimeRegistry();
  let startCalls = 0;
  const backend = createContractProbeBackend({ id: 'no-start' });
  const originalStart = backend.start.bind(backend);
  backend.start = (...args) => {
    startCalls++;
    return originalStart(...args);
  };
  registry.register(backend);
  route({
    task: { task_id: 'T-NS' },
    policyContext: allowPolicy(),
    registry,
  });
  assert(startCalls === 0, `start called ${startCalls} times`);
});

test('no router-local policy engine / rules', () => {
  assert(!fs.existsSync(path.join(ROOT, 'runtime/rules.json')));
  assert(!fs.existsSync(path.join(ROOT, 'router/rules.json')));
  assert(!fs.existsSync(path.join(ROOT, 'runtime/policy-engine.mjs')));
  const routerSrc = fs.readFileSync(path.join(ROOT, 'runtime/router.mjs'), 'utf8');
  assert(!/tier_3_operations|protected_path_prefixes/.test(routerSrc));
});

test('Host registry ≠ Runtime registry', () => {
  const cursor = getHostAdapter('cursor');
  const registry = createRuntimeRegistry();
  assert(cursor.id === 'cursor');
  assert(registry.get('cursor') == null);
  assert(ROUTE_STATUSES.includes('DENIED'));
  assert(RuntimeRouter.selection_strategy === 'registration_order');
});

test('prepareRunRequestFromRoute drafts without starting', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'draft' }));
  const d = route({
    task: { task_id: 'T-DRAFT', objective: 'x' },
    policyContext: allowPolicy(),
    registry,
  });
  const prep = RuntimeRouter.prepareRunRequestFromRoute(d, { objective: 'x' });
  assert(prep.ok);
  assert(prep.draft.task_id === 'T-DRAFT');
  assert(prep.draft.backend_id === 'draft');
  const req = createRunRequest({
    task_id: prep.draft.task_id,
    objective: prep.draft.objective,
    policy_decision: prep.draft.policy_decision,
  });
  assert(req.task_id === 'T-DRAFT');
});

test('docs exist', () => {
  assert(fs.existsSync(path.join(ROOT, 'docs/architecture/RUNTIME-ROUTER.md')));
});

test('unregister works', () => {
  const registry = createRuntimeRegistry();
  registry.register(createContractProbeBackend({ id: 'gone' }));
  assert(registry.unregister('gone').ok);
  assert(registry.get('gone') == null);
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
