/**
 * OpenHands environment / live-capability gate — Stage 15
 *
 * HEALTH → READY → PROVIDER CONFIGURED → (optional) MINIMAL EXECUTION
 *
 * Never prints or returns secret values.
 * OpenHands remains an optional external runtime — not bundled.
 */
import { createOpenHandsHttpClient } from './client.mjs';
import { OPENHANDS_COMPAT, OPENHANDS_API_SURFACE } from './mapping.mjs';

export const LIVE_GATE_SCHEMA = 'forgeos-openhands-live-gate';

function hasNonEmptyEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Provider configured means ForgeOS can supply LLM fields for Agent Server starts.
 * Does not validate that the key works — only that configuration is present.
 */
export function isOpenHandsProviderConfigured(options = {}) {
  if (options.provider_configured === true) return true;
  if (options.llm?.api_key || options.api_key || options.llm_api_key) return true;
  if (hasNonEmptyEnv('OPENHANDS_LLM_API_KEY')) return true;
  // Explicit model alone is insufficient without a key for Stage 15 live gate
  return false;
}

export function isOpenHandsServerConfigured(options = {}) {
  if (options.baseUrl) return true;
  return hasNonEmptyEnv('OPENHANDS_AGENT_SERVER_URL');
}

/**
 * Assess OpenHands environment without performing a mutating conversation.
 */
export function assessOpenHandsEnvironment(options = {}) {
  const urlConfigured = isOpenHandsServerConfigured(options);
  const providerConfigured = isOpenHandsProviderConfigured(options);
  const baseUrl = options.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL || null;

  const report = {
    schema: LIVE_GATE_SCHEMA,
    schema_version: 1,
    assessed_at: new Date().toISOString(),
    installation: 'external_optional_runtime',
    bundled_in_forgeos: false,
    adapter_version: OPENHANDS_COMPAT.adapter_version,
    api_surface: OPENHANDS_API_SURFACE.preferred_surface,
    agent_server_url_configured: urlConfigured,
    agent_server_url_present: Boolean(baseUrl),
    // Never echo the URL host secrets; only whether configured
    session_key_configured: hasNonEmptyEnv('OPENHANDS_SESSION_API_KEY')
      || hasNonEmptyEnv('OH_SESSION_API_KEYS_0')
      || Boolean(options.apiKey),
    provider_configured: providerConfigured,
    model_env_configured: hasNonEmptyEnv('OPENHANDS_MODEL') || Boolean(options.model),
    health: null,
    ready: null,
    server_info: null,
    openhands_version: null,
    network_accessible: false,
    workspace_boundary: {
      kind: 'LocalWorkspace_working_dir',
      note: 'Adapter maps ForgeOS project_dir to workspace.working_dir; ForgeOS Policy still enforces allowed/forbidden paths before start',
    },
    live_capable: false,
    status: 'BLOCKED',
    reason: null,
    gate_chain: {
      health: 'pending',
      ready: 'pending',
      provider_configured: providerConfigured ? 'pass' : 'fail',
      minimal_execution: 'not_run',
    },
  };

  if (!urlConfigured) {
    report.reason = 'agent_server_url_unset';
    report.gate_chain.health = 'fail';
    report.gate_chain.ready = 'fail';
    return report;
  }

  if (!providerConfigured) {
    // Still probe health/ready for diagnostics — live remains blocked
    report.reason = 'provider_not_configured';
  }

  try {
    const client = createOpenHandsHttpClient({
      baseUrl,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs || 5000,
    });

    const healthRes = client.healthSync();
    report.health = {
      ok: healthRes.ok === true,
      http_status: healthRes.status || null,
      error: healthRes.ok ? null : String(healthRes.error || 'health_failed'),
    };
    report.gate_chain.health = healthRes.ok ? 'pass' : 'fail';
    report.network_accessible = healthRes.ok === true;

    const readyRes = typeof client.readySync === 'function' ? client.readySync() : { ok: false };
    report.ready = {
      ok: readyRes.ok === true,
      http_status: readyRes.status || null,
      error: readyRes.ok ? null : String(readyRes.error || 'ready_failed'),
    };
    report.gate_chain.ready = readyRes.ok ? 'pass' : 'fail';

    if (typeof client.serverInfoSync === 'function') {
      const info = client.serverInfoSync();
      if (info.ok) {
        report.server_info = {
          ok: true,
          title: info.data?.title || null,
          // version only — no secrets
          version: info.data?.version || info.data?.openapi || null,
        };
        report.openhands_version = report.server_info.version;
      } else {
        report.server_info = { ok: false, error: String(info.error || 'server_info_failed') };
      }
    }
  } catch (err) {
    report.health = { ok: false, error: 'probe_exception' };
    report.ready = { ok: false, error: 'probe_exception' };
    report.gate_chain.health = 'fail';
    report.gate_chain.ready = 'fail';
    report.reason = report.reason || 'agent_server_unreachable';
    return report;
  }

  if (report.gate_chain.health !== 'pass') {
    report.reason = report.reason || 'health_failed';
    report.status = 'BLOCKED';
    return report;
  }
  if (report.gate_chain.ready !== 'pass') {
    report.reason = report.reason || 'ready_failed';
    report.status = 'BLOCKED';
    return report;
  }
  if (!providerConfigured) {
    report.reason = 'provider_not_configured';
    report.status = 'BLOCKED';
    report.live_capable = false;
    return report;
  }

  report.live_capable = true;
  report.status = 'READY';
  report.reason = null;
  return report;
}

/**
 * Decide whether start() may attempt a live HTTP conversation.
 */
export function assertOpenHandsLiveStartAllowed(options = {}) {
  const gate = options.environment || assessOpenHandsEnvironment(options);
  if (gate.live_capable && gate.status === 'READY') {
    return { ok: true, reason: null, gate };
  }
  return {
    ok: false,
    reason: gate.reason || 'live_gate_blocked',
    gate,
  };
}
