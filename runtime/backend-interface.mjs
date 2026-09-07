/**
 * ForgeOS Runtime Backend Interface — contract only (Architecture 2.0 Stage 3)
 *
 * ForgeOS Core remains the control plane. A Runtime Backend is an execution
 * mechanism for a future adapter (Cline / OpenHands / Codex / Claude / etc.).
 *
 * This module defines shapes, validators, and policy-boundary helpers.
 * It does NOT select backends, start LLM loops, or implement adapters.
 *
 * Host Adapter (Cursor/CLI) ≠ Runtime Backend.
 *
 * Canonical law:
 *   ForgeOS DENY  → runtime must not authorize the governed operation
 *   ForgeOS ALLOW → runtime may still DENY → overall DENY
 */
import { POLICY_AUTHORITY, PRODUCT_ID } from '../policy/identity.mjs';

export const RUNTIME_BACKEND_CONTRACT_VERSION = '1';

/** Capability flags are not permissions and never imply authorization. */
export const BACKEND_CAPABILITY_KEYS = [
  'interactive',
  'autonomous',
  'sandbox',
  'parallel',
  'pr_delivery',
  'hooks_callback',
  'cost_telemetry',
  'languages',
];

export const HEALTH_STATUSES = ['healthy', 'unhealthy', 'unavailable', 'unknown'];

export const RUN_HANDLE_STATUSES = [
  'pending',
  'running',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
  'unknown',
];

/**
 * Runtime operational errors — never used for ForgeOS policy denial.
 * Policy denial remains a Policy Authority decision (authority: forgeos).
 */
export const RUNTIME_ERROR_CODES = [
  'RUNTIME_UNAVAILABLE',
  'RUNTIME_UNHEALTHY',
  'UNSUPPORTED_REQUEST',
  'START_FAILED',
  'CANCEL_FAILED',
  'EVIDENCE_UNAVAILABLE',
  'VERIFICATION_INCOMPLETE',
  'CONTRACT_INVALID',
  'TASK_MISMATCH',
  'PROVIDER_NOT_CONFIGURED',
];

export const CAN_HANDLE_REASON_CODES = [
  'unsupported_language',
  'sandbox_unavailable',
  'interactive_unsupported',
  'autonomous_unsupported',
  'parallel_unsupported',
  'hooks_callback_unsupported',
  'evidence_unavailable',
  'backend_unhealthy',
  'backend_unavailable',
  'missing_task_id',
  'policy_deny_blocks_start',
  'policy_deny',
  'operation_not_oss_backed',
  'project_dir_mismatch',
  'openhands_capable',
  'other',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function normalizeVerificationCommands(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') return String(c.command || c.name || '');
      return '';
    })
    .filter(Boolean);
}

/**
 * Normalize backend capability declaration.
 * @throws on invalid shapes
 */
export function normalizeBackendCapabilities(raw = {}) {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid backend capabilities: expected object');
  }
  if (raw.languages != null && !Array.isArray(raw.languages)) {
    throw new Error('Invalid backend capabilities.languages: expected array');
  }
  return {
    interactive: Boolean(raw.interactive),
    autonomous: Boolean(raw.autonomous),
    sandbox: Boolean(raw.sandbox),
    parallel: Boolean(raw.parallel),
    pr_delivery: Boolean(raw.pr_delivery),
    hooks_callback: Boolean(raw.hooks_callback),
    cost_telemetry: Boolean(raw.cost_telemetry),
    languages: Array.isArray(raw.languages) ? raw.languages.map((l) => String(l)) : [],
  };
}

/**
 * Validate a RuntimeBackend descriptor (identity + capabilities + required methods).
 * Does not execute anything and does not register adapters.
 */
export function validateRuntimeBackend(backend) {
  const issues = [];
  if (!backend || typeof backend !== 'object') {
    return { valid: false, issues: ['missing_backend'], backend: null };
  }
  if (!backend.id || typeof backend.id !== 'string') issues.push('missing_id');
  if (!backend.name || typeof backend.name !== 'string') issues.push('missing_name');
  if (!backend.version || typeof backend.version !== 'string') issues.push('missing_version');

  try {
    normalizeBackendCapabilities(backend.capabilities || {});
  } catch (err) {
    issues.push(`invalid_capabilities:${err.message}`);
  }

  for (const method of ['health', 'canHandle', 'start', 'cancel', 'collectEvidence']) {
    if (typeof backend[method] !== 'function') {
      issues.push(`missing_method:${method}`);
    }
  }

  return { valid: issues.length === 0, issues, backend };
}

