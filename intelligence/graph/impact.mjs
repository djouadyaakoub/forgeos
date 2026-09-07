/**
 * Change-impact set from StructuralFacts via the Stage 20 graph.
 * Graph proves structural dependency, not semantic/runtime impact.
 */
import { buildDependencyGraph } from './builder.mjs';
import { filesAffectedByChange } from './queries.mjs';

export function computeChangeImpactSet(facts, changedFiles = []) {
  const changed = [...new Set((changedFiles || []).map((f) => String(f).replace(/\\/g, '/')))].sort();
  if (!facts || !changed.length) {
    return {
      changed_files: changed,
      dependents: [],
      direct_dependents: [],
      transitive_dependents: [],
      impact_set: changed,
      evidence_class: facts?.evidence_class || 'insufficient',
      impact_direction: 'files_affected_by_changing_targets',
      note: 'Impact set is intelligence only — not authorization',
    };
  }

  const graph = buildDependencyGraph(facts);
  const impact = filesAffectedByChange(graph, changed);
  return {
    ...impact,
    graph_fingerprint: graph.graph_fingerprint,
    evidence_class: facts.evidence_class === 'deterministic' ? 'deterministic' : (facts.evidence_class || 'heuristic'),
    note: 'Impact set is intelligence only — not authorization',
  };
}
