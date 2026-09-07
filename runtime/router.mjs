/**
 * ForgeOS Optional Programmatic Backend Selector (Runtime Router)
 * Architecture 2.0 Stage 4 — reframed Stage 17
 *
 * Control-plane selector only for OPTIONAL RuntimeBackends:
 *   Policy Authority → Optional Backend Selector → Runtime Backend Interface
 *
 * NOT the primary ForgeOS agent router.
 * Capability Resolver owns host_native / forgeos_native / oss_derived selection.
 * This module only selects among registered programmatic RuntimeBackends
 * (e.g. Local Executor reference, OpenHands optional_runtime).
 *
 * The Router decides which registered backend is *eligible*.
 * It does NOT authorize (Policy Authority) and does NOT execute (no start/cancel/evidence).
 *
 * Multi-backend selection: deterministic registration order (first eligible wins).
 * No cost/latency/reputation scoring in Stage 4.
 */
import { POLICY_AUTHORITY, PRODUCT_ID } from '../policy/identity.mjs';
import {
  createPolicyDecisionContext,
  createCanHandleResult,
} from './backend-interface.mjs';
import { defaultRuntimeRegistry } from './registry.mjs';

export const ROUTE_STATUSES = [
  'DENIED',
  'NO_COMPATIBLE_BACKEND',
  'ROUTED',
  'INVALID_REQUEST',
  'NO_BACKENDS_REGISTERED',
];

/** Health statuses that may be selected. Others are filtered with distinct reasons. */
const SELECTABLE_HEALTH = new Set(['healthy']);

function asString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract capability requirements from task + project intelligence + policy context.
 */
export function extractRoutingRequirements(task = {}, projectIntelligence = null, policyContext = {}) {
  const runtimeReqs =
    projectIntelligence?.runtime?.requirements ||
    policyContext.runtime_requirements ||
    {};
  const taskReqs = isPlainObject(task.requirements) ? task.requirements : {};
  const isolation =
    policyContext.isolation_requirements ||
    task.isolation_requirements ||
    projectIntelligence?.runtime?.isolation ||
    {};

  const reqs = {
    ...runtimeReqs,
    ...taskReqs,
  };

  if (isolation.sandbox === true || isolation.level === 'sandbox') {
    reqs.sandbox = true;
  }
  if (policyContext.sandbox === true) reqs.sandbox = true;
  if (policyContext.interactive === true || task.interactive === true) {
    reqs.interactive = true;
  }
  if (policyContext.autonomous === true || task.autonomous === true) {
    reqs.autonomous = true;
  }
  if (policyContext.parallel === true || task.parallel === true) {
    reqs.parallel = true;
  }
  if (policyContext.language || task.language) {
    reqs.language = policyContext.language || task.language;
  }
  if (Array.isArray(projectIntelligence?.stack?.detected) && !reqs.language) {
    // Optional hint only when stack lists a single language-like token — not used as auth.
  }

  return reqs;
}

function normalizePolicyContext(policyContext = {}) {
  if (!policyContext || typeof policyContext !== 'object') {
    throw new Error('policyContext is required');
  }
  return createPolicyDecisionContext({
    authority: policyContext.authority || POLICY_AUTHORITY,
    decision: policyContext.decision || policyContext.permission,
    reason: policyContext.reason,
    operation: policyContext.operation,
    task_id: policyContext.task_id,
    agent_id: policyContext.agent_id,
    rule: policyContext.rule,
  });
}

function buildPolicyRequirements(policyContext = {}, requirements = {}) {
  return {
    allowed_paths: Array.isArray(policyContext.allowed_paths)
      ? policyContext.allowed_paths.map(String)
      : [],
    forbidden_paths: Array.isArray(policyContext.forbidden_paths)
      ? policyContext.forbidden_paths.map(String)
      : [],
    approval_scopes: Array.isArray(policyContext.approval_scopes)
      ? policyContext.approval_scopes.map(String)
      : [],
    ...requirements,
  };
}

