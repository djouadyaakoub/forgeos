/**
 * Local mock OpenHands Agent Server for Stage 7 HTTP-path tests.
 * Implements a subset of documented endpoints — NOT the real OpenHands product.
 *
 * Used when OPENHANDS_AGENT_SERVER_URL is unset so Stage 7 can prove HTTP
 * transport against a real TCP server without claiming live OpenHands PASS.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './http-sync.mjs';

function normalizeRel(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

const HARD_FORBIDDEN = ['.cursor/', '.agent-os/', 'policy/', 'docs/agents/'];

function isHardForbidden(rel) {
  const p = normalizeRel(rel);
  return HARD_FORBIDDEN.some((pref) => p === pref.replace(/\/$/, '') || p.startsWith(pref));
}

/**
 * @param {object} [options]
 * @param {'success'|'start_failed'|'execution_failed'|'evidence_unavailable'|'verification_fail'|'unavailable_after'} [options.behavior]
 * @param {string} [options.sessionKey] — if set, require X-Session-API-Key
 * @param {string} [options.version]
 */
export function createMockOpenHandsAgentServer(options = {}) {
  const behavior = options.behavior || 'success';
  const sessionKey = options.sessionKey || null;
  const version = options.version || 'mock-agent-server-0.1.0';
  const conversations = new Map();
  let postConversations = 0;
  let requestLog = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }

      // Never retain raw API keys in request log
      requestLog.push({
        method: req.method,
        path: url.pathname,
        hasAuth: Boolean(req.headers['x-session-api-key']),
        body: redactSecrets(body),
      });

      const send = (status, data, asText = false) => {
        const payload = asText ? String(data) : JSON.stringify(data);
        res.writeHead(status, {
          'Content-Type': asText ? 'text/plain' : 'application/json',
        });
        res.end(payload);
      };

      if (sessionKey) {
        const got = req.headers['x-session-api-key'];
        if (url.pathname.startsWith('/api/') && got !== sessionKey) {
          return send(401, { detail: 'unauthorized' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/__forgeos_mock/stats') {
        return send(200, {
          postConversations,
          requests: requestLog.length,
        });
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, 'OK', true);
      }
      if (req.method === 'GET' && url.pathname === '/alive') {
        return send(200, { alive: true });
      }
      if (req.method === 'GET' && url.pathname === '/ready') {
        return send(200, { ready: true });
      }
      if (req.method === 'GET' && url.pathname === '/server_info') {
        return send(200, {
          version,
          title: 'OpenHands Agent Server (ForgeOS Mock)',
          uptime_s: 1,
          mock: true,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/conversations') {
        postConversations += 1;
        if (behavior === 'start_failed') {
          return send(500, { detail: 'mock start failed' });
        }

        const id = `00000000-0000-4000-8000-${String(postConversations).padStart(12, '0')}`;
        const workingDir = body?.workspace?.working_dir;
        const text = body?.initial_message?.content?.[0]?.text || '';
        const meta = body?.forgeos_metadata || {};
        const changed = [];
        const verificationResults = [];
        const commandsExecuted = [];
        let status = 'finished';
        let error = null;

        try {
          if (!workingDir || !fs.existsSync(workingDir)) {
            throw new Error(`workspace missing: ${workingDir}`);
          }
          const pathMatch = text.match(/Primary path:\s*(\S+)/);
          const opMatch = text.match(/Operation:\s*(\S+)/);
          const op = opMatch?.[1] || 'noop';
          const rel = pathMatch?.[1];
          if (op === 'write_file' && rel) {
            const safeRel = normalizeRel(rel);
            if (isHardForbidden(safeRel)) throw new Error(`hard-forbidden: ${safeRel}`);
            const abs = path.resolve(workingDir, safeRel);
            const rooted = path.resolve(workingDir);
            const relative = path.relative(rooted, abs);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
              throw new Error(`path escape: ${safeRel}`);
            }
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, `mock-openhands:${meta.task_id || id}\n`, 'utf8');
            changed.push(safeRel);
          }
          const verifyMatch = text.match(/Verification commands to run:\s*([^\n]+)/);
          if (verifyMatch) {
            for (const cmd of verifyMatch[1].split(';').map((s) => s.trim()).filter(Boolean)) {
              const passed = behavior !== 'verification_fail';
              const row = { command: cmd, exit_code: passed ? 0 : 1, passed };
              commandsExecuted.push(row);
              verificationResults.push(row);
            }
          }
          if (behavior === 'execution_failed') {
            status = 'error';
            error = 'mock execution failed';
          }
        } catch (err) {
          status = 'error';
          error = String(err.message || err);
        }

        const conversation = {
          id,
          status,
          forgeos_task_id: meta.task_id || null,
          changed_files: changed,
          commands_executed: commandsExecuted,
          verification_results: verificationResults,
          error,
          working_dir: workingDir,
          evidence_unavailable: behavior === 'evidence_unavailable',
        };
        conversations.set(id, conversation);
        if (status === 'error' && behavior !== 'execution_failed') {
          return send(500, conversation);
        }
        return send(200, conversation);
      }

      const convMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (req.method === 'GET' && convMatch) {
        const c = conversations.get(convMatch[1]);
        if (!c) return send(404, { detail: 'not found' });
        return send(200, c);
      }

      const pauseMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/pause$/);
      if (req.method === 'POST' && pauseMatch) {
        const c = conversations.get(pauseMatch[1]);
        if (!c) return send(404, { detail: 'not found' });
        c.status = 'paused';
        return send(200, { success: true });
      }

      const eventsMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
      if (req.method === 'GET' && eventsMatch) {
        const c = conversations.get(eventsMatch[1]);
        if (!c) return send(404, { detail: 'not found' });
        return send(200, {
          items: [
            { type: 'status', status: c.status },
            ...(c.changed_files || []).map((f) => ({ type: 'file', path: f })),
          ],
        });
      }

      send(404, { detail: `mock unmatched ${req.method} ${url.pathname}` });
    });
  });

  return {
    server,
    async listen(port = 0) {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      const addr = server.address();
      return {
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
      };
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    getPostCount() {
      return postConversations;
    },
    getRequestLog() {
      return requestLog;
    },
    reset() {
      postConversations = 0;
      requestLog = [];
      conversations.clear();
    },
  };
}