export function createHealthResult(status = 'unknown', detail = {}) {
  const normalized = HEALTH_STATUSES.includes(status) ? status : 'unknown';
  return {
    status: normalized,
    detail: isPlainObject(detail) ? detail : { message: String(detail) },
    product: PRODUCT_ID,
  };
}

/**
 * ForgeOS-owned policy decision envelope attached to a run request.
 * Rejects any attempt to claim non-forgeos authorization authority.
 */
export function createPolicyDecisionContext(input = {}) {
  const authority = input.authority || POLICY_AUTHORITY;
  if (authority !== POLICY_AUTHORITY) {
    throw new Error(
      `Invalid policyDecision.authority: expected '${POLICY_AUTHORITY}', got '${authority}'`
    );
  }
  const raw = String(input.decision || input.permission || '').toLowerCase();
  const decision = raw === 'allow' || raw === 'deny' ? raw : null;
  if (!decision) {
    throw new Error('Invalid policyDecision.decision: expected allow|deny');
  }
  return {
    authority: POLICY_AUTHORITY,
    decision,
    permission: decision === 'allow' ? 'allow' : 'deny',
    reason: input.reason || null,
    operation: input.operation || null,
    task_id: input.task_id || null,
    agent_id: input.agent_id || null,
    rule: input.rule || null,
  };
}

/**
 * Minimum ForgeOS-owned execution request for a future runtime adapter.
 * References project intelligence; does not duplicate the full contract.
 */
export function createRunRequest(input = {}) {
  const taskId = asString(input.task_id || input.taskId);
  if (!taskId) {
    throw new Error('runRequest.task_id is required');
  }

  const policyDecision = createPolicyDecisionContext({
    ...(input.policy_decision || input.policyDecision || {}),
    task_id: (input.policy_decision || input.policyDecision)?.task_id || taskId,
  });

  const policyReqs = isPlainObject(input.policy_requirements)
    ? input.policy_requirements
    : {};

  return {
    contract_version: RUNTIME_BACKEND_CONTRACT_VERSION,
    task_id: taskId,
    objective: asString(input.objective),
    project_intelligence: input.project_intelligence || input.projectIntelligence || null,
    policy_decision: policyDecision,
    policy_requirements: {
      allowed_paths: Array.isArray(input.allowed_paths)
        ? input.allowed_paths.map(String)
        : Array.isArray(policyReqs.allowed_paths)
          ? policyReqs.allowed_paths.map(String)
          : [],
      forbidden_paths: Array.isArray(input.forbidden_paths)
        ? input.forbidden_paths.map(String)
        : Array.isArray(policyReqs.forbidden_paths)
          ? policyReqs.forbidden_paths.map(String)
          : [],
      approval_scopes: Array.isArray(input.approval_scopes)
        ? input.approval_scopes.map(String)
        : Array.isArray(policyReqs.approval_scopes)
          ? policyReqs.approval_scopes.map(String)
          : [],
      ...Object.fromEntries(
        Object.entries(policyReqs).filter(
          ([k]) => !['allowed_paths', 'forbidden_paths', 'approval_scopes'].includes(k)
        )
      ),
    },
    isolation_requirements: isPlainObject(input.isolation_requirements)
      ? { ...input.isolation_requirements }
      : {},
    verification_commands: normalizeVerificationCommands(
      input.verification_commands ?? policyReqs.verification_commands
    ),
    evidence_requirements: Array.isArray(input.evidence_requirements)
      ? input.evidence_requirements.map(String)
      : [],
    /** Execution constraints delegated to the runtime — not ForgeOS authorization. */
    execution_constraints: isPlainObject(input.execution_constraints)
      ? { ...input.execution_constraints }
      : {},
    product: PRODUCT_ID,
  };
}

export function createRunHandle(input = {}) {
  const runId = asString(input.run_id || input.runId);
  const taskId = asString(input.task_id || input.taskId);
  const backendId = asString(input.backend_id || input.backendId);
  if (!runId) throw new Error('RunHandle.run_id is required');
  if (!taskId) throw new Error('RunHandle.task_id is required');
  if (!backendId) throw new Error('RunHandle.backend_id is required');
  const status = RUN_HANDLE_STATUSES.includes(input.status) ? input.status : 'unknown';
  return {
    run_id: runId,
    task_id: taskId,
    backend_id: backendId,
    status,
    started_at: input.started_at || null,
    updated_at: input.updated_at || null,
    product: PRODUCT_ID,
  };
}

