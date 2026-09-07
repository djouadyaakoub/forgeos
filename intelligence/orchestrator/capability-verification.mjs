/**
 * ForgeOS-owned capability verification — Stage 10 contract
 *
 * Distinct from runtime success and from Stage 5 lifecycle COMPLETED.
 * UNKNOWN is never coerced to PASS. FAIL is never coerced to PASS.
 *
 * Command verification uses Project Intelligence verification.commands
 * plus Policy Authority. Capability metadata cannot introduce arbitrary shell.
 */
import fs from 'node:fs';
import { getCapabilityBinding } from '../capability/binding.mjs';
import { completionSemantics } from '../capability/completion.mjs';
import { projectPath } from '../../host/project-files.mjs';
import { verifyDocumentationContract } from './documentation-verification.mjs';
import { validateTaskScope, checkScopeContainment } from '../../policy/task-scope.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluatePreToolUse } from '../../policy/authority.mjs';
import { redactString } from '../deployment/redact.mjs';
import {
  computeEvidenceFingerprint,
  computeScopedStateFingerprint,
  normalizeVerificationCommands,
} from './fingerprints.mjs';
import { collectProjectFacts } from '../assessment/facts.mjs';

export const VERIFICATION_RESULTS = Object.freeze(['PASS', 'FAIL', 'UNKNOWN']);
export const VERIFICATION_STRATEGIES = Object.freeze([
  'none',
  'presence',
  'finding_resolution',
  'project_verification_commands',
]);

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 30_000;

function nowIso(value) {
  return value || new Date().toISOString();
}

function check(id, result, extra = {}) {
  return {
    id,
    result,
    ...extra,
  };
}

function aggregateResult(checks) {
  if (!checks.length) return 'UNKNOWN';
  if (checks.some((c) => c.result === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.result === 'UNKNOWN')) return 'UNKNOWN';
  if (checks.every((c) => c.result === 'PASS')) return 'PASS';
  return 'UNKNOWN';
}

function neverCoerce(result) {
  if (result === 'PASS' || result === 'FAIL' || result === 'UNKNOWN') return result;
  return 'UNKNOWN';
}

export function authorizedProjectVerificationCommands(facts = {}, candidate = {}) {
  const authorized = normalizeVerificationCommands(facts.verification_commands);
  const requested = normalizeVerificationCommands(candidate.verification_commands);
  if (!authorized.length) {
    return { authorized, requested, runnable: [], rejected: requested };
  }
  if (!requested.length) {
    return { authorized, requested, runnable: authorized, rejected: [] };
  }
  const allowed = new Set(authorized);
  const runnable = requested.filter((c) => allowed.has(c));
  const rejected = requested.filter((c) => !allowed.has(c));
  return { authorized, requested, runnable, rejected };
}

export function runPolicyBoundedCommand(command, projectDir, options = {}) {
  const timeoutMs = Number(options.timeout_ms ?? DEFAULT_VERIFICATION_TIMEOUT_MS);
  const policy = evaluatePreToolUse({
    tool_name: 'Shell',
    tool_input: { command },
  });
  if (policy.permission === 'deny') {
    return {
      command,
      executed: false,
      policy_decision: policy.permission,
      policy_reason: policy.reason || 'deny',
      exit_code: null,
      stdout: '',
      stderr: '',
      timed_out: false,
      result: 'FAIL',
      reason: 'policy_denied_verification_command',
    };
  }

  const started = Date.now();
  const r = spawnSync(command, {
    shell: true,
    cwd: projectDir,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
    env: process.env,
  });
  const timedOut = Boolean(
    (r.error && (r.error.code === 'ETIMEDOUT' || /TIMEDOUT/i.test(String(r.error.message || ''))))
    || r.signal === 'SIGTERM'
    || (r.status == null && r.pid && r.error)
  );
  const stdout = redactString((r.stdout || '').slice(0, 4000));
  const stderr = redactString((r.stderr || '').slice(0, 4000));
  const exitCode = r.status == null ? (timedOut ? null : (r.error ? 1 : null)) : r.status;
  let result = 'FAIL';
  let reason = 'nonzero_exit';
  if (timedOut) {
    result = 'FAIL';
    reason = 'timeout';
  } else if (exitCode === 0) {
    result = 'PASS';
    reason = 'exit_zero';
  }
  return {
    command,
    executed: true,
    policy_decision: policy.permission,
    policy_reason: policy.reason || 'allow',
    exit_code: exitCode,
    stdout,
    stderr,
    timed_out: timedOut,
    duration_ms: Date.now() - started,
    result,
    reason,
    error: r.error && !timedOut ? redactString(String(r.error.message || r.error)) : null,
  };
}

