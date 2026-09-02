/**
 * Evidence resolver — merge sources, detect contradictions
 */
import { compareSourcePriority, CONFIDENCE_LEVELS } from './intelligence-model.mjs';
import { dedupeById } from './capability-normalizer.mjs';

export function mergeCapabilities(sources = []) {
  const all = sources.flat();
  const byId = new Map();
  const contradictions = [];

  for (const cap of all) {
    if (!cap?.id) continue;
    const existing = byId.get(cap.id);
    if (!existing) {
      byId.set(cap.id, { ...cap, evidence: [...(cap.evidence || [])] });
      continue;
    }

    const merged = mergeCapabilityPair(existing, cap);
    if (merged.contradiction) contradictions.push(merged.contradiction);
    byId.set(cap.id, merged.result);
  }

  return {
    capabilities: [...byId.values()],
    contradictions,
  };
}

function mergeCapabilityPair(a, b) {
  const better = compareSourcePriority(a.source_type, b.source_type) <= 0 ? a : b;
  const other = better === a ? b : a;
  const contradiction =
    a.agent && b.agent && a.agent !== b.agent
      ? {
          type: 'capability_agent_conflict',
          capability: a.id,
          message: `Capability ${a.id} maps to agents ${a.agent} vs ${b.agent}`,
          sources: [a.source, b.source],
        }
      : null;

  const pathsA = new Set(a.paths || []);
  const pathsB = new Set(b.paths || []);
  const pathConflict =
    pathsA.size && pathsB.size && ![...pathsA].some((p) => pathsB.has(p))
      ? {
          type: 'capability_path_conflict',
          capability: a.id,
          message: `Conflicting paths for ${a.id}`,
          sources: [a.source, b.source],
        }
      : null;

  const contradictions = [contradiction, pathConflict].filter(Boolean);

  return {
    result: {
      ...better,
      paths: [...new Set([...(a.paths || []), ...(b.paths || [])])],
      domains: [...new Set([...(a.domains || []), ...(b.domains || [])])],
      verification: [...new Set([...(a.verification || []), ...(b.verification || [])])],
      evidence: [...new Set([...(a.evidence || []), ...(b.evidence || [])])],
      confidence: Math.max(a.confidence || 0, b.confidence || 0),
      confidence_level:
        (a.confidence || 0) >= 0.9 || (b.confidence || 0) >= 0.9
          ? CONFIDENCE_LEVELS.VERIFIED
          : CONFIDENCE_LEVELS.INFERRED,
      inferred: (a.inferred && b.inferred) || false,
      merged_from: [a.source, b.source].filter((s, i, arr) => arr.indexOf(s) === i),
    },
    contradiction: contradictions[0] || null,
    extra_contradictions: contradictions.slice(1),
  };
}

export function mergeOwnership(entries = []) {
  const byPath = new Map();
  const contradictions = [];

  for (const o of entries) {
    if (!o) continue;
    const paths = o.paths?.length ? o.paths : o.path ? [o.path] : [];
    for (const p of paths) {
      const norm = p.replace(/\\/g, '/');
      const existing = byPath.get(norm);
      if (!existing) {
        byPath.set(norm, { ...o, path: norm, paths: [norm] });
        continue;
      }
      if (existing.agent && o.agent && existing.agent !== o.agent) {
        contradictions.push({
          type: 'ownership_conflict',
          path: norm,
          message: `Path ${norm} owned by ${existing.agent} vs ${o.agent}`,
          sources: [existing.source, o.source],
        });
      } else {
        byPath.set(norm, {
          ...existing,
          confidence: Math.max(existing.confidence || 0, o.confidence || 0),
          evidence: [...new Set([...(existing.evidence || []), ...(o.evidence || [])])],
        });
      }
    }
  }

  return { ownership: [...byPath.values()], contradictions };
}

export function mergeAgents(agentLists = []) {
  const byId = new Map();
  const contradictions = [];

  for (const agents of agentLists) {
    for (const agent of agents) {
      if (!agent?.id) continue;
      const existing = byId.get(agent.id);
      if (!existing) {
        byId.set(agent.id, { ...agent });
        continue;
      }
      if (existing.source_type === 'project_registry' && agent.source_type !== 'project_registry') {
        byId.set(agent.id, {
          ...existing,
          capabilities: [...new Set([...(existing.capabilities || []), ...(agent.capabilities || [])])],
          evidence: [...new Set([...(existing.evidence || []), ...(agent.evidence || [])])],
        });
      } else if (agent.confidence > (existing.confidence || 0)) {
        byId.set(agent.id, {
          ...agent,
          capabilities: [...new Set([...(existing.capabilities || []), ...(agent.capabilities || [])])],
        });
      }
    }
  }

  return { agents: [...byId.values()], contradictions };
}

export function resolveEvidenceSets({ capabilities = [], agents = [], ownership = [], verification = [] }) {
  const capResult = mergeCapabilities(capabilities);
  const ownResult = mergeOwnership(ownership);
  const agentResult = mergeAgents(agents);

  const allContradictions = [
    ...capResult.contradictions,
    ...ownResult.contradictions,
    ...agentResult.contradictions,
  ];

  return {
    capabilities: dedupeById(capResult.capabilities),
    agents: dedupeById(agentResult.agents),
    ownership: ownResult.ownership,
    verification: dedupeById(verification, 'command'),
    contradictions: allContradictions,
  };
}

export function explainContradiction(c) {
  return `${c.type}: ${c.message} (${(c.sources || []).join(' vs ')})`;
}
