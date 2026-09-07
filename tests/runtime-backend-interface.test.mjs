#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 3 — Runtime Backend Interface contract tests
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateRuntimeBackend,
  normalizeBackendCapabilities,
  createRunRequest,
  createRunHandle,
  createHealthResult,
  createEvidenceBundle,
  createVerificationAssessment,
  createRuntimeError,
  createCanHandleResult,
  resolveOverallExecutionDecision,
  assertRunStartAllowed,
  assertCancelTaskIsolation,
  matchBackendCapabilities,
  HEALTH_STATUSES,
  RUNTIME_ERROR_CODES,
  RuntimeBackendContract,
} from '../runtime/backend-interface.mjs';
import {
  createContractProbeBackend,
  clearContractProbeStore,
} from './fixtures/runtime-backend/contract-probe.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';
import { getHostAdapter } from '../runtime/host-registry.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearContractProbeStore();
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

console.log('Runtime Backend Interface (Stage 3)\n');

test('contract validity — probe backend satisfies contract', () => {
  const backend = createContractProbeBackend();
  const v = validateRuntimeBackend(backend);
  assert(v.valid, v.issues.join(','));
  assert(backend._fixture === true);
  assert(backend.id === 'contract-probe');
});

test('contract validity — missing identity rejected', () => {
  const v = validateRuntimeBackend({
    name: 'x',
    version: '1',
    capabilities: {},
    health() {},
    canHandle() {},
    start() {},
    cancel() {},
    collectEvidence() {},
  });
  assert(!v.valid);
  assert(v.issues.includes('missing_id'));
});

test('contract validity — invalid capabilities rejected', () => {
  let threw = false;
  try {
    normalizeBackendCapabilities({ languages: {} });
  } catch {
    threw = true;
  }
  assert(threw, 'expected languages object to throw');
  const v = validateRuntimeBackend({
    id: 'x',
    name: 'x',
    version: '1',
    capabilities: { languages: 'js' },
    health() {},
    canHandle() {},
    start() {},
    cancel() {},
    collectEvidence() {},
  });
  assert(!v.valid);
  assert(v.issues.some((i) => i.startsWith('invalid_capabilities')));
});

test('capability semantics — capability ≠ permission', () => {
  const caps = normalizeBackendCapabilities({
    interactive: true,
    autonomous: true,
    sandbox: true,
    languages: ['go'],
  });
  assert(caps.interactive === true);
  const match = matchBackendCapabilities(caps, { language: 'rust' });
  assert(match.match === false);
  assert(match.authorization === null);
  assert(match.reasons.some((r) => r.code === 'unsupported_language'));
});

test('capability semantics — canHandle does not authorize', () => {
  const backend = createContractProbeBackend();
  const r = backend.canHandle({ requirements: { sandbox: true } }, null, {});
  assert(r.match === true);
  assert(r.authorization === null);
  const no = createCanHandleResult(true, []);
  assert(no.authorization === null);
});

test('policy boundary — ForgeOS DENY cannot become ALLOW', () => {
  const overall = resolveOverallExecutionDecision(
    { authority: POLICY_AUTHORITY, decision: 'deny', reason: 'tier3' },
    { permission: 'allow', note: 'runtime would allow' }
  );
  assert(overall.overall === 'deny');
  assert(overall.source === 'forgeos_policy');
});

test('policy boundary — ForgeOS ALLOW + runtime DENY → DENY', () => {
  const overall = resolveOverallExecutionDecision(
    { authority: POLICY_AUTHORITY, decision: 'allow' },
    { permission: 'deny', reason: 'sandbox' }
  );
  assert(overall.overall === 'deny');
  assert(overall.source === 'runtime_constraint');
});

test('policy boundary — runtime cannot claim non-forgeos authority', () => {
  let threw = false;
  try {
    createRunRequest({
      task_id: 'T-1',
      policy_decision: { authority: 'runtime', decision: 'allow' },
    });
  } catch {
    threw = true;
  }
  assert(threw);
});

test('policy boundary — start with DENY returns policy kind not runtime error', () => {
  const backend = createContractProbeBackend();
  const req = createRunRequest({
    task_id: 'TASK-A',
    policy_decision: { decision: 'deny', reason: 'protected_path' },
  });
  const gate = assertRunStartAllowed(req);
  assert(gate.ok === false && gate.kind === 'policy');
  assert(gate.runtime_error === null);
  const started = backend.start(req);
  assert(started.kind === 'policy');
  assert(started.handle === null);
});

