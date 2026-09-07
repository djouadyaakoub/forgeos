/**
 * Deterministic queries over a Stage 20 dependency graph.
 *
 * Edge direction: importer → imported.
 * dependents(file)  = files that import `file` (incoming)
 * dependencies(file) = files `file` imports (outgoing)
 * ancestors(file)   = transitive dependents (who is affected if `file` changes)
 * descendants(file) = transitive dependencies (what `file` structurally depends on)
 */

function adj(graph) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const n of graph.nodes || []) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of graph.edges || []) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    if (e.resolved !== false) {
      outgoing.get(e.from).push(e.to);
      incoming.get(e.to).push(e.from);
    }
  }
  for (const [k, arr] of outgoing) outgoing.set(k, [...new Set(arr)].sort());
  for (const [k, arr] of incoming) incoming.set(k, [...new Set(arr)].sort());
  return { outgoing, incoming };
}

function walk(start, map) {
  const out = [];
  const seen = new Set();
  const queue = [...(map.get(start) || [])];
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id) || id === start) continue;
    seen.add(id);
    out.push(id);
    for (const n of map.get(id) || []) {
      if (!seen.has(n) && n !== start) queue.push(n);
    }
  }
  return out.sort();
}

export function dependencies(graph, file) {
  const { outgoing } = adj(graph);
  return [...(outgoing.get(String(file).replace(/\\/g, '/')) || [])];
}

export function dependents(graph, file) {
  const { incoming } = adj(graph);
  return [...(incoming.get(String(file).replace(/\\/g, '/')) || [])];
}

export function descendants(graph, file) {
  const { outgoing } = adj(graph);
  return walk(String(file).replace(/\\/g, '/'), outgoing);
}

export function ancestors(graph, file) {
  const { incoming } = adj(graph);
  return walk(String(file).replace(/\\/g, '/'), incoming);
}

/**
 * Normalized unique cycles (rotated so the lexicographically smallest node is first).
 */
export function findCycles(graph) {
  const { outgoing } = adj(graph);
  const nodes = [...outgoing.keys()].sort();
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  let idx = 0;
  const sccs = [];

  function strongconnect(v) {
    index.set(v, idx);
    lowlink.set(v, idx);
    idx += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of outgoing.get(v) || []) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
      else if (comp.length === 1 && (outgoing.get(comp[0]) || []).includes(comp[0])) {
        sccs.push(comp);
      }
    }
  }

  for (const v of nodes) {
    if (!index.has(v)) strongconnect(v);
  }

  const cycles = [];
  const seen = new Set();
  for (const c of sccs) {
    const key = c.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push({ nodes: c, size: c.length });
  }
  return cycles.sort((a, b) => a.nodes.join('|').localeCompare(b.nodes.join('|')));
}

/**
 * impact(file) = files structurally affected by changing `file`
 * = {file} ∪ ancestors(file)  (direct + transitive importers)
 */
export function filesAffectedByChange(graph, changedFiles = []) {
  const changed = [...new Set((changedFiles || []).map((f) => String(f).replace(/\\/g, '/')))].sort();
  const direct = new Set();
  const trans = new Set();
  for (const f of changed) {
    for (const d of dependents(graph, f)) {
      if (!changed.includes(d)) direct.add(d);
    }
    for (const a of ancestors(graph, f)) {
      if (!changed.includes(a) && !direct.has(a)) trans.add(a);
    }
  }
  const allDependents = [...new Set([...direct, ...trans])].sort();
  const impact_set = [...new Set([...changed, ...allDependents])].sort();
  return {
    changed_files: changed,
    direct_dependents: [...direct].sort(),
    transitive_dependents: [...trans].sort(),
    dependents: allDependents,
    impact_set,
    impact_direction: 'files_affected_by_changing_targets',
    note: 'Structural importers only — not behavioral, runtime, or business impact',
  };
}
