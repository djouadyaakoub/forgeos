/**
 * Cursor adapter — bridges Cursor hook payloads to ForgeOS runtime events
 */
import { createRuntimeEvent } from '../../runtime/interface.mjs';
import { getHostAdapter } from '../../runtime/host-registry.mjs';

const CURSOR_HOST = getHostAdapter('cursor');

export function normalizeCursorHookPayload(hookInput = {}) {
  const eventType = hookInput.hook_event_name?.includes('shell') ? 'shell'
    : hookInput.tool_name ? 'tool_call'
      : hookInput.mcp ? 'mcp'
        : 'tool_call';

  return createRuntimeEvent({
    type: eventType,
    host_id: 'cursor',
    host_name: 'Cursor',
    project_path: hookInput.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || '',
    task_id: hookInput.task_id || hookInput.conversation_id || '',
    actor_type: hookInput.agent ? 'specialist' : 'user',
    actor_id: hookInput.agent || hookInput.user_id || '',
    payload: {
      tool_name: hookInput.tool_name,
      tool_input: hookInput.tool_input,
      command: hookInput.command,
      raw: hookInput,
    },
  });
}

export function getCursorAdapterManifest() {
  return CURSOR_HOST;
}

export { CURSOR_HOST };
