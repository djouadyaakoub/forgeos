/**
 * ForgeOS Execution Lifecycle — Architecture 2.0 Stages 5–6
 *
 * Policy → Router → createRunRequest → backend.start → verify → evidence → result
 *
 * Stage 6 adds: dry-run, deterministic execution identity, duplicate-start guard.
 *
 * Does NOT own LLM loops, sandboxes, or model providers.
 * Does NOT authorize (Policy Authority) or select backends without Router.
 * Does NOT auto-fallback between backends.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { POLICY_AUTHORITY, PRODUCT_ID } from '../policy/identity.mjs';
import { evaluatePreToolUse, evaluateShell, stampDecision, saveSession, clearSession } from '../policy/authority.mjs';
import { classifyShellOperation } from '../policy/engine.mjs';
import { exactSnapshot } from '../policy/exact-approval.mjs';
import { loadProjectManifest } from '../policy/project-adapter.mjs';
import {
  createRunRequest,
  createVerificationAssessment,
  createPolicyDecisionContext,
  assertCancelTaskIsolation,
} from './backend-interface.mjs';
import { route } from './router.mjs';
import { defaultRuntimeRegistry } from './registry.mjs';

export const LIFECYCLE_STATUSES = [
  'PLANNED',
  'POLICY_CHECKED',
  'ROUTED',
  'STARTING',
  'RUNNING',
  'VERIFYING',
  'EVIDENCE_COLLECTED',
  'COMPLETED',
  'POLICY_DENIED',
  'ROUTING_FAILED',
  'START_FAILED',
  'EXECUTION_FAILED',
  'VERIFICATION_FAILED',
  'EVIDENCE_FAILED',
  'CANCELLED',
  'INVALID_REQUEST',
  'DRY_RUN',
  'ALREADY_ACTIVE',
  'ALREADY_COMPLETED',
];

const LIFECYCLE_STORE = new Map();
/** Deterministic execution identity → { state, record_key, started_at } */
const EXECUTION_GUARD = new Map();

function now() {
  return new Date().toISOString();
}

function asString(v, fallback = '') {
  return v == null ? fallback : String(v);
}

/**
 * Deterministic execution identity for duplicate-start protection.
 * Prefer explicit execution_id; otherwise hash task_id + attempt + objective fingerprint.
 */
export function buildExecutionIdentity(input = {}) {
  if (input.execution_id) return asString(input.execution_id);
  const taskId = asString(input.task_id);
  const attempt = asString(input.execution_attempt || '1');
  const op = input.operation || {};
  const fingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        task_id: taskId,
        attempt,
        objective: asString(input.objective),
        operation: op.type || null,
        path: op.path || null,
        writes: (op.writes || []).map((w) => w.path).sort(),
        commands: op.commands || [],
        backend_id: input.backend_id || null,
      })
    )
    .digest('hex')
    .slice(0, 24);
  return `${taskId}:${attempt}:${fingerprint}`;
}

export function getExecutionGuard(executionId) {
  return EXECUTION_GUARD.get(executionId) || null;
}

export function clearExecutionGuards() {
  EXECUTION_GUARD.clear();
}

/**
 * Evaluate ForgeOS policy for a governed write/shell operation.
 * Returns a stamped policy decision — never invents a second engine.
 */
export function evaluateExecutionPolicy(input = {}) {
  const op = input.operation || {};
  let raw;
  if (op.type === 'write_file' || op.type === 'write_files') {
    const pathToCheck = op.path || op.writes?.[0]?.path;
    raw = stampDecision(
      evaluatePreToolUse({
        tool_name: 'Write',
        tool_input: { path: pathToCheck },
      })
    );
  } else if (op.type === 'run_commands' && op.commands?.[0]) {
    raw = stampDecision(
      evaluatePreToolUse({
        tool_name: 'Shell',
        tool_input: { command: op.commands[0] },
      })
    );
  } else if (input.policy_decision) {
    return createPolicyDecisionContext(input.policy_decision);
  } else {
    raw = {
      permission: input.default_decision || 'deny',
      reason: 'no_evaluable_operation',
      authority: POLICY_AUTHORITY,
    };
  }
  return createPolicyDecisionContext({
    authority: raw.authority || POLICY_AUTHORITY,
    decision: raw.decision || raw.permission,
    reason: raw.reason,
    operation: raw.operation,
    task_id: raw.task_id,
    agent_id: raw.agent_id,
    rule: raw.rule,
  });
}