test('task isolation — cancel Task B cannot mutate Task A run', () => {
  const backend = createContractProbeBackend();
  const req = createRunRequest({
    task_id: 'TASK-A',
    policy_decision: { decision: 'allow' },
  });
  const started = backend.start(req);
  assert(started.kind === 'started');
  const cancel = backend.cancel(started.handle, 'TASK-B');
  assert(cancel.ok === false);
  assert(cancel.error.code === 'TASK_MISMATCH');
  assert(cancel.authorization === null);
  const iso = assertCancelTaskIsolation(started.handle, 'TASK-B');
  assert(iso.ok === false);
});

test('evidence — normalized bundle and unavailable distinct from policy deny', () => {
  const bundle = createEvidenceBundle({
    run_id: 'r1',
    task_id: 't1',
    backend_id: 'contract-probe',
    unavailable: true,
    notes: 'EVIDENCE_UNAVAILABLE',
  });
  assert(bundle.kind === 'runtime_native_evidence');
  assert(bundle.unavailable === true);
  assert(bundle.authority == null);
  const err = createRuntimeError('EVIDENCE_UNAVAILABLE', 'missing');
  assert(err.kind === 'runtime_error');
  assert(!RUNTIME_ERROR_CODES.includes('POLICY_DENY'));
});

test('verification — runtime exit ≠ ForgeOS satisfaction', () => {
  const runtimeResults = [{ command: 'npm test', exit_code: 0, passed: true }];
  const assessment = createVerificationAssessment({
    satisfied: false,
    task_id: 'T-1',
    required_commands: ['npm test', 'npm run lint'],
    runtime_results: runtimeResults,
    reason: 'lint not reported',
  });
  assert(assessment.kind === 'forgeos_verification_assessment');
  assert(assessment.authority === POLICY_AUTHORITY);
  assert(assessment.satisfied === false);
  assert(runtimeResults[0].passed === true);
});

test('health — four statuses distinguishable', () => {
  for (const status of HEALTH_STATUSES) {
    const h = createHealthResult(status);
    assert(h.status === status);
  }
  const backend = createContractProbeBackend({ healthStatus: 'unavailable' });
  assert(backend.health().status === 'unavailable');
  const no = backend.canHandle({}, null, { sandbox: true });
  assert(no.match === false);
});

test('runRequest / RunHandle preserve task identity', () => {
  const req = createRunRequest({
    task_id: 'FORGEOS-20260903-001',
    objective: 'probe',
    policy_decision: { decision: 'allow' },
    verification_commands: ['npm test', { command: 'npm run build' }],
    allowed_paths: ['src/**'],
    forbidden_paths: ['.cursor/**'],
  });
  assert(req.task_id === 'FORGEOS-20260903-001');
  assert(req.policy_decision.authority === POLICY_AUTHORITY);
  assert(req.verification_commands.length === 2);
  const handle = createRunHandle({
    run_id: 'run-1',
    task_id: req.task_id,
    backend_id: 'contract-probe',
    status: 'running',
  });
  assert(handle.task_id === req.task_id);
});

test('Cursor remains Host Adapter — not a Runtime Backend', () => {
  const cursor = getHostAdapter('cursor');
  assert(cursor.id === 'cursor');
  assert(cursor.capabilities.hooks === true);
  const asBackend = validateRuntimeBackend(cursor);
  assert(!asBackend.valid, 'cursor host must not satisfy RuntimeBackend methods');
  assert(asBackend.issues.some((i) => i.startsWith('missing_method')));
});

test('docs + schema exist', () => {
  assert(fs.existsSync(path.join(ROOT, 'docs/architecture/RUNTIME-BACKEND-INTERFACE.md')));
  assert(fs.existsSync(path.join(ROOT, 'schemas/runtime-backend-interface.schema.yaml')));
  assert(RuntimeBackendContract.version === '1');
});

test('Runtime Router module exists (Stage 4) but is selection-only', () => {
  assert(fs.existsSync(path.join(ROOT, 'runtime/router.mjs')));
  assert(fs.existsSync(path.join(ROOT, 'runtime/registry.mjs')));
  const routerSrc = fs.readFileSync(path.join(ROOT, 'runtime/router.mjs'), 'utf8');
  // Ignore comments/strings; ensure no executable start/cancel/collectEvidence calls.
  const codeOnly = routerSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`[\s\S]*?`/g, '""')
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""');
  assert(!/\.start\s*\(/.test(codeOnly), 'router must not call .start(');
  assert(!/\.cancel\s*\(/.test(codeOnly), 'router must not call .cancel(');
  assert(!/\.collectEvidence\s*\(/.test(codeOnly), 'router must not call .collectEvidence(');
  const backendsDir = path.join(ROOT, 'runtime/backends');
  if (fs.existsSync(backendsDir)) {
    const names = fs.readdirSync(backendsDir);
    assert(names.length === 0, `unexpected backends: ${names.join(',')}`);
  }
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