function buildContract(input, checks, result, extra = {}) {
  const candidate = input.candidate || {};
  if (candidate.task_scope) {
    const scopeCheck = validateTaskScope(candidate.task_scope, { project_dir: input.project_dir,
      task_id: candidate.task_id, capability_id: candidate.capability_id, operation_id: candidate.operation_id });
    if (!scopeCheck.ok) { checks.push(check('task_scope', 'FAIL', { reason: scopeCheck.reason })); result = 'FAIL'; }
    for (const changedPath of candidate.observed_changed_paths || []) {
      const contained = checkScopeContainment(candidate.task_scope, { project_dir: input.project_dir, action_class: 'write', path: changedPath });
      if (!contained.ok) { checks.push(check('scope_change', 'FAIL', { path: changedPath, reason: contained.reason })); result = 'FAIL'; }
    }
  }
  const governed = input.governed || {};
  const projectDir = input.project_dir;
  const facts = input.facts || (projectDir ? collectProjectFacts(projectDir) : {});
  const strategy = candidate.verification_strategy || 'none';
  const fingerprints = input.fingerprints || computeEvidenceFingerprint(facts, {
    project_dir: projectDir,
    verification_strategy: strategy,
    verification_presence: candidate.verification_presence,
    verification_commands: candidate.verification_commands || facts.verification_commands,
    input_fingerprint: input.input_fingerprint,
    capability_binding_fingerprint: input.capability_binding_fingerprint,
    bindings: input.bindings,
  });

  return {
    schema: 'forgeos-capability-verification',
    task_scope_fingerprint: candidate.task_scope?.fingerprint || null,
    scope_observation: candidate.observed_changed_paths ? 'caller_supplied_paths_not_exhaustive' : 'not_observed',
    schema_version: 1,
    authority: 'forgeos',
    task_id: candidate.task_id || governed.task_id || null,
    capability_id: candidate.capability_id || governed.capability_id || null,
    execution_id: governed.execution_id || input.execution_id || null,
    result: neverCoerce(result),
    strategy,
    checks,
    evidence: extra.evidence || checks.map((c) => ({
      check_id: c.id,
      result: c.result,
      reason: c.reason || null,
    })),
    verified_at: nowIso(input.verified_at),
    project_fingerprint: fingerprints,
    lifecycle_status: governed.status || null,
    runtime_status: governed.status || null,
    reason: extra.reason || null,
    note: extra.note || 'Runtime COMPLETED is not capability SATISFIED',
  };
}

