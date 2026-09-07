/** Project-scoped trust partition. Interpretations never merge into facts. */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, projectPath, readProjectText } from '../../host/project-files.mjs';
import { collectProjectFacts, fingerprintText } from './facts.mjs';
import { runStructuralAnalysis } from '../adapters/index.mjs';
import { stableStringify } from '../adapters/structural-facts.mjs';
import { buildDependencyGraph } from '../graph/builder.mjs';

const snapshots = new WeakSet();
const OMIT = new Set(['.git','node_modules','dist','build','coverage','vendor','.next','__pycache__','release']);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
function inventory(root, limit) {
  const included = [], omitted = [];
  function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
    catch { omitted.push({ path: path.relative(root, dir).replace(/\\/g, '/'), reason: 'unreadable' }); return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name), rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) { omitted.push({ path: rel, reason: 'symlink' }); continue; }
      if (rel === '.agent-os/interpretations.json' || rel === '.agent-os/knowledge' || rel === '.agent-os/discovery') continue; // Non-fact stores; no self-invalidating fingerprint.
      if (OMIT.has(entry.name) || rel.startsWith('docs/project/')) { omitted.push({ path: rel, reason: 'excluded_generated_or_dependency' }); continue; }
      if (included.length >= limit || depth > 12) { omitted.push({ path: rel, reason: 'limit' }); continue; }
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        try {
          projectPath(root, rel);
          if (fs.statSync(full).size > 1024 * 1024) { omitted.push({ path: rel, reason: 'file_size_limit' }); continue; }
          included.push({ path: rel, fingerprint: fingerprintText(fs.readFileSync(full).toString('base64')) });
        } catch { omitted.push({ path: rel, reason: 'unsafe_or_unreadable' }); }
      }
    }
  }
  walk(root, 0);
  return { included, omitted, truncated: omitted.some(x => /limit/.test(x.reason)),
    status: omitted.length ? 'PARTIAL' : 'COMPLETE_WITHIN_DECLARED_SCOPE',
    limits: { max_files: limit, max_depth: 12, max_file_bytes: 1048576 } };
}
export function collectKnowledgeFacts(projectDir, options = {}) {
  const root = projectRoot(projectDir);
  const limit = options.max_files ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('invalid_analysis_limit');
  const scope = inventory(root, limit);
  const config = readProjectText(root, '.agent-os/project.yaml') ?? readProjectText(root, '.agent-os/project.json') ?? '';
  const base = collectProjectFacts(root);
  // Analyze only inventoried paths and never reuse a potentially stale structural cache.
  const structural = scope.included.length ? runStructuralAnalysis({ project_dir: root, files: scope.included.map(x => x.path),
    max_files: limit, use_cache: false, persist_cache: false }) : { ok: false, facts: null, reason: 'no_included_files' };
  const sf = structural.facts;
  const graph = sf ? buildDependencyGraph(sf) : null;
  scope.unsupported = [...(sf?.diagnostics || []), ...(sf?.files || []).filter(f => !f.examined)
    .map(f => ({ file: f.path, code: 'not_structurally_examined', reason: 'adapter_language_size_or_empty_file_limit' }))];
  if (!structural.ok || scope.unsupported.length) scope.status = 'PARTIAL';
  const payload = { workspace: root.replace(/\\/g, '/'), project_id: base.project_id,
    configuration_fingerprint: fingerprintText(config), filesystem: scope.included,
    structural: sf ? { analyzer: sf.analyzer, files: sf.files, imports: sf.imports, exports: sf.exports,
      symbols: sf.symbols, analysis_fingerprint: sf.analysis_fingerprint, evidence_class: sf.evidence_class } : null,
    graph: graph ? { graph_fingerprint: graph.graph_fingerprint, nodes: graph.nodes, edges: graph.edges } : null,
    analysis_scope: scope,
    provenance: { collector: 'forgeos', structural_adapter: structural.adapter_id || null,
      semantics: 'deterministic_observations_not_policy_or_semantic_truth' } };
  const snapshot = freeze({ schema: 'forgeos-knowledge-facts', schema_version: 1,
    fingerprint: fingerprintText(stableStringify(payload)), ...payload });
  snapshots.add(snapshot);
  return snapshot;
}
export function partitionProjectKnowledge(facts, entries = []) {
  if (!snapshots.has(facts)) throw new Error('facts_must_come_from_collector');
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error('invalid_interpretation_list');
  const seen = new Set();
  const interpretations = entries.map(raw => {
    try {
      const allowed = ['id','kind','text','workspace','based_on_fact_fingerprint','confidence','evidence_refs','provenance'];
      if (!raw || Object.keys(raw).some(k => !allowed.includes(k))) throw new Error('unknown_interpretation_field');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(raw.id || '') || seen.has(raw.id)) throw new Error('duplicate_or_invalid_interpretation_id');
      seen.add(raw.id);
      if (!['hypothesis','conclusion','learning'].includes(raw.kind) || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 8000) throw new Error('invalid_interpretation');
      if (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw new Error('invalid_confidence');
      if (!raw.provenance || !['human','heuristic','llm'].includes(raw.provenance.kind)
        || typeof raw.provenance.source !== 'string' || !raw.provenance.source.trim()
        || raw.provenance.source.length > 512 || typeof raw.provenance.observed_at !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T/.test(raw.provenance.observed_at)
        || !Number.isFinite(Date.parse(raw.provenance.observed_at))) throw new Error('invalid_provenance');
      if (!Array.isArray(raw.evidence_refs) || !raw.evidence_refs.length || raw.evidence_refs.some(x => typeof x !== 'string')) throw new Error('evidence_required');
      const state = raw.workspace !== facts.workspace ? 'QUARANTINED'
        : !/^[a-f0-9]{16}$/.test(raw.based_on_fact_fingerprint || '') ? 'INVALID'
          : raw.based_on_fact_fingerprint !== facts.fingerprint ? 'STALE'
            : raw.evidence_refs.some(ref => !facts.filesystem.some(f => f.path === ref)) ? 'QUARANTINED' : 'CURRENT';
      return { id: raw.id, kind: raw.kind, text: raw.text, confidence: raw.confidence,
        evidence_refs: [...new Set(raw.evidence_refs)].sort(), provenance: { kind: raw.provenance.kind,
          source: raw.provenance.source, observed_at: raw.provenance.observed_at },
        workspace: raw.workspace, based_on_fact_fingerprint: raw.based_on_fact_fingerprint,
        state, authoritative: false, promotion: 'never_to_facts' };
    } catch (e) { return { id: typeof raw?.id === 'string' ? raw.id.slice(0,160) : null, state: 'INVALID', reason: e.message, authoritative: false }; }
  });
  return freeze({ schema: 'forgeos-project-knowledge', schema_version: 1, facts, interpretations,
    policy_authority: false, verification_authority: false, learning_scope: 'project_only' });
}
export function assessProjectKnowledge(projectDir, options = {}) {
  const facts = collectKnowledgeFacts(projectDir, options);
  let entries = options.interpretations;
  if (entries === undefined) {
    const text = readProjectText(projectDir, '.agent-os/interpretations.json');
    try { entries = text === null ? [] : JSON.parse(text); }
    catch { entries = [{ id: 'invalid-store', invalid: true }]; }
  }
  if (!Array.isArray(entries)) entries = [{ id: 'invalid-store', invalid: true }];
  return partitionProjectKnowledge(facts, entries);
}
