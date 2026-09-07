/**
 * ForgeOS Local Executor — PROGRAMMATIC REFERENCE Runtime Backend
 * (Architecture 2.0 Stages 5–6–17)
 *
 * This is a REAL path-constrained local process executor.
 * It is NOT Cline, OpenHands, Codex, Claude, or Cursor.
 * It is NOT host-native and NOT the primary user execution UX.
 *
 * Stage 17 classification:
 *   programmatic_reference
 *
 * Stage 6 FREEZES this as REFERENCE ONLY — do not expand into a general agent runtime
 * (no LLM loop, memory, skills engine, agent planning, multi-agent, complex sandbox).
 *
 * There is NO automatic fallback from OpenHands → Local Executor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyShellOperation } from '../../policy/engine.mjs';
import { dispatchExactShell } from '../../policy/authority.mjs';
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
} from '../backend-interface.mjs';

export const LOCAL_EXECUTOR_ID = 'local-executor';
export const LOCAL_EXECUTOR_VERSION = '1.0.0';
/** Stage 6: frozen reference backend — not a production agent runtime. */
export const LOCAL_EXECUTOR_ROLE = 'REFERENCE_BACKEND';
/** Stage 17: product classification — not host-native / not Cursor. */
export const LOCAL_EXECUTOR_CLASSIFICATION = 'programmatic_reference';
export const LOCAL_EXECUTOR_PRODUCT_PATH = 'programmatic_reference_not_host_native';

/** Always-denied prefixes (defense in depth; ForgeOS policy is still authoritative). */
const HARD_FORBIDDEN_PREFIXES = [
  '.cursor/',
  '.agent-os/',
  'policy/',
  'docs/agents/',
];
const HARD_FORBIDDEN_EXACT = [
  '.cursor/hooks.json',
  '.cursor/agents/registry.yaml',
  'docs/agents/RUNTIME_LAW.md',
];

const RUNS = new Map();

function normalizeRel(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function matchesGlob(rel, pattern) {
  const p = normalizeRel(rel);
  const pat = String(pattern).replace(/\\/g, '/');
  if (pat.endsWith('/**')) {
    const base = pat.slice(0, -3);
    return p === base || p.startsWith(base + '/');
  }
  if (pat.includes('*')) {
    const re = new RegExp(
      '^' +
        pat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '___GS___')
          .replace(/\*/g, '[^/]*')
          .replace(/___GS___/g, '.*') +
        '$',
      'i'
    );
    return re.test(p);
  }
  return p === pat || p.startsWith(pat.replace(/\/$/, '') + '/');
}

function isHardForbidden(rel) {
  const p = normalizeRel(rel);
  if (HARD_FORBIDDEN_EXACT.includes(p)) return true;
  return HARD_FORBIDDEN_PREFIXES.some((pref) => p === pref.replace(/\/$/, '') || p.startsWith(pref));
}

/**
 * Resolve a project-relative path under constraints.
 * @throws Error with code when unsafe
 */
export function assertWritablePath(projectDir, relPath, policyRequirements = {}) {
  const rel = normalizeRel(relPath);
  if (!rel) throw Object.assign(new Error('missing path'), { code: 'missing_path' });

  const abs = path.resolve(projectDir, rel);
  const rooted = path.resolve(projectDir);
  const relative = path.relative(rooted, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error(`path escapes project: ${rel}`), { code: 'path_escape' });
  }
  const safeRel = relative.replace(/\\/g, '/');

  if (isHardForbidden(safeRel)) {
    throw Object.assign(new Error(`hard-forbidden path: ${safeRel}`), {
      code: 'forbidden_path',
    });
  }

  const forbidden = [
    ...(policyRequirements.forbidden_paths || []),
  ].map(normalizeRel);
  if (forbidden.some((g) => matchesGlob(safeRel, g))) {
    throw Object.assign(new Error(`forbidden by policy_requirements: ${safeRel}`), {
      code: 'forbidden_path',
    });
  }

  const allowed = (policyRequirements.allowed_paths || []).map(normalizeRel);
  if (allowed.length > 0 && !allowed.some((g) => matchesGlob(safeRel, g))) {
    throw Object.assign(new Error(`not in allowed_paths: ${safeRel}`), {
      code: 'not_allowed_path',
    });
  }

  return { abs, rel: safeRel };
}

