/**
 * Contract-probe transport for OpenHands adapter tests / Stage 6 spike.
 *
 * Simulates Agent Server HTTP responses WITHOUT installing OpenHands.
 * Exposes sync methods for RuntimeBackend.start (which is synchronous).
 *
 * This is NOT a production OpenHands integration and MUST NOT mutate the
 * real ForgeOS repository — only paths under the supplied project_dir.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROBE_VERSION = 'probe-1.0.0';

function normalizeRel(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

const HARD_FORBIDDEN_PREFIXES = ['.cursor/', '.agent-os/', 'policy/', 'docs/agents/'];

function isHardForbidden(rel) {
  const p = normalizeRel(rel);
  return HARD_FORBIDDEN_PREFIXES.some(
    (pref) => p === pref.replace(/\/$/, '') || p.startsWith(pref)
  );
}

function matchesGlob(rel, pattern) {
  const p = normalizeRel(rel);
  const pat = String(pattern).replace(/\\/g, '/');
  if (pat.endsWith('/**')) {
    const base = pat.slice(0, -3);
    return p === base || p.startsWith(base + '/');
  }
  return p === pat || p.startsWith(pat.replace(/\/$/, '') + '/');
}

/**
 * @param {object} options
 * @param {'success'|'start_failed'|'execution_failed'|'evidence_unavailable'|'verification_fail'} [options.behavior]
 */
export function createOpenHandsProbeTransport(options = {}) {
  const behavior = options.behavior || 'success';
  const conversations = new Map();
  let startCount = 0;

  function healthSync() {
    if (options.health === 'unhealthy') {
      return { ok: false, status: 503, data: 'UNHEALTHY', error: 'unhealthy' };
    }
    if (options.health === 'unavailable') {
      return { ok: false, status: 0, data: null, error: 'unavailable' };
    }
    return { ok: true, status: 200, data: 'OK', error: null };
  }

  function startConversationSync(body) {
    startCount += 1;
    if (behavior === 'start_failed') {
      return { ok: false, status: 500, data: { detail: 'probe start failed' }, error: 'http_500' };
    }

    const meta = body?.forgeos_metadata || {};
    const workingDir = body?.workspace?.working_dir;
    const id = `oh-probe-${Date.now()}-${startCount}`;
    const changed = [];
    const verificationResults = [];
    const commandsExecuted = [];
    let status = 'finished';
    let errorDetail = null;

    try {
      if (!workingDir || !fs.existsSync(workingDir)) {
        throw new Error(`workspace missing: ${workingDir}`);
      }

      const text = body?.initial_message?.content?.[0]?.text || '';
      const pathMatch = text.match(/Primary path:\s*(\S+)/);
      const opMatch = text.match(/Operation:\s*(\S+)/);
      const op = opMatch?.[1] || 'noop';
      const rel = pathMatch?.[1];

      const allowedMatch = text.match(/Allowed paths:\s*([^\n]+)/);
      const forbiddenMatch = text.match(/Forbidden paths[^:]*:\s*([^\n]+)/);
      const allowed = allowedMatch
        ? allowedMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const forbidden = forbiddenMatch
        ? forbiddenMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      if (op === 'write_file' && rel) {
        const safeRel = normalizeRel(rel);
        if (isHardForbidden(safeRel)) {
          throw new Error(`hard-forbidden path: ${safeRel}`);
        }
        if (forbidden.some((g) => matchesGlob(safeRel, g))) {
          throw new Error(`forbidden path: ${safeRel}`);
        }
        if (allowed.length && !allowed.some((g) => matchesGlob(safeRel, g))) {
          throw new Error(`not allowed: ${safeRel}`);
        }
        const abs = path.resolve(workingDir, safeRel);
        const rooted = path.resolve(workingDir);
        const relative = path.relative(rooted, abs);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`path escape: ${safeRel}`);
        }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `openhands-probe:${meta.task_id || id}\n`, 'utf8');
        changed.push(safeRel);
      }

      const verifyMatch = text.match(/Verification commands to run:\s*([^\n]+)/);
      if (verifyMatch) {
        const cmds = verifyMatch[1].split(';').map((s) => s.trim()).filter(Boolean);
        for (const cmd of cmds) {
          const passed = behavior !== 'verification_fail';
          const result = {
            command: cmd,
            exit_code: passed ? 0 : 1,
            passed,
          };
          commandsExecuted.push(result);
          verificationResults.push(result);
        }
      }

      if (behavior === 'execution_failed') {
        status = 'error';
        errorDetail = 'probe execution failed';
      }
    } catch (err) {
      status = 'error';
      errorDetail = String(err.message || err);
    }

    const conversation = {
      id,
      status,
      forgeos_task_id: meta.task_id || null,
      changed_files: changed,
      commands_executed: commandsExecuted,
      verification_results: verificationResults,
      error: errorDetail,
      working_dir: workingDir,
      evidence_unavailable: behavior === 'evidence_unavailable',
    };
    conversations.set(id, conversation);

    if (status === 'error' && behavior !== 'execution_failed') {
      return { ok: false, status: 500, data: conversation, error: 'http_500' };
    }

    return { ok: true, status: 200, data: conversation, error: null };
  }

  return {
    kind: 'probe',
    version: PROBE_VERSION,
    getStartCount() {
      return startCount;
    },
    reset() {
      startCount = 0;
      conversations.clear();
    },
    healthSync,
    startConversationSync,
    getConversationSync(id) {
      const c = conversations.get(id);
      if (!c) return { ok: false, status: 404, data: null, error: 'not_found' };
      return { ok: true, status: 200, data: c, error: null };
    },
    async health() {
      return healthSync();
    },
    async ready() {
      return { ok: true, status: 200, data: { ready: true }, error: null };
    },
    async serverInfo() {
      return {
        ok: true,
        status: 200,
        data: { version: PROBE_VERSION, transport: 'probe', uptime_s: 1 },
        error: null,
      };
    },
    async startConversation(body) {
      return startConversationSync(body);
    },
    async getConversation(id) {
      return this.getConversationSync(id);
    },
  };
}
