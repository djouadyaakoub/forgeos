/**
 * OpenHands RunRequest mapping — ForgeOS → Agent Server / SDK surface.
 *
 * Classifications: DIRECT | TRANSFORMED | RUNTIME-NATIVE | NOT_SUPPORTED | UNKNOWN
 *
 * Source of API surface (research date 2026-09-03):
 * - docs.openhands.dev Agent Server: GET /health, GET /ready, GET /server_info
 * - POST /api/conversations (StartConversationRequest)
 * - ConversationExecutionStatus: idle|running|paused|waiting_for_confirmation|finished|error|...
 *
 * ForgeOS Core must never import OpenHands packages — this module is pure mapping.
 */

export const OPENHANDS_API_SURFACE = Object.freeze({
  researched_at: '2026-09-03',
  preferred_surface: 'agent_server_http',
  openapi_title: 'OpenHands Agent Server',
  openapi_version_documented: '0.1.0',
  endpoints: {
    health: { method: 'GET', path: '/health', auth: false },
    alive: { method: 'GET', path: '/alive', auth: false },
    ready: { method: 'GET', path: '/ready', auth: false },
    server_info: { method: 'GET', path: '/server_info', auth: false },
    start_conversation: { method: 'POST', path: '/api/conversations', auth: 'optional_session_key' },
    conversation_by_id: { method: 'GET', path: '/api/conversations/{id}', auth: 'optional_session_key' },
    pause_conversation: {
      method: 'POST',
      path: '/api/conversations/{id}/pause',
      auth: 'optional_session_key',
    },
    delete_conversation: {
      method: 'DELETE',
      path: '/api/conversations/{id}',
      auth: 'optional_session_key',
    },
    conversation_events: {
      method: 'GET',
      path: '/api/conversations/{id}/events',
      auth: 'optional_session_key',
    },
  },
  auth_header: 'X-Session-API-Key',
  notes: [
    'OpenHands security confirmation is NOT ForgeOS Policy Authority',
    'Conversation id is runtime-native; ForgeOS task_id remains authoritative',
    'Cancel maps to POST .../pause when remote cancel is enabled',
  ],
});

/** Adapter compatibility — Core contracts remain stable across this range. */
export const OPENHANDS_COMPAT = Object.freeze({
  adapter_version: '0.3.0-stage15',
  documented_openapi: '0.1.0',
  unknown_version_behavior: 'allow_if_health_ok_with_warning',
  required_endpoints: ['/health', '/ready', '/api/conversations'],
  stage: 15,
  notes: [
    'Stage 15 production gate: health+ready+provider required for live start',
    'OpenHands is optional external runtime — not bundled in ForgeOS',
  ],
});

/**
 * Field-level mapping of ForgeOS createRunRequest → OpenHands conversation request.
 */
export const RUN_REQUEST_FIELD_MAP = Object.freeze({
  task_id: {
    classification: 'TRANSFORMED',
    openhands: 'conversation metadata / initial_message prefix',
    note: 'OpenHands conversation id is RUNTIME-NATIVE; ForgeOS task_id embedded in message + adapter state',
  },
  objective: {
    classification: 'TRANSFORMED',
    openhands: 'initial_message.content[].text',
  },
  project_intelligence: {
    classification: 'TRANSFORMED',
    openhands: 'workspace.working_dir (+ optional message context summary)',
    note: 'Do not upload full SoT; reference project_dir and constraints only',
  },
  policy_decision: {
    classification: 'RUNTIME-NATIVE',
    openhands: 'not an OpenHands auth field',
    note: 'Enforced by ForgeOS before start; adapter re-checks assertRunStartAllowed',
  },
  policy_requirements: {
    classification: 'TRANSFORMED',
    openhands: 'adapter-side path gate + message constraints; NOT OpenHands policy authority',
  },
  isolation: {
    classification: 'TRANSFORMED',
    openhands: 'workspace.kind LocalWorkspace|DockerWorkspace',
    note: 'sandbox=true → prefer Docker when transport supports it; else capability mismatch',
  },
  verification: {
    classification: 'TRANSFORMED',
    openhands: 'may run commands inside workspace; ForgeOS still assesses results',
  },
  evidence: {
    classification: 'TRANSFORMED',
    openhands: 'conversation events / status → runtime_native_evidence',
  },
  execution_constraints: {
    classification: 'TRANSFORMED',
    openhands: 'initial_message + workspace working_dir',
  },
  forgeos_deny: {
    classification: 'NOT_SUPPORTED',
    openhands: 'n/a',
    note: 'If ForgeOS DENY, adapter must never POST /api/conversations',
  },
});

