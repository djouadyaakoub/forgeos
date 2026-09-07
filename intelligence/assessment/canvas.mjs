/**
 * Derived Project Canvas — Stage 8
 *
 * Canvas is NEVER authoritative. Regenerated from assessment artifacts + PI + task history.
 */
import crypto from 'node:crypto';
import { CAPABILITY_STATES } from '../capability/binding.mjs';

export function buildCanvasItem(assessment = {}, resolution = null, taskCandidate = null) {
  const state = CAPABILITY_STATES.includes(assessment.state) ? assessment.state : 'UNKNOWN';
  const implementationType = resolution?.implementation_type || null;
  const invocation = resolution?.invocation || null;
  return {
    schema: 'canvas-item',
    schema_version: 1,
    capability_id: assessment.capability_id,
    canvas_category: assessment.canvas_category || 'uncategorized',
    applicability: assessment.applicability || 'UNKNOWN',
    state,
    confidence: assessment.confidence || 'LOW',
    severity: assessment.severity || 'info',
    evidence: assessment.evidence || [],
    evidence_timestamp: assessment.evidence_timestamp || null,
    freshness_ttl: assessment.freshness_ttl ?? 86400,
    stale: assessment.stale === true,
    rationale: assessment.rationale || '',
    recommended_action: assessment.recommended_action || null,
    implementation: resolution || null,
    implementation_display: implementationType
      ? String(implementationType).toUpperCase()
      : null,
    invocation_display: invocation
      ? String(invocation).toUpperCase()
      : null,
    available: resolution?.available ?? null,
    executable: resolution?.executable ?? null,
    task_candidate: taskCandidate,
    verification: assessment.verification || null,
    last_verified: assessment.last_verified || null,
    verified_by_task: assessment.verified_by_task || null,
    last_evidence_id: assessment.last_evidence_id || null,
    evidence_source: assessment.evidence_source || null,
    analyzer: assessment.analyzer || null,
    evidence_class: assessment.evidence_class || null,
    recommended_operation: assessment.recommended_operation || null,
    operation_candidates: assessment.operation_candidates || null,
    risk: taskCandidate?.risk || assessment.recommended_operation?.risk || null,
  };
}

export function buildProjectCanvas(assessments = [], meta = {}) {
  const items = assessments.map((a) =>
    buildCanvasItem(a.assessment, a.resolution, a.task_candidate)
  );
  const sorted = [...items].sort((a, b) => a.capability_id.localeCompare(b.capability_id));
  const summary = {
    total: sorted.length,
    satisfied: sorted.filter((i) => i.state === 'SATISFIED').length,
    partial: sorted.filter((i) => i.state === 'PARTIAL').length,
    needs_improvement: sorted.filter((i) => i.state === 'NEEDS_IMPROVEMENT').length,
    not_configured: sorted.filter((i) => i.state === 'NOT_CONFIGURED').length,
    not_applicable: sorted.filter((i) => i.state === 'NOT_APPLICABLE').length,
    unknown: sorted.filter((i) => i.state === 'UNKNOWN').length,
    stale: sorted.filter((i) => i.stale).length,
    actionable: sorted.filter((i) =>
      ['PARTIAL', 'NEEDS_IMPROVEMENT', 'NOT_CONFIGURED'].includes(i.state)
    ).length,
  };
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex')
    .slice(0, 24);
  return {
    schema: 'project-canvas',
    schema_version: 1,
    derived: true,
    authoritative: false,
    project_dir: meta.project_dir || null,
    project_id: meta.project_id || null,
    assessed_at: meta.assessed_at || new Date().toISOString(),
    forgeos_version: meta.forgeos_version || null,
    summary,
    items: sorted,
    task_candidates: sorted
      .map((i) => i.task_candidate)
      .filter(Boolean),
    fingerprint,
  };
}

export function formatCanvasText(canvas) {
  const lines = [];
  lines.push('ForgeOS Project Canvas (derived)');
  lines.push(`Project: ${canvas.project_id || canvas.project_dir || 'unknown'}`);
  lines.push(`Assessed: ${canvas.assessed_at}`);
  lines.push(
    `Summary: satisfied=${canvas.summary.satisfied} partial=${canvas.summary.partial} ` +
    `needs=${canvas.summary.needs_improvement} unknown=${canvas.summary.unknown} ` +
    `not_applicable=${canvas.summary.not_applicable} actionable=${canvas.summary.actionable}`
  );
  lines.push('');
  lines.push('Capability                     State               Impl            Invoc    Stale');
  lines.push('--------------------------------------------------------------------------------');
  for (const item of canvas.items) {
    const cap = item.capability_id.padEnd(28).slice(0, 28);
    const state = item.state.padEnd(18).slice(0, 18);
    const impl = String(item.implementation_display || '-').padEnd(14).slice(0, 14);
    const invoc = String(item.invocation_display || '-').padEnd(8).slice(0, 8);
    lines.push(`${cap} ${state} ${impl} ${invoc} ${item.stale ? 'YES' : 'NO'}`);
  }
  if (canvas.task_candidates.length) {
    lines.push('');
    lines.push('Recommended actions (not executed):');
    for (const t of canvas.task_candidates.slice(0, 10)) {
      lines.push(`- [${t.capability_id}] ${t.objective}`);
    }
  }
  lines.push('');
  lines.push('Default mode: assess + plan only. No automatic execution.');
  return lines.join('\n');
}
