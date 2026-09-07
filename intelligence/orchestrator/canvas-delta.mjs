/**
 * Derived Canvas delta — Stage 9/10
 *
 * A delta may not claim SATISFIED without verification PASS + evidence.
 */
export function buildCanvasDelta(beforeCanvas, afterCanvas, context = {}) {
  const beforeItems = new Map((beforeCanvas?.items || []).map((i) => [i.capability_id, i]));
  const afterItems = new Map((afterCanvas?.items || []).map((i) => [i.capability_id, i]));
  const ids = new Set([...beforeItems.keys(), ...afterItems.keys()]);
  const changes = [];
  const verification = context.verification || {};
  const verifiedPass = verification.result === 'PASS';

  for (const id of [...ids].sort()) {
    const before = beforeItems.get(id);
    const after = afterItems.get(id);
    const beforeState = before?.state || null;
    const afterState = after?.state || null;
    if (beforeState !== afterState) {
      const claimedSatisfied = afterState === 'SATISFIED';
      const verifiedTransition = claimedSatisfied && verifiedPass && Boolean(context.evidence_id);
      changes.push({
        capability_id: id,
        previous_state: beforeState,
        new_state: afterState,
        before_state: beforeState,
        after_state: afterState,
        before_confidence: before?.confidence || null,
        after_confidence: after?.confidence || null,
        verified_by_task: after?.verified_by_task || context.task_id || null,
        evidence_id: after?.last_evidence_id || context.evidence_id || null,
        verified_transition: verifiedTransition,
        verification_result: verification.result || after?.verification?.result || null,
        reason: verifiedTransition
          ? 'verification PASS'
          : (verification.result === 'FAIL'
            ? 'verification FAIL'
            : (verification.result === 'UNKNOWN' ? 'verification UNKNOWN' : 'state change')),
        timestamp: context.timestamp || afterCanvas?.assessed_at || null,
      });
    }
  }

  return {
    schema: 'canvas-delta',
    schema_version: 2,
    derived: true,
    authoritative: false,
    task_id: context.task_id || null,
    capability_id: context.capability_id || null,
    verification: verification.result || null,
    evidence_id: context.evidence_id || null,
    changed: changes.length > 0,
    changes,
  };
}

export function formatCanvasDelta(delta) {
  if (!delta?.changes?.length) {
    return 'Canvas delta: no capability state changes.';
  }
  const lines = ['Canvas delta:'];
  for (const c of delta.changes) {
    lines.push(`BEFORE:`);
    lines.push(`${c.capability_id}: ${c.before_state}`);
    lines.push(`AFTER:`);
    lines.push(`${c.capability_id}: ${c.after_state}`);
    lines.push(`Reason: ${c.reason}`);
    if (c.evidence_id) lines.push(`Evidence: ${c.evidence_id}`);
    lines.push(`Verified: ${c.verified_transition ? 'yes' : 'no'}`);
  }
  return lines.join('\n');
}
