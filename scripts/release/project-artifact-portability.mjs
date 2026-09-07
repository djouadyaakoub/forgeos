/** Local handoff workspace identity is required data, not a distributable source path. */
import { validateHostHandoff } from '../../intelligence/orchestrator/host-handoff.mjs';
export function portabilityScanText(root, relative, content) {
  const match = /^docs\/project\/tasks\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})\.handoff\.json$/.exec(relative);
  if (!match) return content;
  try {
    const record = JSON.parse(content);
    if (!validateHostHandoff(record,{project_dir:root,expected_task_id:match[1]}).ok) return content;
    // Only validated identity fields are local by contract. Scan everything else unchanged.
    if (record.verification_contract?.workspace === record.task_scope.workspace)
      record.verification_contract.workspace = '<validated-local-workspace>';
    record.workspace.project_dir = '<validated-local-workspace>';
    record.task_scope.workspace = '<validated-local-workspace>';
    return JSON.stringify(record);
  } catch { return content; }
}
