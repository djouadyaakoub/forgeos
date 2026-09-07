/**
 * Main Agent / Capability Orchestration — Stage 11
 *
 * Intent → capability selection → dependency planning → task candidates.
 * PLAN ONLY. Does not execute, authorize, resolve as authority, or call runtimes.
 *
 * Boundaries:
 * - Policy Authority remains sole ALLOW/BLOCK
 * - Capability Resolver selects implementation downstream
 * - Governed execution remains the only path to backend.start()
 */
import crypto from 'node:crypto';
import { loadCapabilityBindings } from '../capability/binding.mjs';
import { resolveCapability } from '../capability/resolver.mjs';
import { runProjectAssessment } from '../assessment/engine.mjs';
import { collectProjectFacts } from '../assessment/facts.mjs';
import { createTaskCandidate, defaultRemediationOperation } from '../assessment/task-candidate.mjs';
import {
  selectOperationsForFindings,
  pickPreferredOperationCandidate,
} from '../capability/operation-selection.mjs';
import { analyzeIntent, normalizeIntentFingerprint } from './intent.mjs';
import { selectCapabilities } from './capability-selection.mjs';
import { planCapabilityDependencies } from './dependency-planner.mjs';

export const MAIN_AGENT_SCHEMA = 'forgeos-orchestration-plan';
export const EXECUTION_STATUS_NOT_STARTED = 'NOT_STARTED';

const RISK_RANK = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
  unknown: -1,
});

/**
 * Produce a deterministic orchestration plan. Never executes.
 */
export function planFromRequest(input = {}) {
  const request = input.request ?? input.text ?? '';
  const projectDir = input.project_dir || process.cwd();
  const bindings = input.bindings || loadCapabilityBindings(input.binding_options);
  const facts = input.facts || collectProjectFacts(projectDir, input);
  const hostContext = input.host_context || {
    host_id: input.host_id || 'cli',
    capabilities: ['read', 'analyze', 'plan', 'write', 'test'],
  };
  const policyContext = input.policy_context || {};

  const assessment = input.assessment || runProjectAssessment({
    project_dir: projectDir,
    persist: input.persist === true,
    host_context: hostContext,
    policy_context: policyContext,
    bindings,
    facts,
  });

  const intent = input.intent || analyzeIntent(request, {
    allow_empty_hints: input.allow_empty_hints === true,
  });

  const selection = selectCapabilities({
    intent,
    assessment,
    bindings,
    extra_capability_ids: input.extra_capability_ids,
    force_include: input.force_include === true,
  });

  const dependencyPlan = planCapabilityDependencies({
    selected: selection.selected,
    bindings,
  });

  if (dependencyPlan.cycle_detected) {
    return buildPlanResult({
      intent,
      selection,
      dependencyPlan,
      task_candidates: [],
      unresolved_questions: [
        ...intent.unresolved_questions,
        {
          code: 'dependency_cycle',
          question: `Capability dependency cycle detected: ${(dependencyPlan.cycle_capability_ids || []).join(' → ')}`,
        },
      ],
      facts,
      assessment,
      hostContext,
      policyContext,
      projectDir,
      block_reason: 'dependency_cycle',
    });
  }

  const taskCandidates = buildTaskCandidatesFromPlan({
    ordered: dependencyPlan.ordered,
    independent_ids: dependencyPlan.independent_capability_ids,
    facts,
    hostContext,
    policyContext,
    assessment,
    intent,
  });

  const unresolvedQuestions = [
    ...intent.unresolved_questions,
    ...selection.unresolved.map((u) => ({
      code: u.reason,
      question: u.reason === 'no_registered_capability'
        ? `No registered capability matches "${u.capability_id}".`
        : `Unresolved capability requirement: ${u.capability_id}`,
      detail: u,
    })),
    ...dependencyPlan.unresolved_dependencies.map((u) => ({
      code: 'unresolved_dependency',
      question: `Capability ${u.capability_id} requires missing dependency ${u.missing_dependency}`,
      detail: u,
    })),
  ];

  return buildPlanResult({
    intent,
    selection,
    dependencyPlan,
    task_candidates: taskCandidates,
    unresolved_questions: unresolvedQuestions,
    facts,
    assessment,
    hostContext,
    policyContext,
    projectDir,
  });
}