function buildGovernanceEvidence(parts = {}) {
  return {
    kind: 'forgeos_governance_evidence',
    authority: POLICY_AUTHORITY,
    product: PRODUCT_ID,
    task_id: parts.task_id || null,
    run_id: parts.run_id || null,
    backend_id: parts.backend_id || null,
    capability_id: parts.capability_id || null,
    policy_decision: parts.policy_decision || null,
    route_decision: parts.route_decision
      ? {
          status: parts.route_decision.status,
          backend_id: parts.route_decision.backend_id,
          reasons: parts.route_decision.reasons,
          evidence: parts.route_decision.evidence,
        }
      : null,
    lifecycle_status: parts.lifecycle_status || null,
    verification_assessment: parts.verification_assessment || null,
    final_status: parts.final_status || null,
    timestamp: now(),
  };
}

function finalizeRecord(record) {
  LIFECYCLE_STORE.set(record.run_id || `${record.task_id}:${record.started_at}`, record);
  return record;
}

/**
 * Execute a governed task through Policy → Router → Backend.
 *
 * @param {object} input
 * @param {string} input.task_id
 * @param {string} [input.capability_id] — Stage 8 capability linkage for evidence/canvas
 * @param {string} input.project_dir
 * @param {string} [input.objective]
 * @param {object} [input.operation] — { type, path, content, writes, commands }
 * @param {string[]} [input.verification_commands]
 * @param {string[]} [input.allowed_paths]
 * @param {string[]} [input.forbidden_paths]
 * @param {object} [input.policy_decision] — optional precomputed; otherwise evaluated
 * @param {boolean} [input.evaluate_policy=true]
 * @param {boolean} [input.dry_run=false] — policy+route preview; never calls backend.start
 * @param {string} [input.execution_id] — deterministic duplicate-guard key
 * @param {string|number} [input.execution_attempt]
 * @param {object} [input.registry]
 * @param {string} [input.backend_id]
 */
