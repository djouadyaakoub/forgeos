/**
 * ForgeOS OpenHands RuntimeBackend adapter — Architecture 2.0 Stages 6–7–15
 *
 * Shape:
 *   ForgeOS RuntimeBackend → OpenHands Adapter → Agent Server (HTTP) | probe
 *
 * Stage 15: production live gate (health → ready → provider → execution).
 *
 * Rules:
 * - Does NOT copy OpenHands source into ForgeOS
 * - Does NOT add OpenHands as a Core package dependency
 * - Does NOT become ForgeOS Policy Authority
 * - ForgeOS DENY → never POST /api/conversations
 * - Runtime success ≠ ForgeOS verification success
 * - No automatic fallback to Local Executor or Cursor
 *
 * Registration is OPT-IN. Core does not auto-register this backend.
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
} from '../../backend-interface.mjs';
import {
  mapRunRequestToOpenHandsConversation,
  mapConversationStatusToHandleStatus,
  OPENHANDS_API_SURFACE,
  OPENHANDS_COMPAT,
  RUN_REQUEST_FIELD_MAP,
} from './mapping.mjs';
import { createOpenHandsHttpClient } from './client.mjs';
import { classifyShellOperation } from '../../../policy/engine.mjs';
import { createOpenHandsProbeTransport } from './probe-transport.mjs';
import {
  redactSecrets,
  sanitizeConversationBody,
  sleepSync,
} from './http-sync.mjs';
import {
  assessOpenHandsEnvironment,
  assertOpenHandsLiveStartAllowed,
  isOpenHandsProviderConfigured,
} from './environment-gate.mjs';

export const OPENHANDS_BACKEND_ID = 'openhands';
export const OPENHANDS_ADAPTER_VERSION = OPENHANDS_COMPAT.adapter_version;

const RUNS = new Map();
const TERMINAL_STATUSES = new Set(['finished', 'idle', 'error', 'stuck', 'paused', 'deleting']);

export function clearOpenHandsRuns() {
  RUNS.clear();
}

function resolveTransport(options = {}) {
  if (options.transport === 'probe' || options.probe) {
    return options.probe || createOpenHandsProbeTransport(options.probeOptions || {});
  }
  if (options.transport === 'http' || options.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL) {
    return createOpenHandsHttpClient({
      baseUrl: options.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    });
  }
  return createOpenHandsProbeTransport(options.probeOptions || {});
}

function extractConversationId(conversation) {
  return (
    conversation?.id ||
    conversation?.conversation_id ||
    conversation?.conversationId ||
    null
  );
}

function buildEvidenceFromConversation(backendId, handle, conversation, transportKind, extra = {}) {
  if (conversation?.evidence_unavailable || extra.unavailable) {
    return createEvidenceBundle({
      run_id: handle.run_id,
      task_id: handle.task_id,
      backend_id: backendId,
      execution_status: 'unknown',
      unavailable: true,
      notes: redactSecrets(extra.notes || 'openhands evidence unavailable'),
    });
  }

  return createEvidenceBundle({
    run_id: handle.run_id,
    task_id: handle.task_id,
    backend_id: backendId,
    execution_status: handle.status === 'failed' ? 'failed' : handle.status === 'completed' ? 'completed' : 'running',
    changed_files: conversation?.changed_files || [],
    commands_executed: conversation?.commands_executed || [],
    verification_results: conversation?.verification_results || [],
    logs_refs: [`openhands:conversation:${handle.run_id}`],
    notes: redactSecrets(
      extra.notes ||
        `transport=${transportKind}; runtime session native to OpenHands; forgeos_task_id preserved in adapter state`
    ),
  });
}

/**
 * Create OpenHands RuntimeBackend.
 */