/**
 * Alias matching Stage 11 contract naming.
 */
export function coordinateMainAgentPlan(input = {}) {
  return planFromRequest(input);
}

function buildTaskCandidatesFromPlan(ctx) {
  const {
    ordered,
    independent_ids,
    facts,
    hostContext,
    policyContext,
    assessment,
    intent,
  } = ctx;
  const independent = new Set(independent_ids || []);
  const prefix = facts.project_intelligence?.project?.task_id_prefix || 'FORGEOS';
  const assessmentByCap = new Map();
  for (const row of assessment?.assessments || []) {
    const id = row.binding?.id;
    if (id) assessmentByCap.set(id, row);
  }

  const idToTask = new Map();
  const candidates = [];

  for (const node of ordered) {
    const binding = node.binding;
    if (!binding) continue;

    const row = assessmentByCap.get(node.capability_id);
    const assessmentState = node.assessment_state || row?.assessment?.state || 'UNKNOWN';

    // Dependency-only SATISFIED nodes: include as inspectable non-remediation tasks
    // only when user did not request them — still emit a lightweight candidate for graph.
    const dependsOnCaps = (node.requires || []).filter((r) => idToTask.has(r));
    const dependsOnTasks = dependsOnCaps.map((c) => idToTask.get(c));

    const assessmentObj = row?.assessment || {
      capability_id: binding.id,
      state: assessmentState,
      severity: node.severity || binding.default_severity,
      rationale: node.reason || '',
      evidence: [],
    };

    let remediationPayload = null;
    let preferredOperation = null;
    if (
      assessmentState !== 'SATISFIED'
      && assessmentState !== 'NOT_APPLICABLE'
      && !(node.include_for_dependency && assessmentState === 'SATISFIED')
    ) {
      const opSelection = selectOperationsForFindings({
        capability_id: binding.id,
        findings: assessmentObj.evidence || [],
        facts,
        assessment: assessmentObj,
        changed_files: facts.changed_files,
      });
      preferredOperation = pickPreferredOperationCandidate(opSelection);
      remediationPayload = defaultRemediationOperation(binding, assessmentObj, facts);
    }

    const resolution = resolveCapability({
      capability_id: binding.id,
      capability_binding: binding,
      project_intelligence: facts.project_intelligence,
      host_context: hostContext,
      policy_context: policyContext,
      operation_id: preferredOperation?.operation_id,
      capability_operation: preferredOperation?.operation,
    });

    const taskId = `${prefix}-${binding.id}`;
    const created = createTaskCandidate({
      task_id: taskId,
      capability_id: binding.id,
      operation_id: preferredOperation?.operation_id || null,
      capability_operation: preferredOperation
        ? { ...preferredOperation.operation, scope: preferredOperation.scope }
        : null,
      finding_ids: preferredOperation?.finding_ids || [],
      finding_fingerprints: preferredOperation?.finding_ids || [],
      affected_files: preferredOperation?.scope?.affected_files || [],
      operation_binding_fingerprint: preferredOperation?.operation_binding_fingerprint || null,
      objective: preferredOperation?.operation?.name
        ? `${preferredOperation.operation.name}: ${intent.requested_outcome || binding.id}`
        : (intent.requested_outcome
          || `Address ${binding.id} for project ${facts.project_id || 'target'}`),
      scope: binding.domains || [],
      rationale: node.reason || assessmentObj.rationale || binding.description,
      severity: assessmentObj.severity || binding.default_severity,
      risk: preferredOperation?.risk || null,
      proposed_implementation: resolution.implementation_type || binding.preferred_implementation,
      implementation_id: resolution.implementation_id || null,
      expected_evidence: binding.evidence_schema,
      expected_effects: preferredOperation?.expected_effects || [],
      verification_strategy: preferredOperation?.verification_strategy || binding.verification_strategy,
      verification_commands: facts.verification_commands || [],
      verification_presence: [
        ...(preferredOperation?.verification_presence || []),
        ...(remediationPayload?.writes || []).map((w) => w.path),
      ],
      project_id: facts.project_id,
      project_intelligence_fingerprint: facts.project_intelligence_fingerprint,
      agent_id: binding.specialist_ids?.[0] || 'orchestrator',
      allowed_paths: preferredOperation?.scope?.allowed_paths?.length
        ? preferredOperation.scope.allowed_paths
        : (binding.paths_writable?.length ? binding.paths_writable : ['docs/**']),
      forbidden_paths: preferredOperation?.scope?.forbidden_paths?.length
        ? preferredOperation.scope.forbidden_paths
        : ['.cursor/**', '.agent-os/**', 'policy/**'],
      operation: remediationPayload,
      depends_on: dependsOnTasks,
      parallelizable: independent.has(binding.id) && dependsOnTasks.length === 0,
    });

    if (!created.valid) continue;
    idToTask.set(binding.id, taskId);
    candidates.push({
      ...created.candidate,
      assessment_state: assessmentState,
      resolution: {
        implementation_type: resolution.implementation_type,
        implementation_id: resolution.implementation_id,
        resolved: resolution.resolved,
        reasons: resolution.reasons,
        operation: resolution.operation || null,
      },
      host_native_preferred: binding.preferred_implementation === 'host_native',
    });
  }

  return dedupeTasks(candidates);
}

