/**
 * Synchronous HTTP helper for OpenHands Agent Server.
 * Keeps RuntimeBackend.start()/health() synchronous without Core redesign.
 *
 * Implementation: spawn a short-lived Node child that performs fetch and
 * returns JSON on stdout. Request payload is passed via stdin (not argv).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /authorization/i,
  /x-session-api-key/i,
  /bearer\s+[a-z0-9._\-]+/i,
  /sk-[a-z0-9]+/i,
];

export function redactSecrets(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    let out = value;
    out = out.replace(/(api[_-]?key["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, '$1***REDACTED***');
    out = out.replace(/(X-Session-API-Key["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, '$1***REDACTED***');
    out = out.replace(/(Bearer\s+)([A-Za-z0-9._\-]+)/gi, '$1***REDACTED***');
    out = out.replace(/\bsk-[A-Za-z0-9]{8,}\b/g, '***REDACTED***');
    out = out.replace(
      /(OPENHANDS_(?:SESSION_API_KEY|LLM_API_KEY)|OH_SESSION_API_KEYS_\d+)\s*=\s*\S+/gi,
      '$1=***REDACTED***'
    );
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_PATTERNS.some((re) => re.test(k))) {
        out[k] = v == null || v === '' ? v : '***REDACTED***';
      } else {
        out[k] = redactSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeConversationBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clone = JSON.parse(JSON.stringify(body));
  if (clone.agent?.llm?.api_key != null) clone.agent.llm.api_key = '***REDACTED***';
  if (clone.agent?.llm?.apiKey != null) clone.agent.llm.apiKey = '***REDACTED***';
  return clone;
}

/**
 * Perform an HTTP request synchronously via temp files + child process.
 * Avoids fragile stdin EOF issues on Windows.
 */
export function httpRequestSync(input = {}) {
  const url = String(input.url || '');
  if (!url) {
    return { ok: false, status: 0, data: null, error: 'missing_url' };
  }

  const timeoutMs = Number(input.timeoutMs || 15000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-oh-http-'));
  const reqPath = path.join(dir, 'req.json');
  const resPath = path.join(dir, 'res.json');
  const scriptPath = path.join(dir, 'fetch.mjs');

  const payload = {
    url,
    method: String(input.method || 'GET').toUpperCase(),
    headers: input.headers || {},
    body: input.body === undefined ? null : input.body,
    timeoutMs,
    resPath,
  };

  const script = `
import fs from 'node:fs';
const req = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), req.timeoutMs || 15000);
try {
  const init = { method: req.method || 'GET', headers: req.headers || {}, signal: ctrl.signal };
  if (req.body != null) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const res = await fetch(req.url, init);
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  fs.writeFileSync(req.resPath, JSON.stringify({
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : ('http_' + res.status),
  }));
} catch (e) {
  const msg = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
  fs.writeFileSync(req.resPath, JSON.stringify({ ok:false, status:0, data:null, error: msg }));
} finally {
  clearTimeout(timer);
}
`;

  try {
    fs.writeFileSync(reqPath, JSON.stringify(payload));
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath, reqPath], {
      encoding: 'utf8',
      timeout: timeoutMs + 10000,
      windowsHide: true,
      env: process.env,
    });

    if (result.error) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: redactSecrets(String(result.error.message || result.error)),
      };
    }

    if (!fs.existsSync(resPath)) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: redactSecrets(
          `no_response_file exit=${result.status} stderr=${String(result.stderr || '').slice(0, 400)}`
        ),
      };
    }

    const parsed = JSON.parse(fs.readFileSync(resPath, 'utf8'));
    return {
      ok: Boolean(parsed.ok),
      status: Number(parsed.status || 0),
      data: redactSecrets(parsed.data),
      error: parsed.error ? redactSecrets(String(parsed.error)) : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: redactSecrets(String(err.message || err)),
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function sleepSync(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n <= 0) return;
  const end = Date.now() + n;
  // Portable busy-wait with occasional yield via spawnSync sleep of 0 avoided —
  // use Atomics.wait when SharedArrayBuffer is available.
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    while (Date.now() < end) {
      const remain = end - Date.now();
      if (remain <= 0) break;
      Atomics.wait(ia, 0, 0, Math.min(remain, 50));
    }
  } catch {
    const start = Date.now();
    while (Date.now() - start < n) {
      /* spin */
    }
  }
}