export function executeGoverned(input = {}) {
  // Copy exact-intent fields before any callbacks/backend selection can mutate caller objects.
  const highRisk = (input.operation?.commands || []).some(c => classifyShellOperation(c)?.tier >= 3);
  if (highRisk) {
    try {
      input = {...input, operation:exactSnapshot(input.operation), task_scope:exactSnapshot(input.task_scope),
        verification_commands:exactSnapshot(input.verification_commands || [])};
    } catch(e) { return {status:'POLICY_DENIED',error:{code:e.message},lifecycle_status:'POLICY_DENIED'}; }
  }
  const startedAt = now();
  const taskId = asString(input.task_id);
  const projectDir = path.resolve(input.project_dir || process.cwd());
  const registry = input.registry || defaultRuntimeRegistry;
  const dryRun = input.dry_run === true;
  const executionId = buildExecutionIdentity(input);

  const base = {
    product: PRODUCT_ID,
    task_id: taskId,
    capability_id: input.capability_id || null,
    project_dir: projectDir.replace(/\\/g, '/'),
    started_at: startedAt,
    completed_at: null,
    run_id: null,
    backend_id: null,
    execution_id: executionId,
    dry_run: dryRun,
    lifecycle_status: 'PLANNED',
    status: 'PLANNED',
    policy_decision: null,
    route_decision: null,
    run_handle: null,
    runtime_evidence: null,
    governance_evidence: null,
    verification_assessment: null,
    error: null,
    authorization: null,
    verification_plan: null,
    expected_evidence: null,
  };

  if (!taskId) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'INVALID_REQUEST',
      status: 'INVALID_REQUEST',
      completed_at: now(),
      error: { code: 'missing_task_id', message: 'task_id is required' },
      governance_evidence: buildGovernanceEvidence({
        lifecycle_status: 'INVALID_REQUEST',
        final_status: 'INVALID_REQUEST',
      }),
    });
  }

  // --- Duplicate execution guard (before policy mutation side-effects) ---
  if (!dryRun) {
    const existing = EXECUTION_GUARD.get(executionId);
    if (existing?.state === 'active') {
      return finalizeRecord({
        ...base,
        lifecycle_status: 'ALREADY_ACTIVE',
        status: 'ALREADY_ACTIVE',
        completed_at: now(),
        run_id: existing.run_id || null,
        backend_id: existing.backend_id || null,
        error: {
          code: 'ALREADY_ACTIVE',
          message: `execution_id ${executionId} already active; backend.start not invoked`,
        },
        governance_evidence: buildGovernanceEvidence({
          task_id: taskId,
          lifecycle_status: 'ALREADY_ACTIVE',
          final_status: 'ALREADY_ACTIVE',
          run_id: existing.run_id || null,
          backend_id: existing.backend_id || null,
        }),
      });
    }
    if (existing?.state === 'completed') {
      return finalizeRecord({
        ...base,
        lifecycle_status: 'ALREADY_COMPLETED',
        status: 'ALREADY_COMPLETED',
        completed_at: now(),
        run_id: existing.run_id || null,
        backend_id: existing.backend_id || null,
        error: {
          code: 'ALREADY_COMPLETED',
          message: `execution_id ${executionId} already completed; replay refused`,
        },
        governance_evidence: buildGovernanceEvidence({
          task_id: taskId,
          lifecycle_status: 'ALREADY_COMPLETED',
          final_status: 'ALREADY_COMPLETED',
          run_id: existing.run_id || null,
          backend_id: existing.backend_id || null,
        }),
      });
    }
  }

  if (!fs.existsSync(projectDir)) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'INVALID_REQUEST',
      status: 'INVALID_REQUEST',
      completed_at: now(),
      error: { code: 'missing_project_dir', message: `project_dir not found: ${projectDir}` },
    });
  }

  // --- Policy gate (must precede route + start) ---
  let policyDecision;
  try {
    if (highRisk) {
      if (input.policy_decision?.decision === 'deny' || input.policy_decision?.permission === 'deny')
        throw new Error('policy_deny');
      if (input.operation.commands.length !== 1) throw new Error('tier3_batch_unsupported');
      process.env.CURSOR_PROJECT_DIR = projectDir;
      policyDecision = createPolicyDecisionContext(evaluateShell(input.operation.commands[0],
        {task_id:taskId,subagent_type:input.agent_id || 'codebase-organization'}, {
          approval_id:input.exact_approval_id, task_id:taskId, capability_id:input.capability_id,
          operation_id:input.operation_id, task_scope:input.task_scope, project_dir:projectDir,
        }));
    } else
    if (input.evaluate_policy === false) {
      if (!input.policy_decision) {
        throw new Error('policy_decision required when evaluate_policy is false');
      }
      policyDecision = createPolicyDecisionContext({
        ...input.policy_decision,
        task_id: input.policy_decision.task_id || taskId,
      });
    } else {
      process.env.CURSOR_PROJECT_DIR = projectDir;
      if (input.agent_id || input.task_id) {
        clearSession();
        saveSession({
          subagent_type: input.agent_id || 'codebase-organization',
          task_id: taskId,
        });
      }
      policyDecision = evaluateExecutionPolicy({
        operation: input.operation,
        policy_decision: input.policy_decision,
        default_decision: input.default_decision,
      });
    }
  } catch (err) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'INVALID_REQUEST',
      status: 'INVALID_REQUEST',
      completed_at: now(),
      error: { code: 'invalid_policy', message: err.message },
    });
  }

  base.policy_decision = policyDecision;
  base.lifecycle_status = 'POLICY_CHECKED';

  if (policyDecision.decision === 'deny' || policyDecision.permission === 'deny') {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'POLICY_DENIED',
      status: 'POLICY_DENIED',
      completed_at: now(),
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        lifecycle_status: 'POLICY_DENIED',
        final_status: 'POLICY_DENIED',
      }),
      error: {
        code: 'POLICY_DENIED',
        message: policyDecision.reason || 'ForgeOS Policy Authority denied execution',
      },
    });
  }

  // --- Project intelligence (reference, not mutation) ---
  const { data: projectIntelligence } = loadProjectManifest(projectDir);

  const allowedPaths = input.allowed_paths ||
    input.operation?.allowed_paths ||
    ['workspace/**', 'out/**', 'tmp/**', 'src/**'];
  const forbiddenPaths = input.forbidden_paths || [
    '.cursor/**',
    '.agent-os/**',
    'policy/**',
    'docs/agents/**',
  ];

  const verificationCommands =
    input.verification_commands ||
    projectIntelligence?.verification?.commands?.map((c) => c.command || c).filter(Boolean) ||
    [];

  if (verificationCommands.some(c => classifyShellOperation(c)?.tier >= 3)) {
    return finalizeRecord({...base,status:'POLICY_DENIED',lifecycle_status:'POLICY_DENIED',
      error:{code:'tier3_verification_command_forbidden'},completed_at:now()});
  }

  // --- Router ---
  const routeDecision = route({
    task: {
      task_id: taskId,
      objective: input.objective || '',
      requirements: input.requirements || { autonomous: true },
    },
    projectIntelligence,
    policyContext: {
      ...policyDecision,
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
      approval_scopes: input.approval_scopes || [],
    },
    backend_id: input.backend_id,
    registry,
  });

  base.route_decision = routeDecision;

  if (routeDecision.status === 'DENIED') {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'POLICY_DENIED',
      status: 'POLICY_DENIED',
      completed_at: now(),
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'POLICY_DENIED',
        final_status: 'POLICY_DENIED',
      }),
    });
  }

  if (routeDecision.status !== 'ROUTED' || !routeDecision.backend_id) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'ROUTING_FAILED',
      status: 'ROUTING_FAILED',
      completed_at: now(),
      error: {
        code: routeDecision.status,
        message: routeDecision.reasons?.[0]?.message || 'routing failed',
      },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'ROUTING_FAILED',
        final_status: 'ROUTING_FAILED',
      }),
    });
  }

  base.lifecycle_status = 'ROUTED';
  base.backend_id = routeDecision.backend_id;

  const backend = registry.get(routeDecision.backend_id);
  if (highRisk && backend?._adapter !== 'local-executor') {
    return finalizeRecord({...base,status:'POLICY_DENIED',lifecycle_status:'POLICY_DENIED',
      error:{code:'tier3_backend_dispatch_unsupported'},completed_at:now()});
  }
  if (!backend) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'ROUTING_FAILED',
      status: 'ROUTING_FAILED',
      completed_at: now(),
      error: { code: 'backend_missing', message: 'routed backend not in registry' },
    });
  }

  // --- runRequest ---
  const runRequest = createRunRequest({
    task_id: taskId,
    objective: input.objective || '',
    project_intelligence: projectIntelligence,
    policy_decision: policyDecision,
    allowed_paths: allowedPaths,
    forbidden_paths: forbiddenPaths,
    approval_scopes: input.approval_scopes || [],
    verification_commands: verificationCommands,
    evidence_requirements: input.evidence_requirements || ['changed_files', 'verification_results'],
    isolation_requirements: input.isolation_requirements || {},
    execution_constraints: {
      project_dir: projectDir,
      operation: input.operation?.type || 'noop',
      path: input.operation?.path,
      content: input.operation?.content,
      writes: input.operation?.writes,
      commands: input.operation?.commands,
      timeout_ms: input.timeout_ms || 30000,
      exact_approval: highRisk ? {
        approval_id:input.exact_approval_id, capability_id:input.capability_id, operation_id:input.operation_id,
        task_scope:input.task_scope, agent_id:input.agent_id || 'codebase-organization',
      } : null,
    },
  });

  base.verification_plan = {
    commands: verificationCommands,
    authority: POLICY_AUTHORITY,
  };
  base.expected_evidence = {
    runtime_native: ['run_id', 'changed_files', 'verification_results'],
    governance: ['policy_decision', 'route_decision', 'verification_assessment'],
  };

  // --- Dry run: never call backend.start / never mutate ---
  if (dryRun) {
    return finalizeRecord({
      ...base,
      lifecycle_status: 'DRY_RUN',
      status: 'DRY_RUN',
      completed_at: now(),
      run_request_preview: {
        task_id: runRequest.task_id,
        objective: runRequest.objective,
        policy_decision: runRequest.policy_decision,
        policy_requirements: runRequest.policy_requirements,
        verification_commands: runRequest.verification_commands,
        evidence_requirements: runRequest.evidence_requirements,
        execution_constraints: {
          project_dir: runRequest.execution_constraints?.project_dir,
          operation: runRequest.execution_constraints?.operation,
          path: runRequest.execution_constraints?.path,
          writes: (runRequest.execution_constraints?.writes || []).map((w) => w.path),
          commands: runRequest.execution_constraints?.commands || [],
        },
      },
      selected_backend: {
        id: backend.id,
        name: backend.name,
        version: backend.version,
        capabilities: backend.capabilities,
      },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'DRY_RUN',
        final_status: 'DRY_RUN',
        backend_id: routeDecision.backend_id,
      }),
    });
  }

  // Claim guard before start
  EXECUTION_GUARD.set(executionId, {
    state: 'active',
    task_id: taskId,
    backend_id: routeDecision.backend_id,
    run_id: null,
    started_at: startedAt,
  });

  // --- Start (only here; never in Router / Planner / Host) ---
  base.lifecycle_status = 'STARTING';
  let startResult;
  try {
    startResult = backend.start(runRequest);
    base.approval_receipts = startResult?.approval_receipts || [];
  } catch (err) {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: routeDecision.backend_id,
      run_id: null,
      started_at: startedAt,
      final_status: 'START_FAILED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'START_FAILED',
      status: 'START_FAILED',
      completed_at: now(),
      error: { code: 'START_FAILED', message: err.message },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'START_FAILED',
        final_status: 'START_FAILED',
      }),
    });
  }

  if (startResult?.kind === 'policy') {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: routeDecision.backend_id,
      run_id: null,
      started_at: startedAt,
      final_status: 'POLICY_DENIED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'POLICY_DENIED',
      status: 'POLICY_DENIED',
      completed_at: now(),
      policy_decision: startResult.policy_decision || policyDecision,
    });
  }

  if (startResult?.kind === 'error' || !startResult?.handle) {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: routeDecision.backend_id,
      run_id: startResult?.handle?.run_id || null,
      started_at: startedAt,
      final_status: 'START_FAILED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'START_FAILED',
      status: 'START_FAILED',
      completed_at: now(),
      run_handle: startResult?.handle || null,
      run_id: startResult?.handle?.run_id || null,
      runtime_evidence: startResult?.evidence || null,
      error: startResult?.error || { code: 'START_FAILED', message: 'backend start failed' },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'START_FAILED',
        final_status: 'START_FAILED',
        run_id: startResult?.handle?.run_id,
        backend_id: routeDecision.backend_id,
      }),
    });
  }

  const handle = startResult.handle;
  base.run_handle = handle;
  base.run_id = handle.run_id;
  base.lifecycle_status = handle.status === 'failed' ? 'EXECUTION_FAILED' : 'RUNNING';
  EXECUTION_GUARD.set(executionId, {
    state: 'active',
    task_id: taskId,
    backend_id: handle.backend_id,
    run_id: handle.run_id,
    started_at: startedAt,
  });

  if (handle.status === 'failed') {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: handle.backend_id,
      run_id: handle.run_id,
      started_at: startedAt,
      final_status: 'EXECUTION_FAILED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'EXECUTION_FAILED',
      status: 'EXECUTION_FAILED',
      completed_at: now(),
      runtime_evidence: startResult.evidence || null,
      error: startResult.error || { code: 'EXECUTION_FAILED', message: 'backend execution failed' },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        run_id: handle.run_id,
        backend_id: handle.backend_id,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'EXECUTION_FAILED',
        final_status: 'EXECUTION_FAILED',
      }),
    });
  }

  // --- Evidence ---
  base.lifecycle_status = 'EVIDENCE_COLLECTED';
  let runtimeEvidence;
  try {
    runtimeEvidence = startResult.evidence || backend.collectEvidence(handle);
  } catch (err) {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: handle.backend_id,
      run_id: handle.run_id,
      started_at: startedAt,
      final_status: 'EVIDENCE_FAILED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'EVIDENCE_FAILED',
      status: 'EVIDENCE_FAILED',
      completed_at: now(),
      error: { code: 'EVIDENCE_FAILED', message: err.message },
    });
  }

  if (runtimeEvidence?.unavailable) {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: handle.backend_id,
      run_id: handle.run_id,
      started_at: startedAt,
      final_status: 'EVIDENCE_FAILED',
    });
    return finalizeRecord({
      ...base,
      lifecycle_status: 'EVIDENCE_FAILED',
      status: 'EVIDENCE_FAILED',
      completed_at: now(),
      runtime_evidence: runtimeEvidence,
      error: { code: 'EVIDENCE_UNAVAILABLE', message: runtimeEvidence.notes || 'evidence unavailable' },
    });
  }

  base.runtime_evidence = runtimeEvidence;

  // --- Verification assessment (ForgeOS governance) ---
  base.lifecycle_status = 'VERIFYING';
  const required = verificationCommands;
  const runtimeResults = runtimeEvidence.verification_results || [];
  let satisfied = true;
  let reason = null;
  if (required.length === 0) {
    satisfied = true;
    reason = 'no_verification_commands_required';
  } else {
    for (const cmd of required) {
      const match = runtimeResults.find((r) => r.command === cmd);
      if (!match || !match.passed) {
        satisfied = false;
        reason = match
          ? `verification command failed: ${cmd}`
          : `verification command missing from runtime results: ${cmd}`;
        break;
      }
    }
  }

  const verificationAssessment = createVerificationAssessment({
    satisfied,
    task_id: taskId,
    required_commands: required,
    runtime_results: runtimeResults,
    reason,
  });
  base.verification_assessment = verificationAssessment;

  if (!satisfied) {
    EXECUTION_GUARD.set(executionId, {
      state: 'completed',
      task_id: taskId,
      backend_id: handle.backend_id,
      run_id: handle.run_id,
      started_at: startedAt,
      final_status: 'VERIFICATION_FAILED',
    });
    const record = finalizeRecord({
      ...base,
      lifecycle_status: 'VERIFICATION_FAILED',
      status: 'VERIFICATION_FAILED',
      completed_at: now(),
      error: { code: 'VERIFICATION_FAILED', message: reason },
      governance_evidence: buildGovernanceEvidence({
        task_id: taskId,
        run_id: handle.run_id,
        backend_id: handle.backend_id,
        policy_decision: policyDecision,
        route_decision: routeDecision,
        lifecycle_status: 'VERIFICATION_FAILED',
        verification_assessment: verificationAssessment,
        final_status: 'VERIFICATION_FAILED',
      }),
    });
    return record;
  }

  EXECUTION_GUARD.set(executionId, {
    state: 'completed',
    task_id: taskId,
    backend_id: handle.backend_id,
    run_id: handle.run_id,
    started_at: startedAt,
    final_status: 'COMPLETED',
  });

  const completed = finalizeRecord({
    ...base,
    lifecycle_status: 'COMPLETED',
    status: 'COMPLETED',
    completed_at: now(),
    governance_evidence: buildGovernanceEvidence({
      task_id: taskId,
      run_id: handle.run_id,
      backend_id: handle.backend_id,
      policy_decision: policyDecision,
      route_decision: routeDecision,
      lifecycle_status: 'COMPLETED',
      verification_assessment: verificationAssessment,
      final_status: 'COMPLETED',
    }),
  });
  return completed;
}

