/**
 * Task candidate contract — Stages 9 + 14
 *
 * Candidates reference Project Intelligence; they do not duplicate it.
 * Candidates never execute.
 *
 * Stage 14 binds Capability Operations without collapsing:
 * CAPABILITY ≠ FINDING ≠ OPERATION ≠ TASK
 */
import crypto from 'node:crypto';
import { bindTaskScope } from '../../policy/task-scope.mjs';
import { normalizeVerificationCommands } from '../orchestrator/fingerprints.mjs';
import {
  selectOperationsForFindings,
  pickPreferredOperationCandidate,
} from '../capability/operation-selection.mjs';
import { fingerprintOperationBinding } from '../capability/operation.mjs';

export const TASK_CANDIDATE_SCHEMA = 'forgeos-task-candidate';

export function fingerprintOperation(operation = null) {
  if (!operation) return null;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      type: operation.type || null,
      path: operation.path || null,
      writes: (operation.writes || []).map((w) => w.path).sort(),
      commands: operation.commands || [],
    }))
    .digest('hex')
    .slice(0, 24);
}

export function createTaskCandidate(input = {}) {
  const taskId = String(input.task_id || '').trim();
  const capabilityId = String(input.capability_id || '').trim();
  if (!taskId || !capabilityId) {
    return {
      valid: false,
      error: 'task_id_and_capability_id_required',
      candidate: null,
    };
  }

  const operation = input.operation || null;
  const capabilityOperation = input.capability_operation || null;
  const allowedPaths = input.allowed_paths
    || capabilityOperation?.scope?.allowed_paths
    || ['docs/**'];
  const forbiddenPaths = input.forbidden_paths
    || capabilityOperation?.scope?.forbidden_paths
    || ['.cursor/**', '.agent-os/**', 'policy/**'];

  const findingIds = Array.isArray(input.finding_ids)
    ? input.finding_ids.map(String)
    : [];
  const affectedFiles = Array.isArray(input.affected_files)
    ? input.affected_files.map(String)
    : (capabilityOperation?.scope?.affected_files || []);

  const operationBindingFingerprint = input.operation_binding_fingerprint
    || (capabilityOperation
      ? fingerprintOperationBinding({
        operation_id: capabilityOperation.id || input.operation_id,
        operation_fingerprint: capabilityOperation.operation_fingerprint,
        capability_id: capabilityId,
        allowed_paths: allowedPaths,
        forbidden_paths: forbiddenPaths,
        affected_files: affectedFiles,
        project_intelligence_fingerprint: input.project_intelligence_fingerprint,
        finding_ids: findingIds,
        finding_fingerprints: input.finding_fingerprints || findingIds,
        verification_strategy: input.verification_strategy
          || capabilityOperation.verification_strategy,
      })
      : null);

  const candidate = {
    schema: TASK_CANDIDATE_SCHEMA,
    schema_version: 1,
    task_id: taskId,
    capability_id: capabilityId,
    operation_id: input.operation_id || capabilityOperation?.id || null,
    objective: String(input.objective || ''),
    scope: Array.isArray(input.scope) ? input.scope.map(String) : [],
    rationale: String(input.rationale || ''),
    severity: String(input.severity || 'medium'),
    risk: input.risk || capabilityOperation?.risk || null,
    implementation: {
      type: input.implementation?.type || input.proposed_implementation || null,
      id: input.implementation?.id || input.implementation_id || null,
    },
    expected_evidence: input.expected_evidence || 'capability-assessment',
    expected_effects: Array.isArray(input.expected_effects)
      ? input.expected_effects.map(String)
      : (capabilityOperation?.expected_effects || []),
    verification_strategy: input.verification_strategy || 'none',
    verification_contract: input.verification_contract || null,
    verification_commands: normalizeVerificationCommands(
      input.verification_commands || []
    ),
    verification_presence: Array.isArray(input.verification_presence)
      ? input.verification_presence.map(String)
      : [],
    policy_context: {
      project_id: input.project_id || null,
      agent_id: input.agent_id || null,
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
    },
    created_at: input.created_at || new Date().toISOString(),
    // Stage 9 remediation payload (e.g. write_files) — not the capability operation registry record
    operation,
    operation_fingerprint: fingerprintOperation(operation),
    // Stage 14 capability operation binding
    capability_operation: capabilityOperation
      ? {
        id: capabilityOperation.id,
        capability_id: capabilityOperation.capability_id,
        name: capabilityOperation.name,
        operation_type: capabilityOperation.operation_type,
        risk: capabilityOperation.risk,
        version: capabilityOperation.version,
        operation_fingerprint: capabilityOperation.operation_fingerprint,
        preferred_implementation: capabilityOperation.preferred_implementation,
        implementation_types: capabilityOperation.implementation_types,
        expected_effects: capabilityOperation.expected_effects,
        verification_strategy: capabilityOperation.verification_strategy,
      }
      : null,
    finding_ids: findingIds,
    affected_files: affectedFiles,
    operation_binding_fingerprint: operationBindingFingerprint,
    depends_on: Array.isArray(input.depends_on) ? input.depends_on.map(String) : [],
    parallelizable: input.parallelizable === true,
    execute: false,
    auto_execute: false,
  };

  if (input.permitted_action_classes) candidate.permitted_action_classes = input.permitted_action_classes;
  if (input.task_scope) candidate.task_scope = input.task_scope;
  if (input.project_dir) {
    const scoped = bindTaskScope(candidate, input.project_dir);
    if (!scoped.ok) return { valid: false, error: scoped.reason, candidate: null };
    candidate.task_scope = scoped.scope;
  }
  return { valid: true, error: null, candidate };
}

