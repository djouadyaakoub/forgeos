/** Exact high-risk intent and durable one-use evidence. NOT a Policy engine or identity provider. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectRoot, projectPath, readProjectText } from '../host/project-files.mjs';
import { safeId } from '../intelligence/assessment/local-store.mjs';
import { stableStringify } from '../intelligence/adapters/structural-facts.mjs';
import { checkScopeContainment } from './task-scope.mjs';

const STORE = '.agent-os/approvals';
const MAX_BYTES = 65536;
const digest = x => crypto.createHash('sha256').update(stableStringify(x)).digest('hex');
const fail = reason => { throw new Error(reason); };
export function canonicalApprovalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('approval_invalid_timestamp');
  return value;
}
/** Reject lossy/non-JSON inputs before canonicalization; bounded against hostile tool data. */
export function exactSnapshot(value) {
  let nodes = 0;
  const seen = new Set();
  function copy(v, depth = 0) {
    if (++nodes > 4096 || depth > 24) fail('approval_input_limit');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { if (v.length > 16384 || /[\x00-\x1f\x7f]/.test(v)) fail('approval_invalid_string'); return v; }
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v;
    if (!v || typeof v !== 'object' || seen.has(v)) fail('approval_non_json_input');
    seen.add(v);
    const array = Array.isArray(v);
    if (!array && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('approval_non_json_input');
    const keys = Reflect.ownKeys(v).filter(k => !(array && k === 'length'));
    if (array && (keys.length !== v.length || keys.some((k,i) => k !== String(i)))) fail('approval_sparse_input');
    const out = array ? [] : Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) fail('approval_non_json_input');
      out[key] = copy(d.value, depth + 1);
    }
    return out;
  }
  const result = copy(value);
  if (Buffer.byteLength(stableStringify(result)) > MAX_BYTES) fail('approval_input_limit');
  return result;
}
/** Supported shell subset only: no shell grammar, quoting, expansion or environment overrides. */
export function normalizeExactEvent(event, workspace) {
  const e = exactSnapshot(event);
  if (Object.keys(e).some(k => !['tool_name','tool_input'].includes(k))) fail('approval_unknown_event_field');
  if (!['Shell','Bash','exec_command'].includes(e.tool_name)) fail('exact_dispatch_unsupported_tool');
  const input = e.tool_input;
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['command','cmd','argv','cwd'].includes(k))) fail('approval_unknown_tool_input');
  if (['command','cmd','argv'].filter(k => Object.hasOwn(input,k)).length !== 1) fail('approval_ambiguous_command');
  if (input.cwd !== undefined && projectRoot(input.cwd) !== projectRoot(workspace)) fail('approval_workspace_mismatch');
  let argv = input.argv;
  if (argv === undefined) {
    const command = input.command ?? input.cmd;
    if (typeof command !== 'string') fail('approval_invalid_command');
    argv = command.trim().split(/ +/);
  }
  if (!Array.isArray(argv) || !argv.length || argv.length > 128
    || argv.some(a => typeof a !== 'string' || !/^[A-Za-z0-9_./:@+=,-]+$/.test(a))) fail('approval_ambiguous_command');
  return { action_class: 'execute', tool: 'shell', argv: [...argv] };
}
export function exactApprovalSubject(input) {
  const root = projectRoot(input.project_dir);
  const task_id = safeId(input.task_id), capability_id = safeId(input.capability_id), operation_id = safeId(input.operation_id);
  const normalized = normalizeExactEvent(input.event, root);
  if (!['git_push','git_force_push'].includes(input.action)
    || normalized.argv[0] !== 'git' || normalized.argv[1] !== 'push') fail('exact_action_dispatch_unsupported');
  const scope = checkScopeContainment(input.task_scope, { project_dir: root, task_id, capability_id, operation_id, action_class: 'execute' });
  if (!scope.ok) fail(scope.reason);
  const subject = { task_id, capability_id, operation_id, workspace_identity: root.replace(/\\/g,'/'),
    task_scope_fingerprint: scope.fingerprint, action: safeId(input.action), normalized_execution_input: normalized };
  return { ...subject, execution_input_fingerprint: digest(normalized), binding_fingerprint: digest(subject) };
}
export function previewExactApproval(input) {
  const subject = exactApprovalSubject(input);
  return { ...subject, target: subject.normalized_execution_input.argv.slice(2),
    one_use: true, retry: 'New approval required after dispatch, including unknown outcome.',
    identity: 'Explicit local operator assertion; not authenticated human identity.' };
}
function location(root, id, suffix) { return projectPath(root, `${STORE}/${safeId(id)}.${suffix}`); }
function exists(root,id,suffix) { return fs.existsSync(location(root,id,suffix)); }
function exclusive(root, id, suffix, value) {
  const target = location(root,id,suffix);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  location(root,id,suffix);
  if (fs.readdirSync(projectPath(root, STORE)).length >= 1024) fail('approval_store_limit');
  const bytes = Buffer.from(JSON.stringify(value)+'\n');
  if (bytes.length > MAX_BYTES) fail('approval_store_limit');
  const fd = fs.openSync(target, 'wx', 0o600);
  // Leave partial files closed, never delete/reopen intent on uncertain I/O failure.
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function issueExactApproval(input) {
  const preview = previewExactApproval(input);
  if (input.confirmed !== true || input.confirmation_fingerprint !== preview.binding_fingerprint) fail('exact_confirmation_required');
  const issued_at = canonicalApprovalTime(input.issued_at || new Date().toISOString());
  const expires_at = canonicalApprovalTime(input.expires_at);
  if (Date.parse(expires_at) <= Date.parse(issued_at) || Date.parse(expires_at) - Date.parse(issued_at) > 3600000) fail('approval_invalid_lifetime');
  const approval_id = crypto.randomUUID();
  const subject = exactApprovalSubject(input);
  const record = { schema:'forgeos-exact-approval', schema_version:1, approval_id, ...subject,
    issued_at, expires_at, approved_by:safeId(input.approved_by), status:'APPROVED' };
  record.record_fingerprint = digest(record);
  exclusive(subject.workspace_identity, approval_id, 'json', record);
  return { ok:true, approval:record, preview };
}
export function validateExactApproval(input) {
  try {
    const subject = exactApprovalSubject(input), id = safeId(input.approval_id), root = subject.workspace_identity;
    if (exists(root,id,'consumed')) fail('DENY_REPLAY');
    if (exists(root,id,'revoked')) fail('approval_revoked');
    const raw = readProjectText(root, `${STORE}/${id}.json`);
    if (!raw || Buffer.byteLength(raw)>MAX_BYTES) fail('exact_approval_missing_or_invalid');
    const row = JSON.parse(raw), { record_fingerprint, ...body } = row;
    if (record_fingerprint !== digest(body) || row.schema !== 'forgeos-exact-approval' || row.schema_version !== 1
      || row.approval_id !== id || row.status !== 'APPROVED') fail('approval_record_invalid');
    canonicalApprovalTime(row.issued_at); canonicalApprovalTime(row.expires_at);
    const now = Date.now();
    if (!Number.isFinite(now) || Date.parse(row.issued_at) > now || Date.parse(row.expires_at) <= now
      || Date.parse(row.expires_at) <= Date.parse(row.issued_at) || Date.parse(row.expires_at)-Date.parse(row.issued_at)>3600000) fail('approval_expired_or_invalid');
    for (const [key,value] of Object.entries(subject)) if (stableStringify(row[key]) !== stableStringify(value)) fail('approval_binding_mismatch');
    return { ok:true, approval:row, subject };
  } catch(e) { return { ok:false, reason:e.code === 'EEXIST' ? 'DENY_REPLAY' : e.message }; }
}
/** Prerequisite only: caller MUST re-evaluate Policy before this consume-before-dispatch point. */
export function consumeExactApproval(input) {
  let locked = false, root, id;
  try {
    root = projectRoot(input.project_dir); id = safeId(input.approval_id);
    exclusive(root,id,'lock',{state:'CONSUMPTION_OR_REVOCATION'}); locked = true;
    const checked = validateExactApproval(input);
    if (!checked.ok) return checked;
    const receipt = { schema:'forgeos-approval-consumption', approval_id:input.approval_id,
      binding_fingerprint:checked.subject.binding_fingerprint, execution_id:safeId(input.execution_id),
      task_id:checked.subject.task_id, operation_id:checked.subject.operation_id,
      workspace_fingerprint:digest(checked.subject.workspace_identity), consumed_at:new Date().toISOString(),
      state:'CONSUMED', result_state:'EXECUTION_OUTCOME_UNKNOWN_REAPPROVAL_REQUIRED', verification:'NOT_ESTABLISHED' };
    exclusive(checked.subject.workspace_identity,input.approval_id,'consumed',receipt);
    return { ok:true, receipt };
  } catch(e) { return {ok:false,reason:e.code==='EEXIST'?'DENY_REPLAY':'approval_consumption_failed_closed'}; }
  finally { if (locked) { try { fs.unlinkSync(location(root,id,'lock')); } catch { /* stale lock fails closed */ } } }
}
export function revokeExactApproval(projectDir,id) {
  const root = projectRoot(projectDir);
  exclusive(root,id,'lock',{state:'CONSUMPTION_OR_REVOCATION'});
  try {
    exclusive(root,id,'revoked',{status:'REVOKED',at:new Date().toISOString()});
    return {ok:true,status:'REVOKED'};
  } finally { try { fs.unlinkSync(location(root,id,'lock')); } catch { /* stale lock fails closed */ } }
}
