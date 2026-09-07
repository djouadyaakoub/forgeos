/**
 * Host-native interactive handoff — Stage 12
 *
 * Handoff generated ≠ execution started ≠ verification PASS.
 * Host instructions must not weaken Policy Authority constraints.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { POLICY_AUTHORITY } from '../../policy/identity.mjs';
import { getCanonicalVersion } from '../../policy/version.mjs';
import { redactObject, redactString } from '../deployment/redact.mjs';
import { collectProjectFacts, fingerprintText } from '../assessment/facts.mjs';
import { resolveCapability } from '../capability/resolver.mjs';
import { discoverHostCapabilities, getHostExecutionAdapter, selectHost } from '../../host/discovery.mjs';
import { isProductHost } from '../../host/adapter.mjs';
import { projectPath, readProjectText } from '../../host/project-files.mjs';
import { readHostConfiguration } from '../../host/configuration.mjs';
import { bindTaskScope, validateTaskScope } from '../../policy/task-scope.mjs';
import {
  assessCapabilityVerification,
  verificationAllowsSatisfied,
} from './capability-verification.mjs';
import {
  createGovernanceEvidence,
} from './governance-evidence.mjs';
import { writeVerifiedRecord, loadVerifiedRecords, computeInputFingerprint } from '../assessment/evidence.mjs';
import { runProjectAssessment } from '../assessment/engine.mjs';
import { buildCanvasDelta } from './canvas-delta.mjs';
import { computeEvidenceFingerprint } from './fingerprints.mjs';
import { loadCapabilityBindings, capabilityBindingFingerprint } from '../capability/binding.mjs';

export const HANDOFF_SCHEMA = 'forgeos-host-task-handoff';
export const DEFAULT_TASKS_DIR = 'docs/project/tasks';

export const HANDOFF_EXECUTION_STATUS = Object.freeze({
  HANDOFF_READY: 'HANDOFF_READY',
  HOST_INTERACTIVE_REQUIRED: 'HOST_INTERACTIVE_REQUIRED',
  VERIFICATION_REQUESTED: 'VERIFICATION_REQUESTED',
  NOT_STARTED: 'NOT_STARTED',
});

function safeTaskFileName(taskId) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(taskId)
    || /[.]$/.test(taskId)) throw new Error('invalid_task_id');
  return taskId;
}

export function handoffPath(projectDir, taskId) {
  return projectPath(projectDir, `${DEFAULT_TASKS_DIR}/${safeTaskFileName(taskId)}.handoff.json`);
}

export function hostContextFingerprint(projectDir) {
  const config = readHostConfiguration(projectDir);
  if (!config.ok) throw new Error(config.reason);
  return fingerprintText(JSON.stringify({ manifest: config.text || '',
    bindings: capabilityBindingFingerprint(loadCapabilityBindings()) }));
}

export function computeHandoffIntegrity(record) {
  const copy = { ...record };
  delete copy.integrity;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Generate deterministic host instructions from authoritative ForgeOS state.
 */
