/**
 * ForgeOS Policy Authority — single ALLOW/BLOCK decision surface.
 *
 * Host adapters translate events and enforce decisions.
 * They must not implement independent authorization rules.
 *
 * Offline/direct engine calls (tests, scripts) are valid evaluations;
 * production host execution must go through host hooks → this authority.
 */
import { POLICY_AUTHORITY, PRODUCT_ID } from './identity.mjs';
import { checkScopeContainment, bindTaskScope } from './task-scope.mjs';
import { consumeExactApproval, exactApprovalSubject } from './exact-approval.mjs';
import {
  evaluatePreToolUse as enginePreToolUse,
  evaluateShell as engineShell,
  evaluateMcp as engineMcp,
  evaluateApprovalForOperation as engineApproval,
  dryRunScenario as engineDryRun,
  hookOutput as engineHookOutput,
  readStdinJson,
  getPolicyAuthority,
  loadRules,
  loadSession,
  saveSession,
  clearSession,
  resolveSession,
  resolveAgentId,
  appendAudit,
} from './engine.mjs';

export { POLICY_AUTHORITY, PRODUCT_ID };

/**
 * Stamp a policy decision with stable authority metadata for evidence.
 * Does not alter allow/deny semantics.
 */
export function stampDecision(decision = {}, context = {}) {
  if (!decision || typeof decision !== 'object') {
    return {
      permission: 'deny',
      reason: 'invalid_decision',
      authority: POLICY_AUTHORITY,
      product: PRODUCT_ID,
    };
  }
  return {
    ...decision,
    authority: decision.authority || POLICY_AUTHORITY,
    product: decision.product || PRODUCT_ID,
    ...(context.operation != null ? { operation: context.operation } : {}),
    ...(context.task_id != null && decision.task_id == null ? { task_id: context.task_id } : {}),
    ...(context.agent_id != null && decision.agent_id == null ? { agent_id: context.agent_id } : {}),
  };
}

/**
 * Canonical evaluate entry — routes operation context to the engine.
 *
 * @param {{ kind: string, input?: object, command?: string, server?: string, tool?: string, operation?: string, task_id?: string, session?: object }} ctx
 */
export function evaluate(ctx = {}) {
  const kind = String(ctx.kind || '').toLowerCase();
  switch (kind) {
    case 'pre_tool':
    case 'pretool':
    case 'pre_tool_use':
      return evaluatePreToolUse(ctx.input || ctx);
    case 'shell':
      return stampDecision(engineShell(ctx.command, ctx.session), { operation: 'shell' });
    case 'mcp':
      return stampDecision(engineMcp(ctx.server, ctx.tool, ctx.session), {
        operation: ctx.operation || 'mcp',
      });
    case 'approval':
      return stampDecision(engineApproval(ctx.operation, ctx.task_id), {
        operation: ctx.operation,
        task_id: ctx.task_id,
      });
    default:
      return stampDecision({
        permission: 'deny',
        reason: 'unknown_operation_kind',
        user_message: 'Blocked: unknown policy operation kind — fail closed.',
        agent_message: `Unknown PolicyAuthority.evaluate kind: ${kind || '(empty)'}`,
      });
  }
}

export function evaluatePreToolUse(input, session = null) {
  if (input?.task_scope) {
    const tool = String(input.tool_name || '').toLowerCase();
    const actionClass = ['read','read_file'].includes(tool) ? 'read'
      : ['write','edit','strreplace','write_file','apply_patch','applypatch'].includes(tool) ? 'write'
        : tool === 'delete' ? 'delete' : ['shell','bash'].includes(tool) ? 'execute' : 'analyze';
    const scope = checkScopeContainment(input.task_scope, { ...input.scope_action,
      action_class: actionClass, path: input.tool_input?.file_path ?? input.tool_input?.path });
    if (!scope.ok) return stampDecision({ permission: 'deny', reason: scope.reason });
  }
  return stampDecision(enginePreToolUse(input, session));
}

