/**
 * Capability dependency planner — Stage 11
 *
 * Deterministic topological ordering with cycle detection and dedupe.
 * Planning only — not policy authorization and not execution.
 */
export const PLANNER_SCHEMA = 'forgeos-capability-dependency-plan';

/**
 * Build an ordered capability plan from selected capabilities + requires edges.
 *
 * @param {object} input
 * @param {Array<{capability_id: string, requires?: string[], assessment_state?: string, reason?: string}>} input.selected
 * @param {object} [input.bindings] — optional full binding set for requires lookup
 */
export function planCapabilityDependencies(input = {}) {
  const selected = dedupeById(input.selected || []);
  const bindingRequires = new Map();
  for (const b of input.bindings?.capabilities || []) {
    bindingRequires.set(b.id, [...(b.requires || [])]);
  }

  const nodes = new Map();
  for (const item of selected) {
    const requires = unique([
      ...(item.requires || []),
      ...(bindingRequires.get(item.capability_id) || []),
    ]);
    nodes.set(item.capability_id, {
      capability_id: item.capability_id,
      requires,
      assessment_state: item.assessment_state || null,
      reason: item.reason || null,
      severity: item.assessment_severity || item.severity || null,
      binding: item.binding || null,
      include_for_dependency: item.include_for_dependency === true,
      dependency_of: item.dependency_of || null,
    });
  }

  // Edges: dependency -> dependent (for Kahn)
  const indegree = new Map();
  const dependents = new Map();
  for (const id of nodes.keys()) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }

  const unresolvedDependencies = [];
  for (const node of nodes.values()) {
    for (const req of node.requires) {
      if (!nodes.has(req)) {
        unresolvedDependencies.push({
          capability_id: node.capability_id,
          missing_dependency: req,
          reason: 'dependency_not_in_selected_set',
        });
        continue;
      }
      dependents.get(req).push(node.capability_id);
      indegree.set(node.capability_id, (indegree.get(node.capability_id) || 0) + 1);
    }
  }

  // Stable Kahn: always pick lexicographically smallest ready node
  const ready = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const ordered = [];
  const visited = new Set();

  while (ready.length) {
    const id = ready.shift();
    visited.add(id);
    ordered.push(nodes.get(id));
    for (const dep of (dependents.get(id) || []).slice().sort()) {
      indegree.set(dep, indegree.get(dep) - 1);
      if (indegree.get(dep) === 0) {
        ready.push(dep);
        ready.sort();
      }
    }
  }

  const cycleIds = [...nodes.keys()].filter((id) => !visited.has(id)).sort();
  const cycleDetected = cycleIds.length > 0;

  // Parallelism hint: nodes with empty requires among ordered set (planning only)
  const independent = ordered
    .filter((n) => (n.requires || []).filter((r) => nodes.has(r)).length === 0)
    .map((n) => n.capability_id);

  const edges = [];
  for (const node of ordered) {
    for (const req of node.requires) {
      if (nodes.has(req)) {
        edges.push({ from: req, to: node.capability_id });
      }
    }
  }

  return {
    schema: PLANNER_SCHEMA,
    schema_version: 1,
    ordered_capability_ids: ordered.map((n) => n.capability_id),
    ordered,
    dependencies: edges,
    cycle_detected: cycleDetected,
    cycle_capability_ids: cycleIds,
    unresolved_dependencies: unresolvedDependencies,
    independent_capability_ids: independent,
    duplicate_eliminated: (input.selected || []).length !== selected.length,
  };
}

function unique(list) {
  return [...new Set((list || []).map(String).filter(Boolean))];
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.capability_id) continue;
    if (!map.has(item.capability_id)) map.set(item.capability_id, item);
  }
  return [...map.values()];
}

/**
 * Detect cycles in a requires graph (adjacency: id -> requires[]).
 */
export function detectCapabilityCycles(graph = {}) {
  const ids = Object.keys(graph).sort();
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  let cycle = null;

  function dfs(id) {
    if (cycle) return;
    visiting.add(id);
    stack.push(id);
    for (const req of graph[id] || []) {
      if (!graph[req] && !ids.includes(req)) continue;
      if (visiting.has(req)) {
        cycle = [...stack.slice(stack.indexOf(req)), req];
        return;
      }
      if (!visited.has(req)) dfs(req);
    }
    visiting.delete(id);
    visited.add(id);
    stack.pop();
  }

  for (const id of ids) {
    if (!visited.has(id)) dfs(id);
  }
  return { cycle_detected: Boolean(cycle), cycle };
}
