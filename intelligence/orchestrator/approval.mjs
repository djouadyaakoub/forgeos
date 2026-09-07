/**
 * Explicit task-scoped approval — Stage 9
 *
 * Approval is an input to Policy Authority, never a substitute for it.
 * Task A approval cannot authorize Task B.
 */
import crypto from 'node:crypto';
import { canonicalApprovalTime } from '../../policy/exact-approval.mjs';

export const APPROVAL_SCHEMA = 'forgeos-task-approval';
export const DEFAULT_APPROVAL_TTL_MS = 60 * 60 * 1000;

export function createTaskApproval(input = {}) {
  const taskId = String(input.task_id || '').trim();
  const capabilityId = String(input.capability_id || '').trim();
  if (!taskId || !capabilityId) {
    return { valid: false, error: 'task_id_and_capability_id_required', approval: null };
  }
  if (input.approved !== true) {
    return { valid: false, error: 'approval_not_granted', approval: null };
  }

  const approvedAt = input.approved_at || new Date().toISOString();
  const ttlMs = Number(input.ttl_ms ?? DEFAULT_APPROVAL_TTL_MS);
  try { canonicalApprovalTime(approvedAt); if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_APPROVAL_TTL_MS) throw new Error(); }
  catch { return {valid:false,error:'approval_invalid_timestamp',approval:null}; }
  const expiresAt = input.expires_at
    || new Date(Date.parse(approvedAt) + ttlMs).toISOString();
  try { canonicalApprovalTime(expiresAt); if (Date.parse(expiresAt) <= Date.parse(approvedAt)) throw new Error(); }
  catch { return {valid:false,error:'approval_invalid_timestamp',approval:null}; }

  const approval = {
    schema: APPROVAL_SCHEMA,
    schema_version: 1,
    task_id: taskId,
    capability_id: capabilityId,
    approved: true,
    approved_by: String(input.approved_by || 'unspecified'),
    approved_at: approvedAt,
    expires_at: expiresAt,
    operation_fingerprint: input.operation_fingerprint || null,
    nonce: input.nonce || crypto.randomBytes(8).toString('hex'),
    transferable: false,
    blanket: false,
  };

  return { valid: true, error: null, approval };
}

export function validateTaskApproval(approval, candidate, options = {}) {
  const now = options.now ?? Date.now();

  if (!approval) {
    return { ok: false, reason: 'approval_missing' };
  }
  if (approval.blanket === true || approval.global === true) {
    return { ok: false, reason: 'blanket_approval_forbidden' };
  }
  if (approval.approved !== true) {
    return { ok: false, reason: 'approval_not_granted' };
  }
  if (!candidate?.task_id) {
    return { ok: false, reason: 'candidate_missing' };
  }
  if (String(approval.task_id) !== String(candidate.task_id)) {
    return { ok: false, reason: 'approval_task_mismatch' };
  }
  if (String(approval.capability_id) !== String(candidate.capability_id)) {
    return { ok: false, reason: 'approval_capability_mismatch' };
  }
  const expires = Date.parse(approval.expires_at || '');
  try { canonicalApprovalTime(approval.expires_at); canonicalApprovalTime(approval.approved_at); }
  catch { return {ok:false,reason:'approval_invalid_timestamp'}; }
  if (!Number.isFinite(now) || Date.parse(approval.approved_at) > now || expires <= Date.parse(approval.approved_at))
    return {ok:false,reason:'approval_invalid_timestamp'};
  if (now >= expires) {
    return { ok: false, reason: 'approval_expired' };
  }
  if (
    candidate.operation_fingerprint &&
    approval.operation_fingerprint &&
    candidate.operation_fingerprint !== approval.operation_fingerprint
  ) {
    return { ok: false, reason: 'approval_operation_mismatch' };
  }

  return {
    ok: true,
    reason: 'approved',
    approval,
    note: 'Approval is task-scoped and does not bypass Policy Authority',
  };
}