/** Synchronous task-specific evaluation. Reuses legacy engine context without persisting a vendor session. */
export function evaluateScopedTaskTool(candidate, projectDir, toolInput) {
  const scope = evaluateTaskScope(candidate, projectDir);
  if (!scope.ok) return scope;
  const previous = process.env.CURSOR_PROJECT_DIR;
  try {
    process.env.CURSOR_PROJECT_DIR = scope.scope.workspace;
    return evaluatePreToolUse({ ...toolInput, task_scope: scope.scope, scope_action: { project_dir: projectDir } },
      { subagent_type: candidate.policy_context?.agent_id || 'orchestrator', task_id: candidate.task_id });
  } finally {
    if (previous === undefined) delete process.env.CURSOR_PROJECT_DIR;
    else process.env.CURSOR_PROJECT_DIR = previous;
  }
}

/** Scope failure is an additional restriction; success is NOT Policy ALLOW. */
export function evaluateTaskScope(candidate, projectDir) {
  const bound = bindTaskScope(candidate, projectDir);
  return bound.ok ? { ...bound, permission: null, authority: POLICY_AUTHORITY }
    : { ...bound, ...stampDecision({ permission: 'deny', reason: bound.reason }) };
}

export function evaluateShell(command, session = null, exact = null) {
  return stampDecision(engineShell(command, session, exact), { operation: 'shell' });
}

/** Trusted local dispatch composition. Repeated validation is harmless; consumption precedes effect. */
export function dispatchExactShell(input, effect) {
  const previous = process.env.CURSOR_PROJECT_DIR;
  try {
    const subject = exactApprovalSubject(input);
    process.env.CURSOR_PROJECT_DIR = subject.workspace_identity;
    const command = subject.normalized_execution_input.argv.join(' ');
    const decision = evaluateShell(command, {task_id:input.task_id,subagent_type:input.agent_id}, input);
    if (decision.permission !== 'allow') return {ok:false,reason:decision.reason,policy_decision:decision,dispatched:false};
    // A low-risk command cannot be used to manufacture a high-risk dispatch receipt.
    if (decision.reason !== 'exact_approval_validated_not_consumed') return {ok:false,reason:'not_an_exact_tier3_action',dispatched:false};
    const consumed = consumeExactApproval(input);
    if (!consumed.ok) return {...consumed,dispatched:false};
    try {
      const value = effect(Object.freeze([...subject.normalized_execution_input.argv]));
      if (value && typeof value.then === 'function') throw new Error('asynchronous_exact_dispatch_unsupported');
      return {ok:true,dispatched:true,value,receipt:consumed.receipt};
    } catch {
      return {ok:false,dispatched:true,reason:'EXECUTION_OUTCOME_UNKNOWN_REAPPROVAL_REQUIRED',receipt:consumed.receipt};
    }
  } catch(e) { return {ok:false,dispatched:false,reason:e.message}; }
  finally { if (previous===undefined) delete process.env.CURSOR_PROJECT_DIR; else process.env.CURSOR_PROJECT_DIR=previous; }
}

export function evaluateMcp(serverName, toolName, session = null) {
  return stampDecision(engineMcp(serverName, toolName, session), { operation: 'mcp' });
}

export function evaluateApprovalForOperation(operation, taskId = null) {
  return stampDecision(engineApproval(operation, taskId), {
    operation,
    task_id: taskId,
  });
}

export function dryRunScenario(name, payload = {}) {
  return stampDecision(engineDryRun(name, payload));
}

/**
 * Host-facing output. Preserves Cursor permission envelope; adds authority for evidence.
 */
export function hookOutput(decision) {
  const stamped = stampDecision(decision);
  if (stamped.permission === 'allow') {
    return JSON.stringify({
      permission: 'allow',
      authority: stamped.authority,
    });
  }
  return JSON.stringify({
    permission: 'deny',
    authority: stamped.authority,
    user_message: stamped.user_message || 'Policy denied this action.',
    agent_message: stamped.agent_message || stamped.reason || 'Denied by ForgeOS policy.',
  });
}

/** Named surface for documentation and future host/runtime adapters */
export const PolicyAuthority = {
  id: POLICY_AUTHORITY,
  product: PRODUCT_ID,
  evaluate,
  evaluatePreToolUse,
  evaluateShell,
  evaluateMcp,
  evaluateApprovalForOperation,
  dryRunScenario,
  stampDecision,
  hookOutput,
  getPolicyAuthority,
};

export {
  readStdinJson,
  getPolicyAuthority,
  loadRules,
  loadSession,
  saveSession,
  clearSession,
  resolveSession,
  resolveAgentId,
  appendAudit,
};
