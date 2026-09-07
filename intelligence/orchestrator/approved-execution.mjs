/**
 * Stage 9 governed execution loop
 *
 * Assessment → candidate → explicit approval → Policy → Resolver →
 * coordinateGovernedExecution → verification → evidence → rescan → canvas delta
 *
 * Does NOT call backend.start() directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { saveSession, evaluatePreToolUse, evaluateTaskScope } from '../../policy/authority.mjs';
import { checkScopeContainment } from '../../policy/task-scope.mjs';
import { coordinateGovernedExecution } from './governed.mjs';
import { validateTaskApproval } from './approval.mjs';
import {
  assessCapabilityVerification,
  verificationAllowsSatisfied,
  currentVerificationFingerprint,
} from './capability-verification.mjs';
import { buildCanvasDelta } from './canvas-delta.mjs';
import {
  createGovernanceEvidence,
  EVIDENCE_CLASS_GOVERNANCE,
} from './governance-evidence.mjs';
import { resolveCapability } from '../capability/resolver.mjs';
import { runProjectAssessment } from '../assessment/engine.mjs';
import { collectProjectFacts } from '../assessment/facts.mjs';
import {
  writeVerifiedRecord,
  loadVerifiedRecords,
  computeInputFingerprint,
} from '../assessment/evidence.mjs';
import { createTaskCandidate } from '../assessment/task-candidate.mjs';
import { loadCapabilityBindings, capabilityBindingFingerprint } from '../capability/binding.mjs';

export const STAGE9_FAILURE = Object.freeze({
  APPROVAL_MISSING: 'approval_missing',
  APPROVAL_INVALID: 'approval_invalid',
  POLICY_DENIED: 'policy_denied',
  CAPABILITY_UNRESOLVED: 'capability_unresolved',
  RUNTIME_UNAVAILABLE: 'runtime_unavailable',
  START_FAILED: 'start_failed',
  EXECUTION_FAILED: 'execution_failed',
  VERIFICATION_FAILED: 'verification_failed',
  VERIFICATION_UNKNOWN: 'verification_unknown',
  EVIDENCE_FAILED: 'evidence_failed',
  RESCAN_FAILED: 'rescan_failed',
  CANDIDATE_INVALID: 'candidate_invalid',
  OPERATION_MISSING: 'operation_missing',
});

export function rescanProject(projectDir, input = {}) {
  return runProjectAssessment({
    project_dir: projectDir,
    persist: input.persist === true,
    host_context: input.host_context,
    verified_records: {
      ...loadVerifiedRecords(projectDir, input),
      ...(input.verified_records || {}),
    },
    policy_context: input.policy_context,
    now: input.now,
  });
}

function classifyGovernedFailure(status) {
  switch (status) {
    case 'POLICY_DENIED': return STAGE9_FAILURE.POLICY_DENIED;
    case 'NO_COMPATIBLE_BACKEND':
    case 'NO_BACKENDS_REGISTERED':
    case 'ROUTING_FAILED': return STAGE9_FAILURE.RUNTIME_UNAVAILABLE;
    case 'START_FAILED': return STAGE9_FAILURE.START_FAILED;
    case 'EXECUTION_FAILED': return STAGE9_FAILURE.EXECUTION_FAILED;
    case 'VERIFICATION_FAILED': return STAGE9_FAILURE.VERIFICATION_FAILED;
    case 'EVIDENCE_FAILED': return STAGE9_FAILURE.EVIDENCE_FAILED;
    default: return null;
  }
}

export function executeApprovedCandidate(input = {}) {
  const projectDir = path.resolve(input.project_dir || process.cwd());
  const candidateWrap = input.candidate?.schema
    ? { valid: true, candidate: input.candidate }
    : createTaskCandidate(input.candidate || {});

  if (!candidateWrap.valid) {
    return {
      ok: false,
      phase: 'blocked',
      reason: STAGE9_FAILURE.CANDIDATE_INVALID,
      executed: false,
    };
  }

  const candidate = { ...candidateWrap.candidate };
  const scoped = evaluateTaskScope(candidate, projectDir);
  if (!scoped.ok) return { ok: false, phase: 'blocked', reason: scoped.reason, executed: false,
    capability_satisfied: false, governed: { status: 'POLICY_DENIED', policy_decision: scoped } };
  candidate.task_scope = scoped.scope;
  if (candidate.operation?.commands?.length || candidate.operation?.command) {
    const contained = checkScopeContainment(scoped.scope, { project_dir: projectDir, action_class: 'execute' });
    if (!contained.ok) return { ok: false, phase: 'blocked', reason: contained.reason, executed: false, capability_satisfied: false };
  }
  for (const write of candidate.operation?.writes || (candidate.operation?.path ? [{ path: candidate.operation.path }] : [])) {
    const contained = checkScopeContainment(scoped.scope, { project_dir: projectDir, task_id: candidate.task_id,
      capability_id: candidate.capability_id, operation_id: candidate.operation_id, action_class: 'write', path: write.path });
    if (!contained.ok) {
      const policyDecision = evaluatePreToolUse({ tool_name: 'Write', tool_input: { path: write.path },
        task_scope: scoped.scope, scope_action: { project_dir: projectDir } });
      return { ok: false, phase: 'blocked', reason: contained.reason, executed: false, capability_satisfied: false,
        governed: { status: 'POLICY_DENIED', policy_decision: policyDecision } };
    }
  }
  const approvalCheck = validateTaskApproval(input.approval, candidate, { now: input.now });
  if (!approvalCheck.ok) {
    return {
      ok: false,
      phase: 'blocked',
      reason: approvalCheck.reason === 'approval_missing'
        ? STAGE9_FAILURE.APPROVAL_MISSING
        : STAGE9_FAILURE.APPROVAL_INVALID,
      approval_reason: approvalCheck.reason,
      executed: false,
      policy_note: 'Approval missing/invalid — governed execution not invoked',
    };
  }

  if (!candidate.operation) {
    return {
      ok: false,
      phase: 'blocked',
      reason: STAGE9_FAILURE.OPERATION_MISSING,
      executed: false,
    };
  }

  const facts = input.facts || collectProjectFacts(projectDir);
  const resolution = resolveCapability({
    capability_id: candidate.capability_id,
    capability_binding: input.capability_binding,
    project_intelligence: facts.project_intelligence,
    host_context: input.host_context || { capabilities: ['read', 'analyze', 'write', 'test'] },
    policy_context: input.policy_context || {},
    preference: input.preference,
  });

  if (resolution.policy?.policy_decision === 'deny') {
    return {
      ok: false,
      phase: 'blocked',
      reason: STAGE9_FAILURE.POLICY_DENIED,
      resolution,
      executed: false,
      note: 'Resolver reported DENY context — Policy Authority remains authoritative',
    };
  }

  if (!resolution.resolved && input.require_resolved !== false) {
    return {
      ok: false,
      phase: 'blocked',
      reason: STAGE9_FAILURE.CAPABILITY_UNRESOLVED,
      resolution,
      executed: false,
    };
  }

  const before = input.before_assessment || runProjectAssessment({
    project_dir: projectDir,
    persist: input.persist === true,
    host_context: input.host_context,
    verified_records: loadVerifiedRecords(projectDir, input),
  });

  const previousProjectDir = process.env.CURSOR_PROJECT_DIR;
  process.env.CURSOR_PROJECT_DIR = projectDir;
  saveSession({
    subagent_type: candidate.policy_context.agent_id || 'codebase-organization',
    task_id: candidate.task_id,
  });

  const coordinated = coordinateGovernedExecution({
    operation_id: candidate.operation_id,
    task_scope: candidate.task_scope,
    exact_approval_id: input.exact_approval_id,
    execute: true,
    dry_run: input.dry_run === true,
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    project_dir: projectDir,
    objective: candidate.objective,
    operation: candidate.operation,
    agent_id: candidate.policy_context.agent_id || 'codebase-organization',
    allowed_paths: candidate.policy_context.allowed_paths,
    forbidden_paths: candidate.policy_context.forbidden_paths,
    verification_commands: candidate.verification_commands,
    runtime_registry: input.runtime_registry,
    backend_id: input.backend_id,
    execution_id: input.execution_id,
    execution_attempt: input.execution_attempt,
    evaluate_policy: input.evaluate_policy,
    policy_decision: input.policy_decision,
    default_decision: input.default_decision,
  });

  const governed = coordinated.governed;
  const executed = Boolean(governed) && input.dry_run !== true;
  const classified = classifyGovernedFailure(governed?.status);
  const factsAfter = collectProjectFacts(projectDir);
  const bindings = input.bindings || loadCapabilityBindings(input.binding_options);
  const fingerprints = currentVerificationFingerprint(projectDir, candidate, factsAfter, {
    input_fingerprint: computeInputFingerprint(factsAfter, bindings),
    capability_binding_fingerprint: capabilityBindingFingerprint(bindings),
    bindings,
  });

  const verification = assessCapabilityVerification({
    governed,
    candidate,
    project_dir: projectDir,
    facts: factsAfter,
    fingerprints,
    input_fingerprint: fingerprints.input_fingerprint,
    capability_binding_fingerprint: fingerprints.capability_binding_fingerprint,
    bindings,
    timeout_ms: input.verification_timeout_ms,
  });

  let governanceEvidence = null;
  let evidenceError = null;
  try {
    governanceEvidence = createGovernanceEvidence({
      task_id: candidate.task_id,
      capability_id: candidate.capability_id,
      execution_id: governed?.execution_id || null,
      verification,
      project_fingerprint: fingerprints,
      lifecycle_status: governed?.status || null,
      started_at: governed?.started_at || null,
      completed_at: governed?.completed_at || null,
      rationale: verification.reason,
      affected_scope: candidate.scope,
      runtime_native_evidence: governed?.runtime_evidence || null,
      freshness_ttl: input.freshness_ttl,
      supersedes_evidence_id: input.supersedes_evidence_id || null,
    });
    if (input.persist !== false) {
      writeVerifiedRecord(projectDir, governanceEvidence, input);
    }
  } catch (err) {
    evidenceError = err.message;
  }

  const verifiedRecord = governanceEvidence;

  let after = null;
  let delta = null;
  let rescanError = evidenceError;
  try {
    after = rescanProject(projectDir, {
      persist: input.persist === true,
      host_context: input.host_context,
      verified_records: governanceEvidence
        ? { [candidate.capability_id]: governanceEvidence }
        : {},
    });
    delta = buildCanvasDelta(before.canvas, after.canvas, {
      task_id: candidate.task_id,
      capability_id: candidate.capability_id,
      verification,
      evidence_id: governanceEvidence?.evidence_id,
      timestamp: verification.verified_at,
    });
  } catch (err) {
    rescanError = err.message;
  }

  const canvasState = after?.canvas?.items?.find((i) => i.capability_id === candidate.capability_id)?.state;
  const satisfied = verificationAllowsSatisfied(verification) && canvasState === 'SATISFIED';
  const ok = satisfied && !rescanError && governed?.status === 'COMPLETED';

  if (previousProjectDir === undefined) delete process.env.CURSOR_PROJECT_DIR;
  else process.env.CURSOR_PROJECT_DIR = previousProjectDir;

  return {
    ok,
    phase: ok ? 'governed_loop_complete' : 'governed_loop_incomplete',
    reason: evidenceError
      ? STAGE9_FAILURE.EVIDENCE_FAILED
      : rescanError
        ? STAGE9_FAILURE.RESCAN_FAILED
        : (classified
          || (verification.result === 'FAIL' ? STAGE9_FAILURE.VERIFICATION_FAILED : null)
          || (verification.result === 'UNKNOWN' ? STAGE9_FAILURE.VERIFICATION_UNKNOWN : null)
          || (ok ? null : 'incomplete')),
    executed,
    candidate,
    approval: approvalCheck.approval,
    resolution,
    coordinated,
    governed,
    verification,
    governance_evidence: governanceEvidence
      ? { ...governanceEvidence, kind: EVIDENCE_CLASS_GOVERNANCE }
      : null,
    project_fingerprint: fingerprints,
    verified_record: verifiedRecord,
    canvas_before: before.canvas,
    canvas_after: after?.canvas || null,
    canvas_delta: delta,
    rescan_error: rescanError,
    pi_path: path.join(projectDir, '.agent-os', 'project.yaml').replace(/\\/g, '/'),
    pi_unchanged_check: fs.existsSync(path.join(projectDir, '.agent-os', 'project.yaml')),
    success: ok,
    capability_satisfied: satisfied,
    note: 'Runtime success is not verification success is not capability SATISFIED',
  };
}

export function formatLoopOutcome(loop) {
  const executionStatus = loop.governed?.status || loop.reason || 'UNKNOWN';
  const verification = loop.verification?.result || 'UNKNOWN';
  const evidence = loop.governance_evidence?.evidence_id ? 'RECORDED' : 'NONE';
  const capability = loop.capability_satisfied ? 'SATISFIED' : 'NOT SATISFIED';
  return [
    'EXECUTION:',
    executionStatus,
    '',
    'VERIFICATION:',
    verification,
    '',
    'EVIDENCE:',
    evidence,
    '',
    'CAPABILITY:',
    capability,
  ].join('\n');
}