export function createOpenHandsBackend(overrides = {}) {
  const transport = resolveTransport(overrides);
  const transportKind = transport.kind === 'probe' ? 'probe' : 'http';
  const forcedHealth = overrides.healthStatus || null;
  const pollIntervalMs = overrides.pollIntervalMs ?? 250;
  const pollTimeoutMs = overrides.pollTimeoutMs ?? 60000;
  const enableRemoteCancel = overrides.enableRemoteCancel !== false;

  const capabilities = normalizeBackendCapabilities({
    // Declared only when actually verified by this adapter surface
    interactive: false,
    autonomous: true,
    sandbox: overrides.capabilities?.sandbox === true,
    parallel: false,
    pr_delivery: false,
    hooks_callback: false,
    cost_telemetry: false,
    languages: ['python', 'javascript', 'typescript', 'shell', 'text'],
    ...(overrides.capabilities || {}),
  });

  // Verified capability declaration for Stage 15 reporting (no doc-only claims)
  const verifiedCapabilities = Object.freeze({
    interactive: false,
    autonomous: capabilities.autonomous === true,
    parallel: false,
    pr_delivery: false,
    hooks_callback: false,
    cost_telemetry: false,
    languages: [...(capabilities.languages || [])],
    remote_cancel_pause: transportKind === 'http',
    note: 'Only adapter-verified capabilities; documentation-only features are not declared',
  });

  let lastHealthDetail = null;

  function probeHttpHealth() {
    if (!transport.baseUrl) {
      return createHealthResult('unavailable', {
        adapter: OPENHANDS_BACKEND_ID,
        transport: 'http',
        reason: 'OPENHANDS_AGENT_SERVER_URL unset',
      });
    }

    const healthRes = transport.healthSync
      ? transport.healthSync()
      : { ok: false, error: 'health_sync_missing' };
    if (!healthRes.ok) {
      const status =
        healthRes.error === 'missing_base_url' || healthRes.error === 'timeout'
          ? healthRes.error === 'missing_base_url'
            ? 'unavailable'
            : 'unhealthy'
          : 'unhealthy';
      return createHealthResult(status, {
        adapter: OPENHANDS_BACKEND_ID,
        transport: 'http',
        error: redactSecrets(healthRes.error),
        http_status: healthRes.status,
      });
    }

    // Readiness is optional but preferred
    let readyOk = true;
    if (typeof transport.readySync === 'function') {
      const readyRes = transport.readySync();
      if (!readyRes.ok) readyOk = false;
    }
    if (!readyOk) {
      return createHealthResult('unhealthy', {
        adapter: OPENHANDS_BACKEND_ID,
        transport: 'http',
        reason: 'ready_check_failed',
      });
    }

    let version = null;
    let versionWarning = null;
    if (typeof transport.serverInfoSync === 'function') {
      const info = transport.serverInfoSync();
      if (info.ok) {
        version = info.data?.version || info.data?.openapi || null;
        if (!version) {
          versionWarning = 'server_info_missing_version';
        }
      } else {
        versionWarning = 'server_info_unavailable';
      }
    }

    lastHealthDetail = {
      adapter: OPENHANDS_BACKEND_ID,
      transport: 'http',
      baseUrl: transport.baseUrl,
      version,
      versionWarning,
      compat: OPENHANDS_COMPAT,
      session_key_configured: typeof transport.hasSessionKey === 'function' ? transport.hasSessionKey() : false,
    };

    return createHealthResult('healthy', lastHealthDetail);
  }

  function waitForTerminal(conversationId, initial) {
    let conversation = initial;
    const deadline = Date.now() + pollTimeoutMs;
    while (
      conversation &&
      !TERMINAL_STATUSES.has(String(conversation.status || '').toLowerCase()) &&
      Date.now() < deadline
    ) {
      sleepSync(pollIntervalMs);
      if (typeof transport.getConversationSync !== 'function') break;
      const res = transport.getConversationSync(conversationId);
      if (!res.ok) {
        return {
          ok: false,
          conversation,
          error: redactSecrets(res.error || 'poll_failed'),
        };
      }
      conversation = res.data;
    }
    const status = String(conversation?.status || '').toLowerCase();
    if (!TERMINAL_STATUSES.has(status)) {
      return {
        ok: false,
        conversation,
        error: 'poll_timeout_non_terminal',
      };
    }
    return { ok: true, conversation, error: null };
  }

  const backend = {
    id: overrides.id || OPENHANDS_BACKEND_ID,
    name: overrides.name || 'OpenHands Agent Server Adapter',
    version: overrides.version || OPENHANDS_ADAPTER_VERSION,
    capabilities,
    _adapter: 'openhands',
    _transport: transportKind,
    _api_surface: OPENHANDS_API_SURFACE,
    _compat: OPENHANDS_COMPAT,
    _field_map: RUN_REQUEST_FIELD_MAP,
    _verified_capabilities: verifiedCapabilities,
    _production_ready:
      transportKind === 'http' && Boolean(overrides.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL),
    _remote_cancel: transportKind === 'http' ? 'pause' : 'local_handle_only',
    _claims_policy_authority: false,
    _classification: 'optional_runtime',
    _product_path: 'optional_runtime_not_core',
    _core_required: false,
    _note:
      'OpenHands OPTIONAL RuntimeBackend Stage 15/17 — not ForgeOS Core; not host-native; not Policy Authority; no automatic fallback',

    assessEnvironment() {
      if (transportKind !== 'http') {
        return {
          schema: 'forgeos-openhands-live-gate',
          status: 'BLOCKED',
          reason: 'probe_transport_not_live',
          live_capable: false,
          installation: 'external_optional_runtime',
          bundled_in_forgeos: false,
          adapter_version: OPENHANDS_COMPAT.adapter_version,
        };
      }
      return assessOpenHandsEnvironment({
        baseUrl: overrides.baseUrl || transport.baseUrl,
        apiKey: overrides.apiKey,
        model: overrides.model,
        llm: overrides.llm,
        llm_api_key: overrides.llm_api_key,
        provider_configured: overrides.provider_configured,
        timeoutMs: overrides.timeoutMs,
      });
    },

    health() {
      if (forcedHealth) {
        return createHealthResult(forcedHealth, {
          adapter: OPENHANDS_BACKEND_ID,
          transport: transportKind,
        });
      }
      if (transportKind === 'probe') {
        if (typeof transport.healthSync === 'function') {
          const res = transport.healthSync();
          if (!res.ok) {
            return createHealthResult(
              res.error === 'unavailable' ? 'unavailable' : 'unhealthy',
              { adapter: OPENHANDS_BACKEND_ID, transport: 'probe', error: res.error }
            );
          }
        }
        return createHealthResult('healthy', {
          adapter: OPENHANDS_BACKEND_ID,
          transport: 'probe',
          version: transport.version || OPENHANDS_ADAPTER_VERSION,
          note: 'probe transport — not a live OpenHands server',
          provider_configured: isOpenHandsProviderConfigured(overrides),
          live_capable: false,
        });
      }
      const result = probeHttpHealth();
      const env = this.assessEnvironment();
      lastHealthDetail = {
        ...(result.detail || {}),
        ...(lastHealthDetail || {}),
        provider_configured: env.provider_configured,
        live_capable: env.live_capable,
        live_gate_status: env.status,
        live_gate_reason: env.reason,
      };
      return createHealthResult(result.status, lastHealthDetail);
    },

    async healthAsync() {
      return this.health();
    },

    canHandle(task, projectIntelligence = null, policyRequirements = {}) {
      const reasons = [];
      const health = this.health();
      if (health.status === 'unavailable') {
        return createCanHandleResult(false, [
          { code: 'backend_unavailable', message: 'openhands unavailable' },
        ]);
      }
      if (health.status === 'unhealthy') {
        return createCanHandleResult(false, [
          { code: 'backend_unhealthy', message: 'openhands unhealthy' },
        ]);
      }
      if (health.status === 'unknown') {
        return createCanHandleResult(false, [
          { code: 'backend_unavailable', message: 'openhands health unknown — not selectable' },
        ]);
      }

      const reqs = {
        ...(policyRequirements || {}),
        ...(task?.requirements || {}),
        ...(task?.operation_requirements || {}),
      };

      // Policy DENY context must never be treated as handleable authorization
      const decision = policyRequirements?.policy_decision
        || policyRequirements?.permission
        || task?.policy_decision?.decision
        || task?.policy_decision;
      if (decision === 'deny') {
        return createCanHandleResult(false, [
          { code: 'policy_deny', message: 'ForgeOS DENY — OpenHands cannot authorize or start' },
        ]);
      }

      if (reqs.interactive === true) {
        return createCanHandleResult(false, [
          { code: 'interactive_unsupported', message: 'openhands adapter is non-interactive' },
        ]);
      }
      if (reqs.sandbox === true && !this.capabilities.sandbox) {
        return createCanHandleResult(false, [
          {
            code: 'sandbox_unavailable',
            message: 'sandbox required but openhands adapter sandbox capability not enabled',
          },
        ]);
      }

      // Operation compatibility — optional_runtime / legacy oss_backed only
      const opTypes = task?.operation?.implementation_types
        || task?.capability_operation?.implementation_types
        || null;
      if (Array.isArray(opTypes) && opTypes.length) {
        const optionalOk = opTypes.some((t) => t === 'oss_backed' || t === 'optional_runtime');
        if (!optionalOk) {
          return createCanHandleResult(false, [
            {
              code: 'operation_not_oss_backed',
              message: 'operation implementation_types exclude optional_runtime/oss_backed',
            },
          ]);
        }
      }

      if (projectIntelligence?.project_dir && task?.execution_constraints?.project_dir) {
        const a = String(projectIntelligence.project_dir).replace(/\\/g, '/');
        const b = String(task.execution_constraints.project_dir).replace(/\\/g, '/');
        if (a && b && a !== b) {
          reasons.push({
            code: 'project_dir_mismatch',
            message: 'task project_dir does not match project intelligence scope',
          });
        }
      }

      const matched = matchBackendCapabilities(this.capabilities, reqs);
      if (!matched.match) return matched;
      if (reasons.length) {
        return createCanHandleResult(false, reasons);
      }
      return createCanHandleResult(true, [
        { code: 'openhands_capable', message: 'openhands can handle (does not authorize or start)' },
      ]);
    },

    start(runRequest) {
      const gate = assertRunStartAllowed(runRequest);
      if (!gate.ok) {
        return { kind: 'policy', policy_decision: gate.policy_decision, handle: null };
      }
      // No trusted exact tool-dispatch callback exists here. Never export a recognized
      // Tier-3 command to the external conversation, even with a precomputed ALLOW.
      if ([...(runRequest.execution_constraints?.commands || []), ...(runRequest.verification_commands || [])]
        .some(c => classifyShellOperation(c)?.tier >= 3)) {
        return {kind:'policy',handle:null,policy_decision:{authority:'forgeos',permission:'deny',decision:'deny',
          reason:'tier3_backend_dispatch_unsupported'}};
      }

      // Production HTTP: refuse start when health is not healthy
      if (transportKind === 'http') {
        const health = this.health();
        if (health.status !== 'healthy') {
          return {
            kind: 'error',
            error: createRuntimeError(
              health.status === 'unavailable' ? 'RUNTIME_UNAVAILABLE' : 'RUNTIME_UNHEALTHY',
              redactSecrets(`openhands health is ${health.status}`),
              redactSecrets(health.detail || {})
            ),
            handle: null,
          };
        }

        // Stage 15: optional live provider enforcement (live proof / production callers)
        if (overrides.require_live_provider === true) {
          const live = assertOpenHandsLiveStartAllowed({
            baseUrl: overrides.baseUrl || transport.baseUrl,
            apiKey: overrides.apiKey,
            model: overrides.model,
            llm: overrides.llm,
            llm_api_key: overrides.llm_api_key,
            provider_configured: overrides.provider_configured,
          });
          if (!live.ok) {
            return {
              kind: 'error',
              error: createRuntimeError(
                'PROVIDER_NOT_CONFIGURED',
                redactSecrets(live.reason || 'provider_not_configured'),
                {
                  live_gate_status: live.gate?.status,
                  note: 'Health/ready alone are insufficient for Stage 15 live execution',
                }
              ),
              handle: null,
            };
          }
        }
      }

      const mapped = mapRunRequestToOpenHandsConversation(runRequest, {
        allow_docker: overrides.allow_docker === true,
        workspace_kind: overrides.workspace_kind,
        llm: overrides.llm,
        model: overrides.model,
        api_key: overrides.llm_api_key,
        tools: overrides.tools,
      });

      if (!mapped.ok) {
        return {
          kind: 'error',
          error: createRuntimeError(
            mapped.code === 'sandbox_unavailable' ? 'UNSUPPORTED_REQUEST' : 'START_FAILED',
            redactSecrets(mapped.detail || mapped.code),
            { mapping_code: mapped.code }
          ),
          handle: null,
        };
      }

      const startSync = startConversationSync(transport, mapped.body, transportKind);
      if (!startSync.ok) {
        return {
          kind: 'error',
          error: createRuntimeError(
            'START_FAILED',
            redactSecrets(startSync.error || 'openhands start failed'),
            redactSecrets({
              http_status: startSync.status,
              data: startSync.data,
            })
          ),
          handle: null,
        };
      }

      let conversation = startSync.data;
      const conversationId = extractConversationId(conversation);
      if (!conversationId) {
        return {
          kind: 'error',
          error: createRuntimeError('START_FAILED', 'openhands response missing conversation id'),
          handle: null,
        };
      }

      // Poll until terminal when HTTP returns non-terminal status
      if (
        transportKind === 'http' &&
        !TERMINAL_STATUSES.has(String(conversation.status || '').toLowerCase())
      ) {
        const waited = waitForTerminal(conversationId, conversation);
        if (!waited.ok && waited.error === 'poll_timeout_non_terminal') {
          const handle = createRunHandle({
            run_id: conversationId,
            task_id: runRequest.task_id,
            backend_id: this.id,
            status: 'running',
            started_at: new Date().toISOString(),
          });
          return {
            kind: 'error',
            error: createRuntimeError('START_FAILED', 'openhands conversation did not reach terminal status', {
              conversation_id: conversationId,
            }),
            handle,
            evidence: buildEvidenceFromConversation(this.id, handle, waited.conversation, transportKind, {
              notes: 'poll timeout',
            }),
          };
        }
        if (!waited.ok) {
          return {
            kind: 'error',
            error: createRuntimeError('START_FAILED', redactSecrets(waited.error || 'poll_failed')),
            handle: null,
          };
        }
        conversation = waited.conversation;
      }

      const handleStatus = mapConversationStatusToHandleStatus(conversation.status);
      const startedAt = new Date().toISOString();
      const handle = createRunHandle({
        run_id: conversationId,
        task_id: runRequest.task_id,
        backend_id: this.id,
        status: handleStatus === 'failed' ? 'failed' : handleStatus === 'completed' ? 'completed' : 'running',
        started_at: startedAt,
        updated_at: startedAt,
      });

      const evidence = buildEvidenceFromConversation(this.id, handle, conversation, transportKind);

      RUNS.set(handle.run_id, {
        handle,
        runRequest: {
          task_id: runRequest.task_id,
          objective: runRequest.objective,
          execution_id: runRequest.execution_constraints?.execution_id || null,
        },
        request_body_sanitized: sanitizeConversationBody(mapped.body),
        conversation: redactSecrets(conversation),
        evidence,
        transport: transportKind,
      });

      if (handle.status === 'failed') {
        return {
          kind: 'ok',
          handle,
          evidence,
          error: createRuntimeError(
            'START_FAILED',
            redactSecrets(conversation.error || 'openhands conversation error')
          ),
        };
      }

      return { kind: 'ok', handle, evidence, error: null };
    },

    cancel(runHandle, taskId) {
      const stored = RUNS.get(runHandle?.run_id);
      if (!stored) {
        return createCancelResult({
          ok: false,
          run_id: runHandle?.run_id,
          task_id: taskId,
          backend_id: this.id,
          status: 'unknown',
          error: createRuntimeError('CANCEL_FAILED', 'unknown run'),
        });
      }
      if (stored.handle.task_id !== taskId) {
        return createCancelResult({
          ok: false,
          run_id: runHandle.run_id,
          task_id: taskId,
          backend_id: this.id,
          status: 'unknown',
          error: createRuntimeError('TASK_MISMATCH', 'task isolation violation'),
        });
      }

      let remote = null;
      if (transportKind === 'http' && enableRemoteCancel && typeof transport.pauseConversationSync === 'function') {
        remote = transport.pauseConversationSync(runHandle.run_id);
        if (!remote.ok) {
          return createCancelResult({
            ok: false,
            run_id: runHandle.run_id,
            task_id: taskId,
            backend_id: this.id,
            status: 'unknown',
            error: createRuntimeError(
              'CANCEL_FAILED',
              redactSecrets(remote.error || 'remote pause failed'),
              { http_status: remote.status }
            ),
          });
        }
      }

      const cancelled = createRunHandle({
        ...stored.handle,
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      });
      stored.handle = cancelled;
      stored.remote_cancel = remote
        ? { ok: true, method: 'pause' }
        : { ok: true, method: 'local_handle_only' };

      return createCancelResult({
        ok: true,
        run_id: cancelled.run_id,
        task_id: cancelled.task_id,
        backend_id: this.id,
        status: 'cancelled',
      });
    },

    collectEvidence(runHandle) {
      const stored = RUNS.get(runHandle?.run_id);
      if (!stored) {
        return createEvidenceBundle({
          run_id: runHandle?.run_id,
          task_id: runHandle?.task_id,
          backend_id: this.id,
          unavailable: true,
          notes: 'no stored openhands run',
        });
      }

      // Optionally refresh from server
      if (transportKind === 'http' && typeof transport.getConversationSync === 'function') {
        const res = transport.getConversationSync(runHandle.run_id);
        if (res.ok && res.data) {
          stored.conversation = redactSecrets(res.data);
          stored.evidence = buildEvidenceFromConversation(
            this.id,
            stored.handle,
            res.data,
            transportKind
          );
        }
      }

      return stored.evidence;
    },

    _getTransport() {
      return transport;
    },
    _getLastHealthDetail() {
      return lastHealthDetail;
    },
  };

  const validation = validateRuntimeBackend(backend);
  if (!validation.valid) {
    throw new Error(`OpenHands backend contract invalid: ${validation.issues.join(',')}`);
  }
  return backend;
}

function startConversationSync(transport, body, transportKind) {
  if (typeof transport.startConversationSync === 'function') {
    return transport.startConversationSync(body);
  }
  return {
    ok: false,
    status: 0,
    data: null,
    error:
      transportKind === 'http'
        ? 'http_sync_start_missing'
        : 'start_unsupported',
  };
}

export {
  OPENHANDS_API_SURFACE,
  OPENHANDS_COMPAT,
  RUN_REQUEST_FIELD_MAP,
  mapRunRequestToOpenHandsConversation,
  redactSecrets,
  sanitizeConversationBody,
};
export { createOpenHandsProbeTransport } from './probe-transport.mjs';
export { createOpenHandsHttpClient } from './client.mjs';
export { createMockOpenHandsAgentServer } from './mock-agent-server.mjs';
export {
  assessOpenHandsEnvironment,
  assertOpenHandsLiveStartAllowed,
  isOpenHandsProviderConfigured,
  isOpenHandsServerConfigured,
} from './environment-gate.mjs';
export { runOpenHandsLiveProof } from './live-proof.mjs';
export { runStage16LiveGate, LIVE_CLASSIFICATIONS } from './stage16-live-gate.mjs';