export function createCanHandleResult(match, reasons = []) {
  const list = Array.isArray(reasons) ? reasons : [reasons].filter(Boolean);
  return {
    match: Boolean(match),
    reasons: list.map((r) => {
      if (typeof r === 'string') return { code: r, message: r };
      return {
        code: CAN_HANDLE_REASON_CODES.includes(r?.code) ? r.code : 'other',
        message: asString(r?.message || r?.code || 'other'),
      };
    }),
    /** Explicit: canHandle never grants ForgeOS authorization */
    authorization: null,
  };
}

export function createRuntimeError(code, message = '', detail = {}) {
  if (!RUNTIME_ERROR_CODES.includes(code)) {
    throw new Error(`Unknown runtime error code: ${code}`);
  }
  return {
    kind: 'runtime_error',
    code,
    message: asString(message || code),
    detail: isPlainObject(detail) ? detail : { value: detail },
    product: PRODUCT_ID,
  };
}

/**
 * Normalized evidence bundle returned from a runtime to ForgeOS.
 * Distinct from ForgeOS governance evidence (policy / release approvals).
 */
export function createEvidenceBundle(input = {}) {
  return {
    contract_version: RUNTIME_BACKEND_CONTRACT_VERSION,
    kind: 'runtime_native_evidence',
    run_id: asString(input.run_id),
    task_id: asString(input.task_id),
    backend_id: asString(input.backend_id),
    execution_status: asString(input.execution_status || 'unknown'),
    changed_files: Array.isArray(input.changed_files) ? input.changed_files.map(String) : [],
    diff_summary: input.diff_summary == null ? null : asString(input.diff_summary),
    commands_executed: Array.isArray(input.commands_executed)
      ? input.commands_executed.map((c) =>
          typeof c === 'string'
            ? { command: c, exit_code: null }
            : {
                command: asString(c.command),
                exit_code: c.exit_code == null ? null : Number(c.exit_code),
              }
        )
      : [],
    test_results: Array.isArray(input.test_results) ? input.test_results : [],
    logs_refs: Array.isArray(input.logs_refs) ? input.logs_refs.map(String) : [],
    /**
     * Runtime-reported verification command outcomes.
     * ForgeOS still decides whether verification *policy* is satisfied.
     */
    verification_results: Array.isArray(input.verification_results)
      ? input.verification_results.map((v) => ({
          command: asString(v.command),
          exit_code: v.exit_code == null ? null : Number(v.exit_code),
          passed: Boolean(v.passed ?? (v.exit_code === 0)),
          output_ref: v.output_ref == null ? null : asString(v.output_ref),
        }))
      : [],
    unavailable: Boolean(input.unavailable),
    notes: input.notes == null ? null : asString(input.notes),
    product: PRODUCT_ID,
  };
}

/**
 * ForgeOS verification acceptance — separate from runtime command exit codes.
 */
export function createVerificationAssessment(input = {}) {
  return {
    kind: 'forgeos_verification_assessment',
    satisfied: Boolean(input.satisfied),
    authority: POLICY_AUTHORITY,
    task_id: asString(input.task_id),
    required_commands: Array.isArray(input.required_commands)
      ? input.required_commands.map(String)
      : [],
    runtime_results: Array.isArray(input.runtime_results) ? input.runtime_results : [],
    reason: input.reason || null,
  };
}

export function createCancelResult(input = {}) {
  return {
    ok: Boolean(input.ok),
    run_id: asString(input.run_id),
    task_id: asString(input.task_id),
    backend_id: asString(input.backend_id),
    status: RUN_HANDLE_STATUSES.includes(input.status) ? input.status : 'cancelled',
    error: input.error || null,
    /** Cancellation never grants authorization */
    authorization: null,
    product: PRODUCT_ID,
  };
}

/**
 * Combine ForgeOS policy decision with a runtime constraint decision.
 * Runtime must never convert ForgeOS DENY into ALLOW.
 */
