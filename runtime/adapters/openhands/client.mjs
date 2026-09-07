/**
 * OpenHands Agent Server HTTP client (async + sync).
 * No OpenHands SDK dependency — Node fetch / http-sync only.
 *
 * Secrets: API keys are never logged; responses/errors are redacted.
 */
import { OPENHANDS_API_SURFACE } from './mapping.mjs';
import { httpRequestSync, redactSecrets, sanitizeConversationBody } from './http-sync.mjs';

function joinUrl(base, pathPart) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return `${b}${p}`;
}

export function createOpenHandsHttpClient(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL || '').replace(
    /\/+$/,
    ''
  );
  const apiKey =
    options.apiKey ||
    process.env.OPENHANDS_SESSION_API_KEY ||
    process.env.OH_SESSION_API_KEYS_0 ||
    null;
  const timeoutMs = options.timeoutMs || 30000;
  let postCount = 0;

  function headers(extra = {}) {
    const h = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extra,
    };
    if (apiKey) h['X-Session-API-Key'] = apiKey;
    return h;
  }

  function requestSync(method, pathPart, body = undefined) {
    if (!baseUrl) {
      return { ok: false, status: 0, error: 'missing_base_url', data: null };
    }
    if (method === 'POST' && pathPart.includes('/api/conversations') && !pathPart.includes('/pause')) {
      postCount += 1;
    }
    const res = httpRequestSync({
      url: joinUrl(baseUrl, pathPart),
      method,
      headers: headers(),
      body: body === undefined ? null : body,
      timeoutMs,
    });
    return {
      ok: res.ok,
      status: res.status,
      data: redactSecrets(res.data),
      error: res.error ? redactSecrets(res.error) : null,
    };
  }

  async function request(method, pathPart, body = undefined) {
    // Prefer sync bridge for consistency with RuntimeBackend.start; async wraps sync.
    return requestSync(method, pathPart, body);
  }

  return {
    kind: 'http',
    baseUrl,
    apiSurface: OPENHANDS_API_SURFACE,
    getPostCount() {
      return postCount;
    },
    resetPostCount() {
      postCount = 0;
    },
    /** True when session key is configured (value never exposed). */
    hasSessionKey() {
      return Boolean(apiKey);
    },

    healthSync() {
      return requestSync('GET', OPENHANDS_API_SURFACE.endpoints.health.path);
    },
    readySync() {
      return requestSync('GET', OPENHANDS_API_SURFACE.endpoints.ready.path);
    },
    serverInfoSync() {
      return requestSync('GET', OPENHANDS_API_SURFACE.endpoints.server_info.path);
    },
    startConversationSync(body) {
      const safeBody = body; // send real credentials to server; never store unredacted later
      return requestSync(
        'POST',
        OPENHANDS_API_SURFACE.endpoints.start_conversation.path,
        safeBody
      );
    },
    getConversationSync(id) {
      return requestSync('GET', `/api/conversations/${encodeURIComponent(id)}`);
    },
    pauseConversationSync(id) {
      return requestSync('POST', `/api/conversations/${encodeURIComponent(id)}/pause`);
    },
    deleteConversationSync(id) {
      return requestSync('DELETE', `/api/conversations/${encodeURIComponent(id)}`);
    },
    getEventsSync(id) {
      return requestSync('GET', `/api/conversations/${encodeURIComponent(id)}/events`);
    },

    async health() {
      return this.healthSync();
    },
    async ready() {
      return this.readySync();
    },
    async serverInfo() {
      return this.serverInfoSync();
    },
    async startConversation(body) {
      return this.startConversationSync(body);
    },
    async getConversation(id) {
      return this.getConversationSync(id);
    },
    async pauseConversation(id) {
      return this.pauseConversationSync(id);
    },

    sanitizeForStorage: sanitizeConversationBody,
    redact: redactSecrets,
  };
}
