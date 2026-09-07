/**
 * ForgeOS runtime interface — host-neutral abstractions
 *
 * Host Adapter → Runtime Interface → ForgeOS Core
 *
 * NOTE (Architecture 2.0 Stage 3):
 * This file is the **Host Adapter** event / agent / tool-provider boundary.
 * It is NOT the Runtime Backend Interface.
 *
 * Runtime Backend contract (execution backends): `runtime/backend-interface.mjs`
 * Host registry (Cursor / CLI / generic): `runtime/host-registry.mjs`
 *
 * Cursor remains a Host Adapter. It is not claimed as a Runtime Backend here.
 */
import { PRODUCT_ID, POLICY_AUTHORITY } from '../policy/identity.mjs';

export const RUNTIME_EVENT_TYPES = [
  'tool_call',
  'shell',
  'mcp',
  'agent_start',
  'agent_end',
  'user_request',
];

export const ACTOR_TYPES = ['user', 'orchestrator', 'specialist'];

/**
 * Normalize any host payload into a ForgeOS runtime event.
 */
export function createRuntimeEvent(input = {}) {
  return {
    type: input.type || 'tool_call',
    host: {
      id: input.host?.id || input.host_id || 'unknown',
      name: input.host?.name || input.host_name || 'unknown',
    },
    project: {
      path: input.project?.path || input.project_path || '',
    },
    task: {
      id: input.task?.id || input.task_id || '',
    },
    actor: {
      type: input.actor?.type || input.actor_type || 'user',
      id: input.actor?.id || input.actor_id || '',
    },
    payload: input.payload || {},
    meta: {
      authority: POLICY_AUTHORITY,
      product: PRODUCT_ID,
    },
  };
}

/**
 * Host adapter contract validation (minimal).
 */
export function validateHostAdapter(adapter) {
  const issues = [];
  if (!adapter?.id) issues.push('missing_id');
  if (!adapter?.name) issues.push('missing_name');
  if (!adapter?.capabilities || typeof adapter.capabilities !== 'object') {
    issues.push('missing_capabilities');
  }
  return { valid: issues.length === 0, issues, adapter };
}

/**
 * Agent conceptual interface types (documentation + runtime helpers).
 */
export function createAgentInvocation(definition = {}, context = {}) {
  return {
    agent_id: definition.id || definition.agent_id,
    capability: definition.capability,
    project_path: context.project_path,
    task_id: context.task_id,
    host_id: context.host_id,
    input: context.input || {},
  };
}

export function createAgentResult(invocation, output = {}) {
  return {
    agent_id: invocation.agent_id,
    status: output.status || 'completed',
    handoff: output.handoff || null,
    evidence: output.evidence || [],
    output: output.result || output.output || null,
  };
}

export function createAgentHandoff(from, to, context = {}) {
  return {
    from_agent: from,
    to_agent: to,
    reason: context.reason || '',
    task_id: context.task_id,
    payload: context.payload || {},
  };
}

/**
 * Generic tool provider interface (boundary only).
 */
export const TOOL_PROVIDER_CAPABILITIES = [
  'filesystem',
  'shell',
  'http',
  'mcp',
  'search',
  'git',
  'project_metadata',
];

export function createToolProvider(hostAdapter) {
  return {
    host_id: hostAdapter?.id,
    capabilities: TOOL_PROVIDER_CAPABILITIES.filter((cap) => {
      const caps = hostAdapter?.capabilities || {};
      if (cap === 'filesystem' || cap === 'shell') return caps.terminal !== false;
      if (cap === 'mcp') return caps.hooks === true;
      return true;
    }),
  };
}