function buildPlanResult(ctx) {
  const {
    intent,
    selection,
    dependencyPlan,
    task_candidates,
    unresolved_questions,
    facts,
    assessment,
    hostContext,
    policyContext,
    projectDir,
    block_reason,
  } = ctx;

  const riskSummary = summarizeRisk(selection.selected, task_candidates);
  const capabilities = (dependencyPlan.ordered || []).map((n) => ({
    capability_id: n.capability_id,
    reason: n.reason,
    assessment_state: n.assessment_state,
    requires: n.requires || [],
    severity: n.severity || n.assessment_severity || null,
    specialist_ids: n.binding?.specialist_ids || [],
    preferred_implementation: n.binding?.preferred_implementation || null,
  }));

  const planFingerprint = computePlanFingerprint({
    intent,
    capabilities,
    dependencyPlan,
    task_candidates,
    assessment,
    facts,
  });

  const plan = {
    schema: MAIN_AGENT_SCHEMA,
    schema_version: 1,
    plan_id: planFingerprint,
    plan_fingerprint: planFingerprint,
    intent,
    requested_outcome: intent.requested_outcome,
    capabilities,
    task_candidates,
    dependencies: dependencyPlan.dependencies || [],
    ordered_capability_ids: dependencyPlan.ordered_capability_ids || [],
    independent_capability_ids: dependencyPlan.independent_capability_ids || [],
    rationale: selection.rationale || [],
    unresolved: selection.unresolved || [],
    unresolved_questions,
    skipped: selection.skipped || [],
    risk_summary: riskSummary,
    cycle_detected: dependencyPlan.cycle_detected === true,
    cycle_capability_ids: dependencyPlan.cycle_capability_ids || [],
    execution_status: EXECUTION_STATUS_NOT_STARTED,
    approval_required: true,
    block_reason: block_reason || null,
    project: {
      dir: projectDir,
      id: facts.project_id || null,
      intelligence_fingerprint: facts.project_intelligence_fingerprint || null,
    },
    assessment_fingerprint: assessment?.canvas?.fingerprint || null,
    host_context: {
      host_id: hostContext.host_id || null,
      capabilities: hostContext.capabilities || [],
    },
    policy_context_present: Boolean(policyContext && Object.keys(policyContext).length),
    boundaries: {
      executes: false,
      policy_authority: false,
      runtime_router: false,
      calls_backend_start: false,
      resolver_selects_implementation: true,
      governed_execution_downstream: true,
    },
  };

  return {
    ok: !plan.cycle_detected && (plan.task_candidates.length > 0 || plan.unresolved_questions.length > 0),
    phase: 'main_agent_plan',
    mode: 'plan_only',
    execute: false,
    plan,
    assessment_summary: {
      capability_count: assessment?.canvas?.summary?.total ?? null,
      actionable: assessment?.canvas?.summary?.actionable ?? null,
    },
  };
}