export function resolveOverallExecutionDecision(policyDecision, runtimeDecision = null) {
  const policy = createPolicyDecisionContext(policyDecision);

  if (policy.decision === 'deny') {
    return {
      overall: 'deny',
      source: 'forgeos_policy',
      policy,
      runtime: runtimeDecision || null,
      note: 'ForgeOS DENY cannot be overridden by runtime',
    };
  }

  const runtimePerm = String(
    runtimeDecision?.permission || runtimeDecision?.decision || 'allow'
  ).toLowerCase();

  if (runtimePerm === 'deny') {
    return {
      overall: 'deny',
      source: 'runtime_constraint',
      policy,
      runtime: runtimeDecision,
      note: 'ForgeOS ALLOW + runtime DENY → overall DENY',
    };
  }

  return {
    overall: 'allow',
    source: 'forgeos_policy_and_runtime',
    policy,
    runtime: runtimeDecision || { permission: 'allow' },
    note: null,
  };
}

/**
 * Gate before start(): policy deny stays a policy result, not a runtime error.
 */
export function assertRunStartAllowed(runRequest) {
  const req =
    runRequest?.policy_decision && runRequest?.task_id
      ? runRequest
      : createRunRequest(runRequest);
  const policy = req.policy_decision;
  if (policy.decision === 'deny') {
    return {
      ok: false,
      kind: 'policy',
      policy_decision: policy,
      runtime_error: null,
    };
  }
  return { ok: true, kind: 'allowed', policy_decision: policy, runtime_error: null };
}

/**
 * Ensure cancel targets the same task that owns the run handle.
 */
export function assertCancelTaskIsolation(runHandle, requestedTaskId) {
  const handle = createRunHandle(runHandle);
  const taskId = asString(requestedTaskId);
  if (!taskId) {
    return {
      ok: false,
      error: createRuntimeError('TASK_MISMATCH', 'cancel requires task_id'),
    };
  }
  if (handle.task_id !== taskId) {
    return {
      ok: false,
      error: createRuntimeError(
        'TASK_MISMATCH',
        `Run ${handle.run_id} belongs to task ${handle.task_id}, not ${taskId}`
      ),
    };
  }
  return { ok: true, handle };
}

/**
 * Capability matching helper (not authorization, not routing/selection).
 */
export function matchBackendCapabilities(capabilities, requirements = {}) {
  let caps;
  try {
    caps = normalizeBackendCapabilities(capabilities);
  } catch (err) {
    return createCanHandleResult(false, [{ code: 'other', message: err.message }]);
  }

  const reasons = [];
  if (requirements.interactive === true && !caps.interactive) {
    reasons.push({ code: 'interactive_unsupported', message: 'interactive execution unsupported' });
  }
  if (requirements.autonomous === true && !caps.autonomous) {
    reasons.push({ code: 'autonomous_unsupported', message: 'autonomous execution unsupported' });
  }
  if (requirements.sandbox === true && !caps.sandbox) {
    reasons.push({ code: 'sandbox_unavailable', message: 'sandbox requirement unavailable' });
  }
  if (requirements.parallel === true && !caps.parallel) {
    reasons.push({ code: 'parallel_unsupported', message: 'parallel execution unsupported' });
  }
  if (requirements.hooks_callback === true && !caps.hooks_callback) {
    reasons.push({
      code: 'hooks_callback_unsupported',
      message: 'hooks callback unsupported',
    });
  }
  if (requirements.language) {
    const lang = String(requirements.language).toLowerCase();
    const supported = caps.languages.map((l) => l.toLowerCase());
    if (supported.length > 0 && !supported.includes(lang)) {
      reasons.push({
        code: 'unsupported_language',
        message: `unsupported language: ${requirements.language}`,
      });
    }
  }

  return createCanHandleResult(reasons.length === 0, reasons);
}

/**
 * Conceptual RuntimeBackend surface for documentation and compliance checks.
 * Not an executable registry entry.
 */
export const RuntimeBackendContract = {
  version: RUNTIME_BACKEND_CONTRACT_VERSION,
  required_methods: ['health', 'canHandle', 'start', 'cancel', 'collectEvidence'],
  capability_keys: BACKEND_CAPABILITY_KEYS,
  health_statuses: HEALTH_STATUSES,
  error_codes: RUNTIME_ERROR_CODES,
  validate: validateRuntimeBackend,
  createRunRequest,
  createRunHandle,
  createEvidenceBundle,
  createHealthResult,
  createCanHandleResult,
  createCancelResult,
  createRuntimeError,
  createVerificationAssessment,
  resolveOverallExecutionDecision,
  assertRunStartAllowed,
  assertCancelTaskIsolation,
  matchBackendCapabilities,
};