export function generateHostInstructions(input = {}) {
  const candidate = input.candidate || {};
  const resolution = input.resolution || {};
  const policy = input.policy_context || {};
  const facts = input.facts || {};
  const allowed = candidate.policy_context?.allowed_paths || ['docs/**'];
  const forbidden = candidate.policy_context?.forbidden_paths
    || ['.cursor/**', '.agent-os/**', 'policy/**'];

  const lines = [
    `ForgeOS task ${candidate.task_id || '(unknown)'}`,
    `Capability: ${candidate.capability_id || '(unknown)'}`,
    '',
    'WHAT TO DO:',
    candidate.objective || '(no objective)',
    '',
    'WHY:',
    candidate.rationale || '(no rationale)',
    '',
    'SCOPE:',
    ...(Array.isArray(candidate.scope) && candidate.scope.length
      ? candidate.scope.map((s) => `- ${s}`)
      : ['- (see allowed paths)']),
    '',
    'ALLOWED PATHS:',
    ...allowed.map((p) => `- ${p}`),
    '',
    'DO NOT CHANGE / FORBIDDEN:',
    ...forbidden.map((p) => `- ${p}`),
    '- Do not bypass ForgeOS Policy Authority',
    '- Do not expand task scope beyond this handoff',
    '- Do not claim verification PASS; ForgeOS verifies project state',
    '',
    'EXPECTED EVIDENCE:',
    `- ${candidate.expected_evidence || 'capability-assessment'}`,
    '',
    'VERIFICATION STRATEGY:',
    `- ${candidate.verification_strategy || 'none'}`,
  ];

  if (candidate.verification_strategy === 'finding_resolution') {
    lines.push('- Fresh scoped finding-resolution checks (not mere presence):');
    for (const target of candidate.verification_contract?.targets || []) lines.push(`  - ${target.id}: ${target.path} (${target.type})`);
  }
  if (candidate.verification_strategy === 'presence' && candidate.verification_presence?.length) {
    lines.push('- Presence checks:');
    for (const f of candidate.verification_presence) lines.push(`  - ${f}`);
  }
  if (candidate.verification_commands?.length) {
    lines.push('- Project verification commands (must already be authorized in Project Intelligence):');
    for (const c of candidate.verification_commands) lines.push(`  - ${c}`);
  }

  lines.push(
    '',
    'HOST:',
    `- ${resolution.implementation_id || input.host_id || 'cursor'}`,
    `- invocation: ${resolution.invocation || 'interactive'}`,
    '',
    'PROJECT:',
    `- id: ${facts.project_id || 'unknown'}`,
    `- intelligence fingerprint: ${facts.project_intelligence_fingerprint || 'unknown'}`,
    '',
    'POLICY:',
    `- authority: ${POLICY_AUTHORITY}`,
    `- permission context: ${policy.permission || policy.policy_decision || 'not_evaluated_in_handoff'}`,
  );
  lines.push('', 'SCOPE ENFORCEMENT:',
    '- ForgeOS-declared scope; interactive host interception is not universal.',
    '- Completion requests remain subject to ForgeOS scope validation and verification.');

  return redactString(lines.join('\n'));
}

/**
 * Create a structured host handoff for a task candidate.
 * Does not start execution. Policy DENY blocks approved executable handoff.
 */
export function createHostHandoff(input = {}) {
  try { return createHostHandoffChecked(input); }
  catch (e) { return { ok: false, reason: e.message, handoff: null }; }
}