function summarizeRisk(selected, tasks) {
  let max = 'UNKNOWN';
  let maxRank = -1;
  for (const item of [...(selected || []), ...(tasks || [])]) {
    const sev = String(item.assessment_severity || item.severity || 'unknown').toLowerCase();
    const rank = RISK_RANK[sev] ?? -1;
    if (rank > maxRank) {
      maxRank = rank;
      max = sev === 'info' ? 'LOW' : sev.toUpperCase();
    }
  }
  if (maxRank < 0) max = 'UNKNOWN';
  if (max === 'CRITICAL') max = 'HIGH';
  return {
    level: max,
    note: 'Risk is informational. Policy Authority remains authoritative for allow/deny.',
  };
}

export function computePlanFingerprint(parts = {}) {
  const intentFp = normalizeIntentFingerprint(parts.intent || {});
  const caps = (parts.capabilities || parts.dependencyPlan?.ordered_capability_ids || [])
    .map((c) => (typeof c === 'string' ? c : c.capability_id))
    .filter(Boolean)
    .sort();
  const deps = (parts.dependencyPlan?.dependencies || parts.dependencies || [])
    .map((d) => `${d.from}->${d.to}`)
    .sort();
  const tasks = (parts.task_candidates || [])
    .map((t) => `${t.task_id}:${t.capability_id}:${(t.depends_on || []).join(',')}`)
    .sort();
  const assessmentStates = (parts.assessment?.canvas?.items || [])
    .filter((i) => caps.includes(i.capability_id))
    .map((i) => `${i.capability_id}:${i.state}`)
    .sort();

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      intent: intentFp,
      pi: parts.facts?.project_intelligence_fingerprint || null,
      caps,
      deps,
      tasks,
      assessmentStates,
    }))
    .digest('hex')
    .slice(0, 24);
}

function dedupeTasks(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (!map.has(t.task_id)) map.set(t.task_id, t);
  }
  return [...map.values()];
}

/**
 * Format a human-readable plan preview.
 */
export function formatOrchestrationPlan(plan) {
  if (!plan) return 'No plan.';
  const lines = [
    'FORGEOS PLAN',
    '',
    'REQUEST:',
    JSON.stringify(plan.intent?.raw_request || ''),
    '',
    'UNDERSTANDING:',
    plan.requested_outcome || plan.intent?.requested_outcome || '(unknown)',
    '',
    'CAPABILITIES:',
  ];

  if (!plan.capabilities?.length) {
    lines.push('(none selected)');
  } else {
    plan.capabilities.forEach((c, idx) => {
      lines.push(`${idx + 1}. ${c.capability_id}`);
      lines.push(`   reason: ${c.reason || ''}`);
      if (c.requires?.length) lines.push(`   depends on: ${c.requires.join(', ')}`);
      if (c.assessment_state) lines.push(`   assessment: ${c.assessment_state}`);
      if (c.preferred_implementation) lines.push(`   implementation: ${c.preferred_implementation}`);
    });
  }

  lines.push('', 'TASKS:');
  if (!plan.task_candidates?.length) {
    lines.push('(none)');
  } else {
    plan.task_candidates.forEach((t, idx) => {
      const deps = t.depends_on?.length ? ` depends_on=[${t.depends_on.join(', ')}]` : '';
      lines.push(`T${idx + 1} ${t.task_id} (${t.capability_id})${deps}`);
    });
  }

  if (plan.unresolved_questions?.length) {
    lines.push('', 'UNRESOLVED QUESTIONS:');
    for (const q of plan.unresolved_questions) {
      lines.push(`- ${q.question || q.code}`);
    }
  }

  lines.push(
    '',
    `RISK: ${plan.risk_summary?.level || 'UNKNOWN'}`,
    '',
    'EXECUTION:',
    plan.execution_status || EXECUTION_STATUS_NOT_STARTED,
    '',
    'APPROVAL:',
    plan.approval_required ? 'Required (task-scoped)' : 'Not required',
    '',
    `PLAN FINGERPRINT: ${plan.plan_fingerprint || plan.plan_id || ''}`,
  );
  return lines.join('\n');
}