export function defaultRemediationOperation(binding, assessment, facts) {
  if (binding?.id === 'documentation-sync' || binding?.id === 'documentation-drift') {
    const findings = assessment?.evidence || [];
    const writes = [];
    if (findings.some((f) => f.type === 'missing_agents_md') || facts?.has_agents_md === false) {
      writes.push({
        path: 'AGENTS.md',
        content: `# AGENTS.md — ${facts?.project_id || 'Project'}\n\nForgeOS Stage 9 documentation remediation.\n`,
      });
    }
    if (writes.length === 0) return null;
    return {
      type: 'write_files',
      writes,
    };
  }
  return null;
}

/**
 * Build Stage 14 operation candidates from assessment evidence.
 */
export function selectOperationCandidatesForAssessment(binding, assessment, facts, options = {}) {
  return selectOperationsForFindings({
    capability_id: binding.id,
    findings: assessment?.evidence || [],
    facts,
    assessment,
    changed_files: facts.changed_files || options.changed_files,
    bindings: options.bindings,
  });
}

export function buildTaskCandidateFromAssessment(binding, assessment, resolution, facts, options = {}) {
  if (['SATISFIED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(assessment.state)) {
    return null;
  }
  const prefix = facts.project_intelligence?.project?.task_id_prefix || 'FORGEOS';
  const taskId = `${prefix}-${binding.id}`;

  const selection = options.operation_selection
    || selectOperationCandidatesForAssessment(binding, assessment, facts, options);
  const preferred = options.operation_candidate
    || pickPreferredOperationCandidate(selection);

  // Stage 9 remediation payload preserved for forgeos_native documentation writes
  const remediationPayload = options.operation
    || defaultRemediationOperation(binding, assessment, facts);

  const capabilityOperation = preferred?.operation || null;
  const findingIds = preferred?.finding_ids || [];
  const affectedFiles = preferred?.scope?.affected_files || [];

  const presenceFromOp = [
    ...(['documentation-sync','documentation-drift'].includes(binding.id) ? ['AGENTS.md'] : []),
    ...(capabilityOperation?.verification_presence || []),
    ...(remediationPayload?.writes || []).map((w) => w.path),
  ];

  const preferredImpl = capabilityOperation?.preferred_implementation
    || resolution?.implementation_type
    || binding.preferred_implementation;

  const created = createTaskCandidate({
    task_id: taskId,
    capability_id: binding.id,
    project_dir: facts.project_dir,
    operation_id: capabilityOperation?.id || null,
    capability_operation: preferred
      ? { ...capabilityOperation, scope: preferred.scope }
      : null,
    finding_ids: findingIds,
    finding_fingerprints: findingIds,
    affected_files: affectedFiles,
    operation_binding_fingerprint: preferred?.operation_binding_fingerprint || null,
    objective: capabilityOperation
      ? `${capabilityOperation.name}: improve ${binding.id} for project ${facts.project_id || 'target'}`
      : `Improve ${binding.id} for project ${facts.project_id || 'target'} according to ForgeOS capability rules`,
    scope: binding.domains || [],
    rationale: assessment.rationale,
    severity: assessment.severity,
    risk: preferred?.risk || capabilityOperation?.risk || null,
    proposed_implementation: resolution?.implementation_type || preferredImpl,
    implementation_id: resolution?.implementation_id || null,
    expected_evidence: binding.evidence_schema,
    expected_effects: preferred?.expected_effects || capabilityOperation?.expected_effects || [],
    verification_strategy: capabilityOperation?.verification_strategy
      || binding.verification_strategy,
    verification_commands: normalizeVerificationCommands(facts.verification_commands || []),
    verification_presence: [...new Set(presenceFromOp)],
    project_id: facts.project_id,
    project_intelligence_fingerprint: facts.project_intelligence_fingerprint,
    agent_id: binding.specialist_ids?.[0] || 'orchestrator',
    allowed_paths: capabilityOperation?.scope?.allowed_paths?.length
      ? capabilityOperation.scope.allowed_paths
      : (binding.paths_writable?.length ? binding.paths_writable : ['docs/**', 'AGENTS.md']),
    forbidden_paths: capabilityOperation?.scope?.forbidden_paths?.length
      ? capabilityOperation.scope.forbidden_paths
      : ['.cursor/**', '.agent-os/**', 'policy/**'],
    created_at: options.created_at || new Date().toISOString(),
    operation: remediationPayload,
  });

  if (!created.valid) return null;

  return {
    ...created.candidate,
    recommended_operations: (selection.candidates || []).map((c) => ({
      operation_id: c.operation_id,
      risk: c.risk,
      finding_ids: c.finding_ids,
      implementation_types: c.operation.implementation_types,
      preferred_implementation: c.operation.preferred_implementation,
    })),
    operation_selection_unresolved: selection.unresolved || [],
  };
}