function evaluateCandidate(backend, task, projectIntelligence, policyRequirements) {
  let health;
  try {
    health = backend.health();
  } catch (err) {
    return {
      backend_id: backend.id,
      eligible: false,
      health: { status: 'unknown', detail: { error: String(err.message || err) } },
      can_handle: createCanHandleResult(false, [
        { code: 'other', message: `health() threw: ${err.message}` },
      ]),
      reasons: [{ code: 'health_unknown', message: 'health() failed' }],
    };
  }

  const healthStatus = health?.status || 'unknown';
  const reasons = [];

  if (!SELECTABLE_HEALTH.has(healthStatus)) {
    const code =
      healthStatus === 'unhealthy'
        ? 'backend_unhealthy'
        : healthStatus === 'unavailable'
          ? 'backend_unavailable'
          : 'health_not_selectable';
    reasons.push({
      code,
      message: `backend health is ${healthStatus} (not selectable)`,
    });
  }

  let canHandle;
  try {
    canHandle = backend.canHandle(task, projectIntelligence, policyRequirements);
  } catch (err) {
    canHandle = createCanHandleResult(false, [
      { code: 'other', message: `canHandle() threw: ${err.message}` },
    ]);
  }

  if (!canHandle?.match) {
    for (const r of canHandle?.reasons || []) {
      reasons.push(typeof r === 'string' ? { code: r, message: r } : r);
    }
    if (!canHandle?.reasons?.length) {
      reasons.push({ code: 'other', message: 'canHandle returned no-match' });
    }
  }

  // Authorization must never appear from canHandle
  if (canHandle && canHandle.authorization != null) {
    reasons.push({
      code: 'other',
      message: 'canHandle must not grant authorization',
    });
  }

  const eligible =
    SELECTABLE_HEALTH.has(healthStatus) &&
    Boolean(canHandle?.match) &&
    canHandle?.authorization == null;

  return {
    backend_id: backend.id,
    name: backend.name,
    version: backend.version,
    fixture: Boolean(backend._fixture),
    eligible,
    health: { status: healthStatus, detail: health?.detail || {} },
    can_handle: {
      match: Boolean(canHandle?.match),
      reasons: canHandle?.reasons || [],
      authorization: null,
    },
    reasons,
  };
}

/**
 * Build a RouteDecision object.
 */
export function createRouteDecision(input = {}) {
  return {
    status: input.status,
    task_id: asString(input.task_id),
    backend_id: input.backend_id == null ? null : asString(input.backend_id),
    reasons: Array.isArray(input.reasons) ? input.reasons : [],
    candidates: Array.isArray(input.candidates) ? input.candidates : [],
    policy_decision: input.policy_decision || null,
    selection: input.selection || null,
    /** Routing evidence — not runtime execution evidence */
    evidence: input.evidence || null,
    product: PRODUCT_ID,
    /** Explicit: routing does not authorize and does not start */
    authorization: null,
    execution: null,
  };
}

/**
 * Route a ForgeOS task to an eligible Runtime Backend.
 *
 * @param {object} input
 * @param {object} input.task - must include task_id
 * @param {object|null} input.projectIntelligence
 * @param {object} input.policyContext - ForgeOS policy decision + constraints
 * @param {string} [input.backend_id] - explicit backend request
 * @param {object} [input.registry] - registry instance
 */