/**
 * Cancel a run — task isolation enforced.
 */
export function cancelGoverned(input = {}) {
  const registry = input.registry || defaultRuntimeRegistry;
  const taskId = asString(input.task_id);
  const handle = input.run_handle || input.handle;
  if (!taskId || !handle?.run_id) {
    return {
      ok: false,
      status: 'INVALID_REQUEST',
      error: { code: 'missing_args', message: 'task_id and run_handle required' },
    };
  }
  const isolation = assertCancelTaskIsolation(handle, taskId);
  if (!isolation.ok) {
    return {
      ok: false,
      status: 'TASK_MISMATCH',
      error: isolation.error,
      authorization: null,
    };
  }
  const backend = registry.get(handle.backend_id);
  if (!backend) {
    return {
      ok: false,
      status: 'CANCELLED',
      error: { code: 'backend_missing', message: 'backend not registered' },
    };
  }
  const result = backend.cancel(handle, taskId);
  return {
    ok: result.ok,
    status: result.ok ? 'CANCELLED' : 'CANCEL_FAILED',
    cancel_result: result,
    authorization: null,
  };
}

export function getLifecycleRecord(key) {
  return LIFECYCLE_STORE.get(key) || null;
}

export function clearLifecycleStore() {
  LIFECYCLE_STORE.clear();
  EXECUTION_GUARD.clear();
}

export const ExecutionLifecycle = {
  execute: executeGoverned,
  cancel: cancelGoverned,
  evaluateExecutionPolicy,
  buildExecutionIdentity,
  statuses: LIFECYCLE_STATUSES,
};