function createHostHandoffChecked(input = {}) {
  const candidate = input.candidate;
  if (!candidate?.task_id || !candidate?.capability_id) {
    return { ok: false, reason: 'candidate_missing', handoff: null };
  }

  const rawPolicyDecision = input.policy_decision
    || input.policy_context?.policy_decision
    || input.policy_context?.permission
    || null;
  const policyDecision = typeof rawPolicyDecision === 'object'
    ? rawPolicyDecision?.permission || rawPolicyDecision?.decision || null : rawPolicyDecision;

  const policyInputs = [input.policy_decision, input.policy_context?.policy_decision, input.policy_context?.permission];
  if (policyInputs.some(p => p === 'deny' || p?.permission === 'deny' || p?.decision === 'deny')) {
    return {
      ok: false,
      reason: 'policy_deny',
      handoff: null,
      note: 'No host handoff may be presented as an approved executable task under DENY',
    };
  }

  const selection = selectHost({ host_id: input.host_id, active_host_id: input.active_host_id, project_dir: input.project_dir || process.cwd() });
  if (!selection.ok || !selection.supported) return { ok: false, reason: selection.reason || 'unsupported_host', handoff: null };
  let projectDir;
  try { projectDir = fs.realpathSync(input.project_dir || process.cwd()); }
  catch { return { ok: false, reason: 'workspace_missing', handoff: null }; }
  const facts = input.facts || collectProjectFacts(projectDir);
  const scoped = bindTaskScope(candidate, projectDir);
  if (!scoped.ok) return { ok: false, reason: scoped.reason, handoff: null };
  const hostId = selection.host_id;
  handoffPath(projectDir, candidate.task_id);
  const hostDescriptor = discoverHostCapabilities({ host_id: hostId });
  const hostAdapter = getHostExecutionAdapter(hostId);

  if (input.resolution?.policy?.policy_decision === 'deny') return { ok: false, reason: 'policy_deny', handoff: null };
  if (input.resolution?.implementation_type === 'host_native' && input.resolution.implementation_id !== hostId) {
    return { ok: false, reason: 'host_resolution_mismatch', handoff: null };
  }
  // A host handoff explicitly selects the host path, even when assessment preferred a native operation.
  const resolution = resolveCapability({
    preference: 'host_native',
    capability_id: candidate.capability_id,
    capability_binding: input.capability_binding,
    operation_id: candidate.operation_id || undefined,
    project_intelligence: facts.project_intelligence,
    host_context: input.host_context || {
      host_id: hostId,
      capabilities: hostDescriptor.capabilities,
    },
    policy_context: input.policy_context || {},
    host_descriptor: hostDescriptor,
  });

  if (resolution.implementation_type !== 'host_native' || resolution.implementation_id !== hostId) {
    return { ok: false, reason: 'host_resolution_mismatch', handoff: null };
  }

  if (resolution.policy?.policy_decision === 'deny') {
    return {
      ok: false,
      reason: 'policy_deny',
      handoff: null,
      note: 'Resolver reported DENY context — handoff blocked',
    };
  }

  const prepared = hostAdapter.prepare({
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
  });
  if (!prepared.ok) return { ok: false, reason: prepared.reason, handoff: null };

  const instructions = hostAdapter.present(generateHostInstructions({
    candidate,
    resolution,
    facts,
    policy_context: input.policy_context || {},
    host_id: hostId,
  }));

  const createdAt = input.created_at || new Date().toISOString();
  const handoff = redactObject({
    schema: HANDOFF_SCHEMA,
    schema_version: 1,
    host_context_fingerprint: hostContextFingerprint(projectDir),
    task_scope: scoped.scope,
    workspace: { project_dir: projectDir.replace(/\\/g, '/'), same_workspace: true },
    project_id: facts.project_id || candidate.policy_context?.project_id || null,
    task_id: candidate.task_id,
    capability_id: candidate.capability_id,
    objective: candidate.objective,
    scope: candidate.scope || [],
    constraints: {
      allowed_paths: candidate.policy_context?.allowed_paths || [],
      forbidden_paths: candidate.policy_context?.forbidden_paths || [],
      agent_id: candidate.policy_context?.agent_id || null,
    },
    rationale: candidate.rationale || '',
    expected_evidence: candidate.expected_evidence || 'capability-assessment',
    operation_id: candidate.operation_id || null,
    expected_effects: candidate.expected_effects || [],
    relevant_evidence: { finding_ids: candidate.finding_ids || [], affected_files: candidate.affected_files || [] },
    completion_requirements: { forgeos_verification_required: true, host_completion_is_pass: false },
    verification_strategy: candidate.verification_strategy || 'none',
    verification_contract: candidate.verification_contract || null,
    verification_presence: candidate.verification_presence || [],
    verification_commands: candidate.verification_commands || [],
    policy_context: {
      project_id: candidate.policy_context?.project_id || facts.project_id || null,
      agent_id: candidate.policy_context?.agent_id || null,
      authority: POLICY_AUTHORITY,
      permission: policyDecision || null,
    },
    project_intelligence_fingerprint: facts.project_intelligence_fingerprint || null,
    host: {
      host_id: hostId,
      selection_source: selection.source,
      host_name: hostDescriptor.host_name,
      invocation: resolution.invocation || hostDescriptor.invocation || 'interactive',
    },
    implementation: {
      type: resolution.implementation_type,
      id: resolution.implementation_id,
      available: resolution.available !== false && resolution.resolved === true,
      executable: resolution.executable === true,
      invocation: resolution.invocation || hostDescriptor.invocation || 'interactive',
    },
    invocation_mode: resolution.invocation || hostDescriptor.invocation || 'interactive',
    instructions,
    execution_status: HANDOFF_EXECUTION_STATUS.HOST_INTERACTIVE_REQUIRED,
    verification_status: 'NOT_STARTED',
    prepared,
    forgeos_version: getCanonicalVersion(),
    created_at: createdAt,
    operation_fingerprint: candidate.operation_fingerprint || null,
    note: 'Handoff generated does not mean execution started or verification passed',
  });

  handoff.handoff_fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      task_id: handoff.task_id,
      capability_id: handoff.capability_id,
      pi: handoff.project_intelligence_fingerprint,
      operation: handoff.operation_fingerprint,
      invocation: handoff.invocation_mode,
      host_id: hostId,
      workspace: handoff.workspace,
    }))
    .digest('hex')
    .slice(0, 24);
  handoff.integrity = computeHandoffIntegrity(handoff);

  let persisted = null;
  if (input.persist !== false) {
    const dir = path.join(projectDir, DEFAULT_TASKS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const fullPath = handoffPath(projectDir, candidate.task_id);
    fs.writeFileSync(fullPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
    persisted = fullPath.replace(/\\/g, '/');
  }

  return {
    ok: true,
    reason: null,
    handoff,
    path: persisted,
    execution_status: handoff.execution_status,
    verification_status: handoff.verification_status,
    note: 'Interactive host work required; ForgeOS has not started a runtime',
  };
}

export function loadHostHandoff(projectDir, taskId) {
  try {
    const content = readProjectText(projectDir, `${DEFAULT_TASKS_DIR}/${safeTaskFileName(taskId)}.handoff.json`);
    if (content === null) return null;
    return JSON.parse(content);
  } catch {
    return { schema: 'invalid-handoff' };
  }
}

export function validateHostHandoff(handoff, context = {}) {
  const reasons = [];
  if (!handoff || handoff.schema !== HANDOFF_SCHEMA) {
    return { ok: false, reasons: ['invalid_or_missing_handoff'] };
  }
  if (handoff.integrity) {
    const expected = computeHandoffIntegrity(handoff);
    if (expected !== handoff.integrity) reasons.push('integrity_mismatch');
  } else {
    reasons.push('integrity_missing');
  }
  if (context.expected_task_id && handoff.task_id !== context.expected_task_id) {
    reasons.push('task_id_mismatch');
  }
  if (!isProductHost(handoff.host?.host_id)) reasons.push('unknown_host');
  if (context.expected_host_id && context.expected_host_id !== handoff.host?.host_id) reasons.push('host_id_mismatch');
  if (context.project_dir) {
    try {
      if (!handoff.workspace?.same_workspace || !handoff.workspace?.project_dir
        || fs.realpathSync(context.project_dir) !== fs.realpathSync(handoff.workspace.project_dir)) reasons.push('workspace_mismatch');
    } catch { reasons.push('workspace_mismatch'); }
    if (context.check_freshness !== false) {
      const scopeCheck = validateTaskScope(handoff.task_scope, { project_dir: context.project_dir,
        task_id: handoff.task_id, capability_id: handoff.capability_id, operation_id: handoff.operation_id });
      if (!scopeCheck.ok) reasons.push(scopeCheck.reason);
      try {
        if (!handoff.host_context_fingerprint || handoff.host_context_fingerprint !== hostContextFingerprint(context.project_dir)) reasons.push('stale_handoff');
      } catch { reasons.push('stale_handoff'); }
    }
  }
  if (context.expected_capability_id && handoff.capability_id !== context.expected_capability_id) {
    reasons.push('capability_id_mismatch');
  }
  if (
    context.project_intelligence_fingerprint
    && handoff.project_intelligence_fingerprint
    && handoff.project_intelligence_fingerprint !== context.project_intelligence_fingerprint
  ) {
    reasons.push('project_intelligence_mismatch');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Request verification for an interactive host task.
 * Does NOT declare success. Runs ForgeOS verification against project state.
 */
export function requestHostTaskVerification(input = {}) {
  try { return requestHostTaskVerificationChecked(input); }
  catch (e) { return { ok: false, reason: e.message, verification_status: 'UNKNOWN' }; }
}

function requestHostTaskVerificationChecked(input = {}) {
  const projectDir = path.resolve(input.project_dir || process.cwd());
  const taskId = String(input.task_id || '').trim();
  if (!taskId) {
    return { ok: false, reason: 'task_id_required', verification_status: 'UNKNOWN' };
  }

  handoffPath(projectDir, taskId);
  const selected = selectHost({ host_id: input.host_id, project_dir: projectDir });
  if (!selected.ok) return { ok: false, reason: selected.reason, verification_status: 'UNKNOWN' };
  const handoff = input.handoff || loadHostHandoff(projectDir, taskId);
  if (!handoff) {
    return { ok: false, reason: 'handoff_missing', verification_status: 'UNKNOWN' };
  }

  const validation = validateHostHandoff(handoff, {
    project_dir: projectDir,
    expected_host_id: selected.source === 'legacy_default' ? undefined : selected.host_id,
    expected_task_id: taskId,
    expected_capability_id: input.capability_id || handoff.capability_id,
  });
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reasons.includes('stale_handoff') ? 'stale_handoff' : 'handoff_invalid',
      validation,
      verification_status: 'UNKNOWN',
    };
  }
  if (handoff.policy_context?.permission === 'deny') {
    return { ok: false, reason: 'policy_deny', verification_status: 'UNKNOWN' };
  }
  if ([input.policy_decision, input.policy_context?.permission, input.policy_context?.policy_decision]
    .some(p => p === 'deny' || p?.permission === 'deny' || p?.decision === 'deny')) {
    return { ok: false, reason: 'policy_deny', verification_status: 'UNKNOWN' };
  }
  for (const ref of handoff.verification_presence || []) projectPath(projectDir, ref);
  if (input.persist !== false) {
    projectPath(projectDir, `${input.assessment_dir || 'docs/project/assessments'}/.path-check`);
    projectPath(projectDir, `${DEFAULT_TASKS_DIR}/${safeTaskFileName(taskId)}.verification.json`);
  }

  // Cross-task isolation: never accept handoff A for task B
  if (input.expected_task_id && handoff.task_id !== input.expected_task_id) {
    return {
      ok: false,
      reason: 'handoff_task_mismatch',
      verification_status: 'UNKNOWN',
    };
  }

  const facts = collectProjectFacts(projectDir);
  const bindings = loadCapabilityBindings(input.binding_options);
  const candidate = {
    task_id: handoff.task_id,
    capability_id: handoff.capability_id,
    operation_id: handoff.operation_id,
    task_scope: handoff.task_scope,
    verification_strategy: handoff.verification_strategy,
    verification_contract: handoff.verification_contract,
    verification_presence: handoff.verification_presence,
    verification_commands: handoff.verification_commands,
    observed_changed_paths: input.observed_changed_paths,
  };

  const fingerprints = computeEvidenceFingerprint(facts, {
    project_dir: projectDir,
    verification_strategy: candidate.verification_strategy,
    verification_presence: candidate.verification_presence,
    verification_commands: candidate.verification_commands,
    input_fingerprint: computeInputFingerprint(facts, bindings),
    capability_binding_fingerprint: capabilityBindingFingerprint(bindings),
    bindings,
  });

  // Treat interactive completion request as lifecycle COMPLETED for capability verification only.
  // This does NOT invent runtime success — presence/commands still decide PASS/FAIL/UNKNOWN.
  const verification = assessCapabilityVerification({
    governed: {
      status: 'COMPLETED',
      execution_id: `host-interactive:${handoff.task_id}`,
      task_id: handoff.task_id,
      capability_id: handoff.capability_id,
    },
    candidate,
    project_dir: projectDir,
    facts,
    fingerprints,
  });

  const evidence = createGovernanceEvidence({
    task_id: handoff.task_id,
    capability_id: handoff.capability_id,
    execution_id: `host-interactive:${handoff.task_id}`,
    verification,
    project_fingerprint: fingerprints,
    lifecycle_status: 'HOST_INTERACTIVE',
    rationale: verification.reason,
    affected_scope: handoff.scope,
    freshness_ttl: input.freshness_ttl,
    source_references: {
      verification: 'intelligence/orchestrator/capability-verification.mjs',
      handoff: 'intelligence/orchestrator/host-handoff.mjs',
      policy: 'policy/authority.mjs',
    },
  });

  if (input.persist !== false) {
    writeVerifiedRecord(projectDir, evidence, input);
    const updated = {
      ...handoff,
      execution_status: HANDOFF_EXECUTION_STATUS.VERIFICATION_REQUESTED,
      verification_status: verification.result,
      last_evidence_id: evidence.evidence_id,
      verified_at: verification.verified_at,
    };
    // Recompute integrity for updated handoff status fields — append note without rewriting history:
    // write a sibling completion receipt instead of mutating original handoff blob identity.
    const receiptPath = path.join(
      projectDir,
      DEFAULT_TASKS_DIR,
      `${safeTaskFileName(taskId)}.verification.json`
    );
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({
        schema: 'forgeos-host-task-verification-request',
        task_id: taskId,
        capability_id: handoff.capability_id,
        handoff_fingerprint: handoff.handoff_fingerprint,
        verification,
        evidence_id: evidence.evidence_id,
        requested_at: new Date().toISOString(),
        note: 'Completion request triggers verification; user done ≠ PASS',
      }, null, 2)}\n`,
      'utf8'
    );
    // Keep handoff file but update verification_status for CLI display (append-oriented receipt is authoritative for history)
    updated.integrity = computeHandoffIntegrity(updated);
    fs.writeFileSync(handoffPath(projectDir, taskId), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }

  let canvasAfter = null;
  let delta = null;
  if (input.rescan !== false) {
    const before = input.before_assessment || null;
    const after = runProjectAssessment({
      project_dir: projectDir,
      persist: input.persist === true,
      verified_records: {
        ...loadVerifiedRecords(projectDir, input),
        [handoff.capability_id]: evidence,
      },
    });
    canvasAfter = after.canvas;
    if (before?.canvas) {
      delta = buildCanvasDelta(before.canvas, after.canvas, {
        task_id: handoff.task_id,
        capability_id: handoff.capability_id,
        verification,
        evidence_id: evidence.evidence_id,
      });
    }
  }

  const satisfied = verificationAllowsSatisfied(verification);

  return {
    ok: true,
    phase: 'host_task_verification_requested',
    reason: null,
    task_id: taskId,
    capability_id: handoff.capability_id,
    handoff,
    execution_status: HANDOFF_EXECUTION_STATUS.VERIFICATION_REQUESTED,
    verification,
    verification_status: verification.result,
    evidence,
    capability_satisfied: satisfied
      && canvasAfter?.items?.find((i) => i.capability_id === handoff.capability_id)?.state === 'SATISFIED',
    canvas_after: canvasAfter,
    canvas_delta: delta,
    note: 'User/host completion is not verification PASS',
  };
}

export function formatHostHandoff(handoff) {
  if (!handoff) return 'No handoff.';
  return [
    'FORGEOS TASK',
    '',
    'Capability:',
    handoff.capability_id,
    '',
    'Objective:',
    handoff.objective || '',
    '',
    'Scope:',
    ...(handoff.scope || []).map((s) => `- ${s}`),
    '',
    'Why:',
    handoff.rationale || '',
    '',
    'Required evidence:',
    handoff.expected_evidence || '',
    '',
    'Verification:',
    handoff.verification_strategy || 'none',
    '',
    'HOST:',
    handoff.host?.host_name || handoff.host?.host_id || 'unknown',
    '',
    'MODE:',
    String(handoff.invocation_mode || 'interactive').replace(/^./, (c) => c.toUpperCase()),
    '',
    'EXECUTION:',
    handoff.execution_status,
    '',
    'VERIFICATION:',
    handoff.verification_status,
    '',
    'INSTRUCTIONS:',
    handoff.instructions || '',
  ].join('\n');
}