export function route(input = {}) {
  const registry = input.registry || defaultRuntimeRegistry;
  const task = input.task || {};
  const projectIntelligence = input.projectIntelligence ?? input.project_intelligence ?? null;
  const policyContext = input.policyContext || input.policy_context || {};
  const explicitBackendId = input.backend_id || input.backendId || task.backend_id || null;

  const taskId = asString(task.task_id || task.id || policyContext.task_id);
  if (!taskId) {
    return createRouteDecision({
      status: 'INVALID_REQUEST',
      task_id: '',
      reasons: [{ code: 'missing_task_id', message: 'task_id is required for routing' }],
      evidence: { stage: 'validate_request' },
    });
  }

  let policyDecision;
  try {
    policyDecision = normalizePolicyContext({
      ...policyContext,
      task_id: policyContext.task_id || taskId,
    });
  } catch (err) {
    return createRouteDecision({
      status: 'INVALID_REQUEST',
      task_id: taskId,
      reasons: [{ code: 'invalid_policy_context', message: err.message }],
      evidence: { stage: 'normalize_policy' },
    });
  }

  // Invariant: policy DENY → no backend selected
  if (policyDecision.decision === 'deny') {
    return createRouteDecision({
      status: 'DENIED',
      task_id: taskId,
      backend_id: null,
      policy_decision: policyDecision,
      reasons: [
        {
          code: 'forgeos_policy_deny',
          message: policyDecision.reason || 'ForgeOS Policy Authority denied this operation',
        },
      ],
      candidates: [],
      evidence: {
        stage: 'policy_gate',
        task_id: taskId,
        policy_decision: policyDecision,
        note: 'Router does not select backends after ForgeOS DENY',
      },
    });
  }

  const backends = registry.list();
  if (backends.length === 0) {
    return createRouteDecision({
      status: 'NO_BACKENDS_REGISTERED',
      task_id: taskId,
      backend_id: null,
      policy_decision: policyDecision,
      reasons: [{ code: 'no_backends_registered', message: 'Runtime Registry is empty' }],
      candidates: [],
      evidence: {
        stage: 'registry',
        task_id: taskId,
        policy_decision: policyDecision,
        registered_count: 0,
      },
    });
  }

  const requirements = extractRoutingRequirements(task, projectIntelligence, policyContext);
  const policyRequirements = buildPolicyRequirements(policyContext, requirements);
  const taskForCanHandle = { ...task, task_id: taskId, requirements };

  let candidates;
  if (explicitBackendId) {
    const backend = registry.get(explicitBackendId);
    if (!backend) {
      return createRouteDecision({
        status: 'NO_COMPATIBLE_BACKEND',
        task_id: taskId,
        backend_id: null,
        policy_decision: policyDecision,
        reasons: [
          {
            code: 'explicit_backend_not_found',
            message: `Requested backend_id '${explicitBackendId}' is not registered`,
          },
        ],
        candidates: [],
        evidence: {
          stage: 'explicit_selection',
          task_id: taskId,
          requested_backend_id: explicitBackendId,
          policy_decision: policyDecision,
        },
      });
    }
    candidates = [
      evaluateCandidate(backend, taskForCanHandle, projectIntelligence, policyRequirements),
    ];
  } else {
    candidates = backends.map((b) =>
      evaluateCandidate(b, taskForCanHandle, projectIntelligence, policyRequirements)
    );
  }

  const eligible = candidates.filter((c) => c.eligible);

  if (eligible.length === 0) {
    return createRouteDecision({
      status: 'NO_COMPATIBLE_BACKEND',
      task_id: taskId,
      backend_id: null,
      policy_decision: policyDecision,
      reasons: [
        {
          code: 'no_compatible_backend',
          message: explicitBackendId
            ? `Explicit backend '${explicitBackendId}' is not eligible`
            : 'No registered backend matched health + capability requirements',
        },
        ...candidates.flatMap((c) =>
          (c.reasons || []).map((r) => ({
            ...r,
            backend_id: c.backend_id,
          }))
        ),
      ],
      candidates,
      evidence: {
        stage: 'capability_match',
        task_id: taskId,
        policy_decision: policyDecision,
        requirements,
        requested_backend_id: explicitBackendId,
        candidate_count: candidates.length,
        eligible_count: 0,
      },
    });
  }

  // Deterministic selection: first eligible in registration order (list() is ordered).
  const selected = eligible[0];

  return createRouteDecision({
    status: 'ROUTED',
    task_id: taskId,
    backend_id: selected.backend_id,
    policy_decision: policyDecision,
    reasons: [
      {
        code: 'selected',
        message: explicitBackendId
          ? `Explicit backend '${selected.backend_id}' is eligible`
          : `Selected '${selected.backend_id}' by registration order among ${eligible.length} eligible`,
      },
    ],
    candidates,
    selection: {
      strategy: explicitBackendId ? 'explicit_backend_id' : 'registration_order',
      eligible_count: eligible.length,
      eligible_backend_ids: eligible.map((e) => e.backend_id),
      note:
        eligible.length > 1
          ? 'Multiple eligible backends; first by registration order selected (no scoring)'
          : null,
    },
    evidence: {
      stage: 'route',
      task_id: taskId,
      policy_decision: policyDecision,
      requirements,
      requested_backend_id: explicitBackendId,
      selected_backend_id: selected.backend_id,
      candidate_count: candidates.length,
      eligible_count: eligible.length,
      health: selected.health,
      can_handle: selected.can_handle,
    },
  });
}

/**
 * Prepare a runRequest draft from a successful RouteDecision.
 * Does NOT call backend.start().
 */
export function prepareRunRequestFromRoute(routeDecision, extras = {}) {
  if (!routeDecision || routeDecision.status !== 'ROUTED' || !routeDecision.backend_id) {
    return {
      ok: false,
      error: 'NOT_ROUTED',
      message: 'prepareRunRequestFromRoute requires status ROUTED',
    };
  }
  return {
    ok: true,
    draft: {
      task_id: routeDecision.task_id,
      backend_id: routeDecision.backend_id,
      policy_decision: routeDecision.policy_decision,
      objective: extras.objective || '',
      project_intelligence: extras.project_intelligence || null,
      verification_commands: extras.verification_commands || [],
      evidence_requirements: extras.evidence_requirements || [],
      allowed_paths: extras.allowed_paths || routeDecision.policy_decision?.allowed_paths,
      forbidden_paths: extras.forbidden_paths,
      approval_scopes: extras.approval_scopes,
      note: 'Draft only — caller must use createRunRequest; Router does not start',
    },
  };
}

export const RuntimeRouter = {
  route,
  createRouteDecision,
  extractRoutingRequirements,
  prepareRunRequestFromRoute,
  statuses: ROUTE_STATUSES,
  selection_strategy: 'registration_order',
};
