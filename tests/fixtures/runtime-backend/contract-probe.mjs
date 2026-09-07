/**
 * Contract-probe RuntimeBackend — test/documentation fixture only.
 *
 * This is NOT a production runtime adapter.
 * It does NOT claim to be Cline, OpenHands, Codex, Claude, or Cursor.
 * It exists solely so Stage 3 can validate the Runtime Backend Interface.
 */
import {
  validateRuntimeBackend,
  normalizeBackendCapabilities,
  createHealthResult,
  createCanHandleResult,
  createRunHandle,
  createCancelResult,
  createEvidenceBundle,
  createRuntimeError,
  matchBackendCapabilities,
  assertRunStartAllowed,
  assertCancelTaskIsolation,
} from '../../../runtime/backend-interface.mjs';

const STORE = new Map();

export function createContractProbeBackend(overrides = {}) {
  const capabilities = normalizeBackendCapabilities({
    interactive: true,
    autonomous: false,
    sandbox: true,
    parallel: false,
    pr_delivery: false,
    hooks_callback: false,
    cost_telemetry: false,
    languages: ['javascript', 'typescript'],
    ...(overrides.capabilities || {}),
  });

  const healthStatus = overrides.healthStatus || 'healthy';

  const backend = {
    id: overrides.id || 'contract-probe',
    name: overrides.name || 'Contract Probe Backend',
    version: overrides.version || '0.0.0-test',
    capabilities,
    _fixture: true,
    _note: 'Stage 3 contract probe only — not a real runtime backend',

    health() {
      return createHealthResult(healthStatus, { fixture: true });
    },

    canHandle(task, _projectIntelligence, policyRequirements = {}) {
      const health = this.health();
      if (health.status === 'unavailable') {
        return createCanHandleResult(false, [
          { code: 'backend_unavailable', message: 'backend unavailable' },
        ]);
      }
      if (health.status === 'unhealthy') {
        return createCanHandleResult(false, [
          { code: 'backend_unhealthy', message: 'backend unhealthy' },
        ]);
      }
      const reqs = {
        ...(policyRequirements || {}),
        ...(task?.requirements || {}),
      };
      return matchBackendCapabilities(this.capabilities, reqs);
    },

    start(runRequest) {
      const gate = assertRunStartAllowed(runRequest);
      if (!gate.ok) {
        // Policy deny remains policy — do not convert to runtime error.
        return { kind: 'policy', policy_decision: gate.policy_decision, handle: null };
      }
      const handle = createRunHandle({
        run_id: `probe-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        task_id: runRequest.task_id,
        backend_id: this.id,
        status: 'running',
        started_at: new Date().toISOString(),
      });
      STORE.set(handle.run_id, { handle, request: runRequest });
      return { kind: 'started', handle, policy_decision: gate.policy_decision };
    },

    cancel(runHandle, requestedTaskId) {
      const isolation = assertCancelTaskIsolation(runHandle, requestedTaskId ?? runHandle.task_id);
      if (!isolation.ok) {
        return createCancelResult({
          ok: false,
          run_id: runHandle.run_id,
          task_id: runHandle.task_id,
          backend_id: this.id,
          status: runHandle.status || 'running',
          error: isolation.error,
        });
      }
      const entry = STORE.get(isolation.handle.run_id);
      if (!entry) {
        return createCancelResult({
          ok: false,
          run_id: isolation.handle.run_id,
          task_id: isolation.handle.task_id,
          backend_id: this.id,
          status: 'unknown',
          error: createRuntimeError('CANCEL_FAILED', 'unknown run'),
        });
      }
      entry.handle = { ...entry.handle, status: 'cancelled', updated_at: new Date().toISOString() };
      STORE.set(entry.handle.run_id, entry);
      return createCancelResult({
        ok: true,
        run_id: entry.handle.run_id,
        task_id: entry.handle.task_id,
        backend_id: this.id,
        status: 'cancelled',
      });
    },

    collectEvidence(runHandle) {
      const entry = STORE.get(runHandle.run_id);
      if (!entry) {
        return createEvidenceBundle({
          run_id: runHandle.run_id,
          task_id: runHandle.task_id,
          backend_id: this.id,
          unavailable: true,
          execution_status: 'unknown',
          notes: 'EVIDENCE_UNAVAILABLE',
        });
      }
      return createEvidenceBundle({
        run_id: entry.handle.run_id,
        task_id: entry.handle.task_id,
        backend_id: this.id,
        execution_status: entry.handle.status,
        changed_files: [],
        commands_executed: [],
        verification_results: (entry.request.verification_commands || []).map((command) => ({
          command,
          exit_code: 0,
          passed: true,
        })),
      });
    },
  };

  const validation = validateRuntimeBackend(backend);
  if (!validation.valid) {
    throw new Error(`contract probe invalid: ${validation.issues.join(', ')}`);
  }
  return backend;
}

export function clearContractProbeStore() {
  STORE.clear();
}
