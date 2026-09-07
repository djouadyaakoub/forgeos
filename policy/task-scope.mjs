/** Task scope is containment, never authorization. Independently authored Stage 25. */
import { projectRoot, projectPath, readProjectText } from '../host/project-files.mjs';
import { fingerprintText } from '../intelligence/assessment/facts.mjs';
import { stableStringify } from '../intelligence/adapters/structural-facts.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const normalizeSet = (items) => {
  if (!Array.isArray(items) || items.length > 256 || items.some(x => typeof x !== 'string' || !x || x.length > 512)) throw new Error('invalid_scope_list');
  return [...new Set(items)].sort();
};
export function scopeContextFingerprint(root) {
  return fingerprintText(readProjectText(root, '.agent-os/project.yaml')
    ?? readProjectText(root, '.agent-os/project.json') ?? '');
}
function pattern(root, value) {
  const p = value.replace(/\\/g, '/');
  if (/[\[\]{}!]/.test(p)) throw new Error('unsupported_scope_pattern');
  if (p.split('/').some(part => part.includes('**') && part !== '**')) throw new Error('unsupported_scope_pattern');
  projectPath(root, p.replace(/[?*]/g, 'x'));
  return p;
}
function matches(glob, file) {
  if (process.platform === 'win32') { glob = glob.toLowerCase(); file = file.toLowerCase(); }
  const segment = (g, s) => {
    let row = Array(s.length + 1).fill(false); row[0] = true;
    for (const ch of g) {
      const next = Array(s.length + 1).fill(false); next[0] = ch === '*' && row[0];
      for (let j = 1; j <= s.length; j++) next[j] = ch === '*' ? row[j] || next[j - 1] : row[j - 1] && (ch === '?' || ch === s[j - 1]);
      row = next;
    }
    return row[s.length];
  };
  const gs = glob.split('/'), ps = file.split('/'), memo = new Map();
  function match(i, j) {
    const key = `${i}:${j}`;
    if (memo.has(key)) return memo.get(key);
    const result = i === gs.length ? j === ps.length : gs[i] === '**'
      ? match(i + 1, j) || (j < ps.length && match(i, j + 1))
      : j < ps.length && segment(gs[i], ps[j]) && match(i + 1, j + 1);
    memo.set(key, result); return result;
  }
  return match(0, 0);
}
export function createTaskScope(input = {}) {
  try {
    const root = projectRoot(input.project_dir);
    if (!ID.test(input.task_id || '') || !ID.test(input.capability_id || '')) throw new Error('invalid_scope_identity');
    if (input.project_id != null && (typeof input.project_id !== 'string' || !ID.test(input.project_id))) throw new Error('invalid_scope_project_id');
    const paths = values => normalizeSet(normalizeSet(values).map(p => pattern(root, p)));
    const scope = {
      schema: 'forgeos-task-scope', schema_version: 1,
      task_id: input.task_id, workspace: root.replace(/\\/g, '/'), project_id: input.project_id ?? null,
      context_fingerprint: scopeContextFingerprint(root),
      allowed_paths: paths(input.allowed_paths || []), denied_paths: paths(input.denied_paths || []),
      allowed_capabilities: normalizeSet(input.allowed_capabilities || [input.capability_id]),
      allowed_operations: normalizeSet(input.allowed_operations || (input.operation_id ? [input.operation_id] : [])),
      expected_effects: normalizeSet(input.expected_effects || []),
      permitted_action_classes: normalizeSet(input.permitted_action_classes || ['read', 'analyze', 'write', 'verify']),
    };
    if ([...scope.allowed_capabilities, ...scope.allowed_operations].some(id => !ID.test(id))) throw new Error('invalid_scope_identity');
    if (!scope.allowed_capabilities.includes(input.capability_id)
      || (input.operation_id && !scope.allowed_operations.includes(input.operation_id))) throw new Error('scope_identity_not_allowed');
    if (scope.permitted_action_classes.some(x => !['read','analyze','write','delete','execute','verify'].includes(x))) throw new Error('invalid_action_class');
    scope.fingerprint = fingerprintText(stableStringify(scope));
    return { ok: true, scope };
  } catch (e) { return { ok: false, reason: e.message, scope: null }; }
}
export function validateTaskScope(scope, context = {}) {
  try {
    if (!scope || scope.schema !== 'forgeos-task-scope' || scope.schema_version !== 1) throw new Error('invalid_task_scope');
    const { fingerprint, ...body } = scope;
    if (fingerprint !== fingerprintText(stableStringify(body))) throw new Error('scope_integrity_mismatch');
    const root = projectRoot(context.project_dir || scope.workspace);
    if (root !== projectRoot(scope.workspace)) throw new Error('scope_workspace_mismatch');
    if (scope.context_fingerprint !== scopeContextFingerprint(root)) throw new Error('stale_task_scope');
    if (context.task_id && scope.task_id !== context.task_id) throw new Error('scope_task_mismatch');
    if (context.capability_id && !scope.allowed_capabilities.includes(context.capability_id)) throw new Error('scope_capability_mismatch');
    if (context.operation_id && !scope.allowed_operations.includes(context.operation_id)) throw new Error('scope_operation_mismatch');
    const rebuilt = createTaskScope({ ...scope, project_dir: root, capability_id: scope.allowed_capabilities[0] });
    if (!rebuilt.ok || rebuilt.scope.fingerprint !== fingerprint) throw new Error('noncanonical_task_scope');
    return { ok: true, fingerprint };
  } catch (e) { return { ok: false, reason: e.message }; }
}
export function checkScopeContainment(scope, action = {}) {
  const validation = validateTaskScope(scope, action);
  if (!validation.ok) return validation;
  try {
    if (!scope.permitted_action_classes.includes(action.action_class)) throw new Error('scope_action_class_denied');
    if (action.path != null) {
      projectPath(action.project_dir || scope.workspace, action.path);
      const p = action.path.replace(/\\/g, '/');
      if (scope.denied_paths.some(g => matches(g, p))) throw new Error('scope_path_denied');
      if (!scope.allowed_paths.some(g => matches(g, p))) throw new Error('scope_path_outside');
    } else if (['read','write','delete'].includes(action.action_class)) throw new Error('scope_action_path_required');
    return { ok: true, contained: true, authorized: false, fingerprint: scope.fingerprint };
  } catch (e) { return { ok: false, contained: false, reason: e.message }; }
}
export function bindTaskScope(candidate, projectDir) {
  const built = createTaskScope({ project_dir: projectDir, task_id: candidate.task_id,
    capability_id: candidate.capability_id, operation_id: candidate.operation_id,
    project_id: candidate.policy_context?.project_id,
    allowed_paths: candidate.policy_context?.allowed_paths || [],
    denied_paths: candidate.policy_context?.forbidden_paths || [], expected_effects: candidate.expected_effects || [],
    permitted_action_classes: candidate.permitted_action_classes || ['read','analyze','write','verify'],
  });
  if (!built.ok) return built;
  if (candidate.task_scope && candidate.task_scope.fingerprint !== built.scope.fingerprint) return { ok: false, reason: 'task_scope_changed' };
  if (candidate.task_scope) {
    const valid = validateTaskScope(candidate.task_scope, { project_dir: projectDir, task_id: candidate.task_id, capability_id: candidate.capability_id, operation_id: candidate.operation_id });
    if (!valid.ok) return valid;
  }
  return built;
}
