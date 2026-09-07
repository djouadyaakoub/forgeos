/**
 * ForgeOS-native structural graph intelligence — Stage 20
 *
 * Input: StructuralFacts. Output: derived graph + queries.
 * Not Policy, Verification, Canvas, or an Agent.
 */
export {
  buildDependencyGraph,
  DEPENDENCY_GRAPH_SCHEMA,
  DEPENDENCY_GRAPH_VERSION,
} from './builder.mjs';

export {
  dependencies,
  dependents,
  descendants,
  ancestors,
  findCycles,
  filesAffectedByChange,
} from './queries.mjs';

export { computeChangeImpactSet } from './impact.mjs';