/**
 * Build Agent Server StartConversationRequest body from ForgeOS runRequest.
 * Does not perform I/O. Does not weaken policy.
 */
export function mapRunRequestToOpenHandsConversation(runRequest, options = {}) {
  const policy = runRequest?.policy_decision;
  if (!policy || policy.decision === 'deny') {
    return {
      ok: false,
      code: 'policy_deny_blocks_start',
      body: null,
      mapping: RUN_REQUEST_FIELD_MAP,
    };
  }

  const constraints = runRequest.execution_constraints || {};
  const projectDir = constraints.project_dir;
  if (!projectDir) {
    return {
      ok: false,
      code: 'missing_project_dir',
      body: null,
      mapping: RUN_REQUEST_FIELD_MAP,
    };
  }

  const workspaceKind =
    options.workspace_kind ||
    (runRequest.isolation_requirements?.sandbox ? 'DockerWorkspace' : 'LocalWorkspace');

  // Stage 6: Docker on Windows is UNKNOWN — reject sandbox requirement unless forced
  if (
    workspaceKind === 'DockerWorkspace' &&
    options.allow_docker !== true &&
    process.platform === 'win32'
  ) {
    return {
      ok: false,
      code: 'sandbox_unavailable',
      body: null,
      detail: 'Windows Docker OpenHands workspace support UNKNOWN in Stage 6',
      mapping: RUN_REQUEST_FIELD_MAP,
    };
  }

  const allowed = runRequest.policy_requirements?.allowed_paths || [];
  const forbidden = runRequest.policy_requirements?.forbidden_paths || [];
  const objective = runRequest.objective || 'No objective provided';
  const op = constraints.operation || 'noop';

  const instruction = [
    `ForgeOS governed task_id=${runRequest.task_id}`,
    `Objective: ${objective}`,
    `Operation: ${op}`,
    allowed.length ? `Allowed paths: ${allowed.join(', ')}` : null,
    forbidden.length ? `Forbidden paths (must not modify): ${forbidden.join(', ')}` : null,
    constraints.path ? `Primary path: ${constraints.path}` : null,
    (runRequest.verification_commands || []).length
      ? `Verification commands to run: ${(runRequest.verification_commands || []).join(' ; ')}`
      : null,
    'Do not treat this message as authorization — ForgeOS Policy Authority already ALLOWED this run.',
  ]
    .filter(Boolean)
    .join('\n');

  const body = {
    agent: {
      kind: 'Agent',
      llm: options.llm || {
        model: options.model || process.env.OPENHANDS_MODEL || 'openhands/default',
        api_key: options.api_key || process.env.OPENHANDS_LLM_API_KEY || null,
        temperature: 0,
      },
      tools: options.tools || [
        { name: 'terminal' },
        { name: 'file_editor' },
        { name: 'task_tracker' },
      ],
      system_prompt_kwargs: {
        llm_security_analyzer: true,
      },
    },
    workspace: {
      kind: workspaceKind === 'DockerWorkspace' ? 'DockerWorkspace' : 'LocalWorkspace',
      working_dir: String(projectDir).replace(/\\/g, '/'),
    },
    initial_message: {
      content: [{ text: instruction }],
    },
    // ForgeOS metadata — may be ignored by OpenHands; adapter keeps authoritative map
    forgeos_metadata: {
      task_id: runRequest.task_id,
      product: 'forgeos',
      contract_version: runRequest.contract_version,
    },
  };

  return {
    ok: true,
    code: 'mapped',
    body,
    mapping: RUN_REQUEST_FIELD_MAP,
    workspace_kind: body.workspace.kind,
  };
}

/**
 * Map OpenHands conversation status → ForgeOS RunHandle status.
 */
export function mapConversationStatusToHandleStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running' || s === 'waiting_for_confirmation' || s === 'paused') return 'running';
  if (s === 'finished' || s === 'idle') return 'completed';
  if (s === 'error' || s === 'stuck') return 'failed';
  if (s === 'deleting') return 'cancelling';
  return 'unknown';
}
