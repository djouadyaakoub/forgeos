/** Independently authored project interpretation lifecycle. No interpretation is fact or instruction. */
import { randomUUID } from 'node:crypto';
import { projectRoot, projectPath, readProjectText } from '../../host/project-files.mjs';
import { collectKnowledgeFacts, partitionProjectKnowledge } from './knowledge.mjs';
import { safeId, compactText, readLocalStore, updateLocalStore } from './local-store.mjs';
import { validateGovernanceEvidence } from '../orchestrator/governance-evidence.mjs';
import { loadHostHandoff, validateHostHandoff } from '../orchestrator/host-handoff.mjs';
import { collectProjectFacts, fingerprintText } from './facts.mjs';
import { stableStringify } from '../adapters/structural-facts.mjs';
import { computeInputFingerprint } from './evidence.mjs';
import { computeEvidenceFingerprint } from '../orchestrator/fingerprints.mjs';
import { loadCapabilityBindings, capabilityBindingFingerprint } from '../capability/binding.mjs';
import { checkScopeContainment } from '../../policy/task-scope.mjs';
const STORE = '.agent-os/knowledge/records.json';
const fields = ['id','kind','text','workspace','based_on_fact_fingerprint','confidence','evidence_refs','provenance'];
const projection = row => Object.fromEntries(fields.map(k => [k, row[k]]));
const reviewFingerprint = row => fingerprintText(stableStringify({ candidate:projection(row), lineage:row.lineage, scope:row.scope }));
function lineage(root, row) {
  if (!row.lineage) return;
  const l = row.lineage;
  if (Object.keys(l).some(k => !['task_id','capability_id','evidence_id','scope_fingerprint','execution_id'].includes(k))) throw new Error('invalid_lineage');
  if (!/^[a-f0-9]{24}$/.test(l.evidence_id || '')) throw new Error('invalid_evidence_id');
  const evidence = JSON.parse(readProjectText(root, `docs/project/assessments/governance-evidence-${l.evidence_id}.json`) || 'null');
  const handoff = loadHostHandoff(root, l.task_id);
  const valid = validateHostHandoff(handoff, { project_dir: root, expected_task_id: l.task_id, expected_capability_id: l.capability_id });
  if (!valid.ok || l.execution_id !== `host-interactive:${l.task_id}`) throw new Error('invalid_task_lineage');
  for (const p of handoff.verification_presence || []) projectPath(root,p);
  for (const ref of row.evidence_refs) {
    if (!checkScopeContainment(handoff.task_scope,{project_dir:root,path:ref,action_class:'read'}).ok) throw new Error('evidence_outside_task_scope');
  }
  const bindings = loadCapabilityBindings(), facts = collectProjectFacts(root);
  const fingerprints = computeEvidenceFingerprint(facts,{project_dir:root,verification_strategy:handoff.verification_strategy,
    verification_presence:handoff.verification_presence,verification_commands:handoff.verification_commands,
    input_fingerprint:computeInputFingerprint(facts,bindings),capability_binding_fingerprint:capabilityBindingFingerprint(bindings),bindings});
  const ev = validateGovernanceEvidence(evidence, { expected_task_id: l.task_id, expected_capability_id: l.capability_id, expected_execution_id: l.execution_id, fingerprints });
  if (!Number.isFinite(Date.parse(evidence?.timestamps?.verified_at)) || Date.parse(evidence.timestamps.verified_at)>Date.now()) throw new Error('invalid_evidence_time');
  if (!valid.ok || !ev.accept_satisfied || !l.scope_fingerprint || evidence.task_scope_fingerprint !== l.scope_fingerprint
    || handoff.task_scope.fingerprint !== l.scope_fingerprint || handoff.last_evidence_id !== l.evidence_id
    || evidence.evidence_id !== l.evidence_id) throw new Error('evidence_lineage_invalid_or_stale');
}
function inspectRow(root, facts, row) {
  try {
    if (!row || Object.keys(row).some(k => ![...fields,'lineage','scope','reviews'].includes(k))) throw new Error('unknown_knowledge_field');
    safeId(row.id); compactText(row.text); compactText(row.provenance?.source, 120);
    if (!row.scope || Object.keys(row.scope).some(k => !['paths','capability_id'].includes(k))
      || !Array.isArray(row.scope.paths) || row.scope.paths.length > 64) throw new Error('invalid_knowledge_scope');
    for (const ref of row.scope.paths) projectPath(root, ref);
    if (row.scope.capability_id !== null) safeId(row.scope.capability_id);
    if (!Array.isArray(row.reviews) || row.reviews.length > 64) throw new Error('invalid_review_history');
    for (const r of row.reviews) {
      if (Object.keys(r).some(k => !['decision','actor','at','note','candidate_fingerprint'].includes(k)) || !['ACCEPTED','REJECTED'].includes(r.decision)
        || !['human','agent'].includes(r.actor?.kind) || r.actor?.confirmed !== true
        || Object.keys(r.actor).some(k=>!['kind','id','confirmed'].includes(k))
        || (r.decision === 'ACCEPTED' && (r.actor.kind !== 'human' || r.actor.id === row.provenance.source))
        || ((r.decision === 'ACCEPTED' || r.candidate_fingerprint !== undefined) && r.candidate_fingerprint !== reviewFingerprint(row))
        || !Number.isFinite(Date.parse(r.at))) throw new Error('invalid_review');
      safeId(r.actor.id); compactText(r.note, 500);
    }
    const p = partitionProjectKnowledge(facts, [projection(row)]).interpretations[0];
    if (p.state === 'INVALID' || p.state === 'QUARANTINED') return { ...p, review_status: 'UNREVIEWED' };
    // Historical stale accepted knowledge remains readable; it cannot enter current retrieval.
    if (p.state === 'CURRENT') lineage(root, row);
    return { ...p, scope: row.scope, lineage: row.lineage, reviews: row.reviews,
      review_status: row.reviews.at(-1)?.decision || 'UNREVIEWED', instruction_authority: false };
  } catch (e) { return { id: row?.id, state: 'INVALID', review_status: 'UNREVIEWED', reason: e.message, authoritative: false }; }
}
export function listKnowledge(projectDir, options = {}) {
  const root = projectRoot(projectDir), facts = collectKnowledgeFacts(root, options);
  const rows = readLocalStore(root, STORE), ids = new Set();
  const interpretations = rows.map(row => {
    if (ids.has(row?.id)) throw new Error('duplicate_knowledge_id');
    ids.add(row?.id); return inspectRow(root, facts, row);
  });
  return { ok: true, facts, interpretations, policy_authority: false, verification_authority: false };
}
export function writeKnowledgeCandidate(projectDir, input = {}) {
  if (Object.keys(input).some(k => !['id','kind','text','confidence','evidence_refs','source','source_kind','lineage','capability_id'].includes(k))) throw new Error('unknown_candidate_field');
  const root = projectRoot(projectDir), facts = collectKnowledgeFacts(root);
  const row = { id: safeId(input.id || randomUUID()), kind: input.kind || 'learning', text: compactText(input.text),
    workspace: facts.workspace, based_on_fact_fingerprint: facts.fingerprint, confidence: input.confidence ?? 0.5,
    evidence_refs: input.evidence_refs, provenance: { kind: input.source_kind || 'llm', source: compactText(input.source,120), observed_at: new Date().toISOString() },
    lineage: input.lineage || null, scope: { paths: input.evidence_refs, capability_id: input.capability_id || null }, reviews: [] };
  const checked = inspectRow(root, facts, row);
  if (checked.state !== 'CURRENT') throw new Error(checked.reason || 'candidate_evidence_not_current');
  updateLocalStore(root, STORE, rows => { if (rows.some(r => r.id === row.id)) throw new Error('duplicate_knowledge_id'); return [...rows, row]; });
  return { ok: true, status: 'KNOWLEDGE_REVIEW_REQUIRED', candidate: checked };
}
export function reviewKnowledge(projectDir, id, decision, actor, note) {
  safeId(id);
  if (!['ACCEPTED','REJECTED'].includes(decision) || !['human','agent'].includes(actor?.kind) || actor.confirmed !== true
    || (decision === 'ACCEPTED' && actor.kind !== 'human')) throw new Error('explicit_human_review_required');
  safeId(actor.id); compactText(note,500);
  const root = projectRoot(projectDir), facts = collectKnowledgeFacts(root);
  updateLocalStore(root, STORE, rows => {
    const row = rows.find(r => r.id === id);
    if (!row) throw new Error('knowledge_not_found');
    if (decision === 'ACCEPTED' && actor.id === row.provenance.source) throw new Error('self_review_forbidden');
    const current = inspectRow(root, facts, row);
    if (decision === 'ACCEPTED' && current.state !== 'CURRENT') throw new Error('knowledge_not_current');
    if (!Array.isArray(row.reviews) || row.reviews.length >= 64) throw new Error('review_history_limit');
    row.reviews.push({ decision, actor: { kind: actor.kind, id: actor.id, confirmed: true }, at: new Date().toISOString(), note,
      candidate_fingerprint:reviewFingerprint(row) }); return rows;
  });
  return { ok: true, id, review_status: decision, authoritative: false };
}
export function retrieveKnowledge(projectDir, query = {}) {
  const maxCount = query.max_count ?? 5, maxBytes = query.max_bytes ?? 6000;
  if (!Number.isInteger(maxCount) || maxCount < 0 || maxCount > 20 || !Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > 32000) throw new Error('invalid_retrieval_budget');
  const state = listKnowledge(projectDir), items = [], omitted = []; let bytes = 0;
  const paths = query.paths || [];
  if (!Array.isArray(paths) || paths.length > 64) throw new Error('invalid_retrieval_paths');
  for (const p of paths) projectPath(projectDir, p);
  for (const row of [...state.interpretations].sort((a,b) => String(a.id).localeCompare(String(b.id)))) {
    const relevant = (!query.capability_id && !query.task_id && !paths.length)
      || (query.capability_id && row.scope?.capability_id === query.capability_id)
      || (query.task_id && row.lineage?.task_id === query.task_id) || paths.some(p => row.scope?.paths.includes(p));
    const item = { id: row.id, kind: row.kind, text: row.text, evidence_refs: row.evidence_refs, lineage: row.lineage,
      based_on_fact_fingerprint: row.based_on_fact_fingerprint, authoritative: false, use: 'accepted_interpretation_not_instruction' };
    const size = Buffer.byteLength(JSON.stringify(item)) + (items.length ? 1 : 0);
    const reason = row.state !== 'CURRENT' ? row.state : row.review_status !== 'ACCEPTED' ? row.review_status
      : !relevant ? 'irrelevant' : items.length >= maxCount || bytes + size > maxBytes ? 'budget' : null;
    if (reason) omitted.push({ id: row.id, reason }); else { items.push(item); bytes += size; }
  }
  return { ok: true, items, omitted, truncated: omitted.some(x => x.reason === 'budget'), bytes,
    limits: { max_count: maxCount, max_bytes: maxBytes }, fact_fingerprint: state.facts.fingerprint,
    authority: 'interpretation_only_facts_policy_scope_verification_always_win' };
}