function runCommand(command, cwd, timeoutMs = 30000) {
  const r = spawnSync(command, {
    shell: true,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
  return {
    command,
    exit_code: r.status == null ? (r.error ? 1 : null) : r.status,
    stdout: (r.stdout || '').slice(0, 4000),
    stderr: (r.stderr || '').slice(0, 4000),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

/**
 * Create the Local Executor RuntimeBackend.
 */
export function createLocalExecutorBackend(overrides = {}) {
  const capabilities = normalizeBackendCapabilities({
    interactive: false,
    autonomous: true,
    sandbox: false,
    parallel: false,
    pr_delivery: false,
    hooks_callback: false,
    cost_telemetry: false,
    languages: ['javascript', 'typescript', 'shell', 'text'],
    ...(overrides.capabilities || {}),
  });

  const healthStatus = overrides.healthStatus || 'healthy';

  const backend = {
    id: overrides.id || LOCAL_EXECUTOR_ID,
    name: overrides.name || 'ForgeOS Local Executor',
    version: overrides.version || LOCAL_EXECUTOR_VERSION,
    capabilities,
    _adapter: 'local-executor',
    _production_reference: true,
    _role: LOCAL_EXECUTOR_ROLE,
    _classification: LOCAL_EXECUTOR_CLASSIFICATION,
    _product_path: LOCAL_EXECUTOR_PRODUCT_PATH,
    _host_native: false,
    _note:
      'Programmatic reference backend — NOT host-native, NOT Cursor, NOT primary UX; frozen Stage 6',

    health() {
      return createHealthResult(healthStatus, {
        adapter: LOCAL_EXECUTOR_ID,
        cancellation: 'sync_unsupported',
      });
    },

    canHandle(task, _projectIntelligence, policyRequirements = {}) {
      const health = this.health();
      if (health.status === 'unavailable') {
        return createCanHandleResult(false, [
          { code: 'backend_unavailable', message: 'local-executor unavailable' },
        ]);
      }
      if (health.status === 'unhealthy') {
        return createCanHandleResult(false, [
          { code: 'backend_unhealthy', message: 'local-executor unhealthy' },
        ]);
      }
      const reqs = {
        ...(policyRequirements || {}),
        ...(task?.requirements || {}),
      };
      // Interactive-only requests are unsupported
      if (reqs.interactive === true) {
        return createCanHandleResult(false, [
          { code: 'interactive_unsupported', message: 'local-executor is non-interactive' },
        ]);
      }
      return matchBackendCapabilities(this.capabilities, reqs);
    },

    start(runRequest) {
      const gate = assertRunStartAllowed(runRequest);
      if (!gate.ok) {
        return { kind: 'policy', policy_decision: gate.policy_decision, handle: null };
      }

      const constraints = runRequest.execution_constraints || {};
      const projectDir = path.resolve(
        constraints.project_dir || runRequest.project_intelligence?.paths?.root || process.cwd()
      );
      if (!fs.existsSync(projectDir)) {
        return {
          kind: 'error',
          error: createRuntimeError('START_FAILED', `project_dir missing: ${projectDir}`),
          handle: null,
        };
      }

      const runId = `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const startedAt = new Date().toISOString();
      const handle = createRunHandle({
        run_id: runId,
        task_id: runRequest.task_id,
        backend_id: this.id,
        status: 'running',
        started_at: startedAt,
      });

      const changedFiles = [];
      const commandsExecuted = [];
      const verificationResults = [];
      const approvalReceipts = [];

      try {
        const op = constraints.operation || 'noop';
        const policyReqs = runRequest.policy_requirements || {};
        // Verification is not an alternate high-risk execution channel.
        if ((runRequest.verification_commands || []).some(c => classifyShellOperation(c)?.tier >= 3))
          throw Object.assign(new Error('tier3_verification_command_forbidden'), {code:'tier3_verification_command_forbidden'});
        if ((constraints.commands || []).some(c => classifyShellOperation(c)?.tier >= 3) && constraints.commands.length !== 1)
          throw Object.assign(new Error('tier3_batch_unsupported'), {code:'tier3_batch_unsupported'});

        if (op === 'write_file' || op === 'write_files') {
          const writes = constraints.writes ||
            (constraints.path
              ? [{ path: constraints.path, content: constraints.content ?? '' }]
              : []);
          if (!writes.length) {
            throw Object.assign(new Error('write_file requires writes[] or path'), {
              code: 'invalid_operation',
            });
          }
          for (const w of writes) {
            const { abs, rel } = assertWritablePath(projectDir, w.path, policyReqs);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, String(w.content ?? ''), 'utf8');
            changedFiles.push(rel);
          }
        } else if (op === 'noop') {
          // intentional no-op for routing/lifecycle smoke
        } else if (op === 'run_commands') {
          const cmds = constraints.commands || [];
          for (const cmd of cmds) {
            const classified = classifyShellOperation(cmd);
            let result;
            if (classified?.tier >= 3) {
              const dispatch = dispatchExactShell({ ...constraints.exact_approval,
                project_dir:projectDir, task_id:runRequest.task_id, action:classified.operation,
                execution_id:runId, event:{tool_name:'Shell',tool_input:{command:cmd}} }, argv => {
                  if (overrides.exactCommandRunner) return overrides.exactCommandRunner(argv, projectDir);
                  // No shell re-interpretation: approved argv is exactly what is dispatched.
                  const r = spawnSync(argv[0], argv.slice(1), {cwd:projectDir,encoding:'utf8',shell:false,timeout:constraints.timeout_ms || 30000});
                  return {command:argv.join(' '),exit_code:r.status ?? 1,stdout:(r.stdout||'').slice(0,4000),stderr:(r.stderr||'').slice(0,4000),error:r.error?.message||null};
                });
              if (dispatch.receipt) approvalReceipts.push(dispatch.receipt);
              if (!dispatch.ok) throw Object.assign(new Error(dispatch.reason),{code:dispatch.reason});
              result = dispatch.value;
            } else result = runCommand(String(cmd), projectDir, constraints.timeout_ms);
            commandsExecuted.push(result);
            if (result.exit_code !== 0) {
              throw Object.assign(new Error(`command failed: ${cmd}`), {
                code: 'execution_failed',
                result,
              });
            }
          }
        } else {
          throw Object.assign(new Error(`unsupported operation: ${op}`), {
            code: 'unsupported_operation',
          });
        }

        // Execute verification commands when requested on the runRequest
        for (const cmd of runRequest.verification_commands || []) {
          const result = runCommand(String(cmd), projectDir, constraints.timeout_ms);
          commandsExecuted.push(result);
          verificationResults.push({
            command: result.command,
            exit_code: result.exit_code,
            passed: result.exit_code === 0,
            output_ref: null,
          });
        }

        const completed = createRunHandle({
          ...handle,
          status: 'completed',
          updated_at: new Date().toISOString(),
        });

        const evidence = createEvidenceBundle({
          run_id: completed.run_id,
          task_id: completed.task_id,
          backend_id: this.id,
          execution_status: 'completed',
          changed_files: changedFiles,
          diff_summary: changedFiles.length
            ? `wrote ${changedFiles.length} file(s): ${changedFiles.join(', ')}`
            : 'no files changed',
          commands_executed: commandsExecuted,
          verification_results: verificationResults,
        });

        RUNS.set(completed.run_id, {
          handle: completed,
          request: runRequest,
          evidence,
          approval_receipts: approvalReceipts,
          project_dir: projectDir,
          cancelled: false,
        });

        return {
          kind: 'started',
          handle: completed,
          policy_decision: gate.policy_decision,
          evidence,
          approval_receipts: approvalReceipts,
        };
      } catch (err) {
        const failed = createRunHandle({
          ...handle,
          status: 'failed',
          updated_at: new Date().toISOString(),
        });
        const evidence = createEvidenceBundle({
          run_id: failed.run_id,
          task_id: failed.task_id,
          backend_id: this.id,
          execution_status: 'failed',
          changed_files: changedFiles,
          commands_executed: commandsExecuted,
          verification_results: verificationResults,
          notes: String(err.message || err),
        });
        RUNS.set(failed.run_id, {
          handle: failed,
          request: runRequest,
          evidence,
          project_dir: projectDir,
          error: err,
        });
        return {
          kind: 'error',
          handle: failed,
          error: createRuntimeError(
            err.code === 'forbidden_path' || err.code === 'not_allowed_path' || err.code === 'path_escape'
              ? 'START_FAILED'
              : 'START_FAILED',
            err.message,
            { code: err.code || 'execution_failed' }
          ),
          evidence,
          policy_decision: gate.policy_decision,
          approval_receipts: approvalReceipts,
        };
      }
    },

    cancel(runHandle, requestedTaskId) {
      // Sync executor: in-flight cancel is not safely supported.
      const taskId = requestedTaskId ?? runHandle?.task_id;
      if (!runHandle?.run_id || !taskId) {
        return createCancelResult({
          ok: false,
          run_id: runHandle?.run_id,
          task_id: taskId,
          backend_id: this.id,
          status: 'unknown',
          error: createRuntimeError('CANCEL_FAILED', 'missing run_id or task_id'),
        });
      }
      if (runHandle.task_id !== taskId) {
        return createCancelResult({
          ok: false,
          run_id: runHandle.run_id,
          task_id: runHandle.task_id,
          backend_id: this.id,
          status: runHandle.status,
          error: createRuntimeError(
            'TASK_MISMATCH',
            `Run ${runHandle.run_id} belongs to task ${runHandle.task_id}, not ${taskId}`
          ),
        });
      }
      return createCancelResult({
        ok: false,
        run_id: runHandle.run_id,
        task_id: runHandle.task_id,
        backend_id: this.id,
        status: runHandle.status || 'completed',
        error: createRuntimeError(
          'CANCEL_FAILED',
          'local-executor runs synchronously; in-flight cancel is safely unsupported'
        ),
      });
    },

    collectEvidence(runHandle) {
      const entry = RUNS.get(runHandle?.run_id);
      if (!entry) {
        return createEvidenceBundle({
          run_id: runHandle?.run_id,
          task_id: runHandle?.task_id,
          backend_id: this.id,
          unavailable: true,
          execution_status: 'unknown',
          notes: 'EVIDENCE_UNAVAILABLE',
        });
      }
      if (entry.handle.task_id !== runHandle.task_id) {
        return createEvidenceBundle({
          run_id: runHandle.run_id,
          task_id: runHandle.task_id,
          backend_id: this.id,
          unavailable: true,
          notes: 'TASK_MISMATCH',
        });
      }
      return entry.evidence;
    },
  };

  const validation = validateRuntimeBackend(backend);
  if (!validation.valid) {
    throw new Error(`local-executor invalid: ${validation.issues.join(', ')}`);
  }
  return backend;
}

export function clearLocalExecutorRuns() {
  RUNS.clear();
}

export function getLocalExecutorRun(runId) {
  return RUNS.get(runId) || null;
}
