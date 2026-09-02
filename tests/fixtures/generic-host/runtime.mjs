/**
 * Generic host fixture runtime — proves editor-neutral Core path
 */
import { createRuntimeEvent } from '../../../runtime/interface.mjs';
import { getHostAdapter } from '../../../runtime/host-registry.mjs';
import { coordinateDevelopmentWorkflow } from '../../../intelligence/orchestrator/coordinator.mjs';

export function createGenericHostEvent(input = {}) {
  return createRuntimeEvent({
    type: input.type || 'user_request',
    host_id: 'generic',
    host_name: 'Generic Host',
    project_path: input.project_path,
    task_id: input.task_id,
    actor_type: 'user',
    payload: input.payload || {},
  });
}

export function runGenericHostWorkflow(input = {}) {
  const host = getHostAdapter('generic');
  const event = createGenericHostEvent(input);
  const result = coordinateDevelopmentWorkflow({
    project_dir: event.project.path,
    objective: input.objective || event.payload?.objective || '',
  });
  return { host, event, result };
}