export function assessCapabilityVerification(input = {}) {
  const governed = input.governed || {};
  const candidate = input.candidate || {};
  const projectDir = input.project_dir;
  const strategy = candidate.verification_strategy || 'none';
  const facts = input.facts || (projectDir ? collectProjectFacts(projectDir) : {});

  if (governed.status === 'POLICY_DENIED') {
    return buildContract(input, [
      check('lifecycle', 'FAIL', { reason: 'policy_denied' }),
    ], 'FAIL', { reason: 'policy_denied' });
  }
  if (candidate.task_scope) {
    const checked = validateTaskScope(candidate.task_scope, { project_dir: projectDir, task_id: candidate.task_id,
      capability_id: candidate.capability_id, operation_id: candidate.operation_id });
    if (!checked.ok) return buildContract(input, [check('task_scope', 'FAIL', { reason: checked.reason })], 'FAIL', { reason: checked.reason });
  }
  if (['START_FAILED', 'EXECUTION_FAILED', 'ROUTING_FAILED'].includes(governed.status)) {
    return buildContract(input, [
      check('lifecycle', 'FAIL', { reason: `lifecycle_${governed.status}` }),
    ], 'FAIL', { reason: `lifecycle_${governed.status}` });
  }
  if (governed.status === 'VERIFICATION_FAILED') {
    return buildContract(input, [
      check('lifecycle', 'FAIL', { reason: 'lifecycle_verification_failed' }),
    ], 'FAIL', { reason: 'lifecycle_verification_failed' });
  }
  if (governed.status !== 'COMPLETED') {
    return buildContract(input, [
      check('lifecycle', 'UNKNOWN', { reason: `lifecycle_not_completed:${governed.status || 'none'}` }),
    ], 'UNKNOWN', { reason: `lifecycle_not_completed:${governed.status || 'none'}` });
  }

  if (strategy === 'none' || !strategy) {
    return buildContract(input, [
      check('strategy', 'UNKNOWN', { reason: 'no_verification_strategy' }),
    ], 'UNKNOWN', {
      reason: 'no_verification_strategy',
      note: 'Strategy none remains UNKNOWN. Runtime COMPLETED is not PASS.',
    });
  }

  if (candidate.verification_contract && strategy !== candidate.verification_contract.strategy) {
    return buildContract(input, [check('strategy', 'FAIL', {reason:'verification_contract_downgrade'})], 'FAIL');
  }

  const binding = candidate.capability_id && getCapabilityBinding(candidate.capability_id);
  if (binding && (!completionSemantics(binding.id).automatic
    || (completionSemantics(binding.id).classification === 'COMMAND_IS_SEMANTIC' && strategy !== 'project_verification_commands'))) {
    return buildContract(input,[check('capability_acceptance','UNKNOWN',{reason:'semantic_completion_contract_not_implemented'})], 'UNKNOWN',
      {reason:'Marker or unrelated command success cannot establish this capability objective.'});
  }
  if (strategy === 'finding_resolution') {
    try {
      const checks = verifyDocumentationContract(projectDir, candidate);
      return buildContract(input, checks, aggregateResult(checks), {reason:'fresh_scoped_documentation_assessment'});
    } catch (e) {
      return buildContract(input, [check('finding_resolution','UNKNOWN',{reason:e.message})], 'UNKNOWN');
    }
  }
  if (strategy === 'presence') {
    const files = candidate.verification_presence || [];
    if (!files.length) {
      return buildContract(input, [
        check('presence_targets', 'UNKNOWN', { reason: 'presence_targets_missing' }),
      ], 'UNKNOWN', { reason: 'presence_targets_missing' });
    }
    const checks = files.map((rel) => {
      let exists = false;
      try { const abs = projectPath(projectDir, rel); exists = fs.existsSync(abs) && fs.statSync(abs).isFile(); } catch {}
      return check(`presence:${rel}`, exists ? 'PASS' : 'FAIL', {
        path: rel,
        reason: exists ? 'present' : 'missing',
      });
    });
    const result = aggregateResult(checks);
    return buildContract(input, checks, result, {
      reason: result === 'PASS' ? 'presence_confirmed' : 'presence_missing',
    });
  }

  if (strategy === 'project_verification_commands') {
    const { authorized, runnable, rejected } = authorizedProjectVerificationCommands(facts, candidate);
    const checks = [];

    for (const cmd of rejected) {
      checks.push(check(`unauthorized:${cmd}`, 'FAIL', {
        reason: 'not_in_project_verification_contract',
        command: cmd,
        executed: false,
        note: 'Capability metadata cannot introduce arbitrary shell',
      }));
    }

    if (!authorized.length) {
      checks.push(check('authorized_commands', 'UNKNOWN', {
        reason: 'no_verification_commands_configured',
      }));
      return buildContract(input, checks, 'UNKNOWN', {
        reason: 'no_verification_commands_configured',
      });
    }

    if (!runnable.length) {
      checks.push(check('runnable_commands', 'UNKNOWN', {
        reason: 'no_authorized_runnable_commands',
      }));
      return buildContract(input, checks, aggregateResult(checks), {
        reason: 'no_authorized_runnable_commands',
      });
    }

    for (const cmd of runnable) {
      const ran = runPolicyBoundedCommand(cmd, projectDir, {
        timeout_ms: input.timeout_ms,
      });
      checks.push(check(`command:${cmd}`, ran.result, {
        reason: ran.reason,
        exit_code: ran.exit_code,
        stdout: ran.stdout,
        stderr: ran.stderr,
        timed_out: ran.timed_out,
        executed: ran.executed,
        policy_decision: ran.policy_decision,
      }));
    }

    const result = aggregateResult(checks);
    return buildContract(input, checks, result, {
      reason: result === 'PASS' ? 'verification_commands_passed' : 'verification_commands_failed',
    });
  }

  return buildContract(input, [
    check('strategy', 'UNKNOWN', { reason: `unknown_strategy:${strategy}` }),
  ], 'UNKNOWN', { reason: `unknown_strategy:${strategy}` });
}

export function verificationAllowsSatisfied(verification) {
  return verification?.result === 'PASS';
}

export function currentVerificationFingerprint(projectDir, candidate, facts, extra = {}) {
  const strategy = candidate?.verification_strategy || 'none';
  return computeEvidenceFingerprint(facts, {
    project_dir: projectDir,
    verification_strategy: strategy,
    verification_presence: candidate?.verification_presence,
    verification_commands: candidate?.verification_commands || facts?.verification_commands,
    scoped_state_fingerprint: computeScopedStateFingerprint(projectDir, {
      verification_strategy: strategy,
      verification_presence: candidate?.verification_presence,
      verification_commands: candidate?.verification_commands || facts?.verification_commands,
    }),
    ...extra,
  });
}
