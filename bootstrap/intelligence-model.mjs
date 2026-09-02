/**
 * Canonical Project Intelligence — shared types and confidence model
 */
export const CONFIDENCE_LEVELS = {
  VERIFIED: 'VERIFIED',
  INFERRED: 'INFERRED',
  HEURISTIC: 'HEURISTIC',
  UNKNOWN: 'UNKNOWN',
};

export const SOURCE_PRIORITY = [
  'explicit_policy',
  'project_registry',
  'agent_definition',
  'playbook',
  'agents_md',
  'architecture_doc',
  'ownership_doc',
  'ci_config',
  'package_manifest',
  'source_heuristic',
];

const PRIORITY_RANK = Object.fromEntries(SOURCE_PRIORITY.map((s, i) => [s, i]));

export function confidenceFromSource(sourceType, explicit = false) {
  if (explicit) return { level: CONFIDENCE_LEVELS.VERIFIED, score: 1.0 };
  switch (sourceType) {
    case 'project_registry':
    case 'explicit_policy':
      return { level: CONFIDENCE_LEVELS.VERIFIED, score: 0.95 };
    case 'agent_definition':
    case 'playbook':
      return { level: CONFIDENCE_LEVELS.VERIFIED, score: 0.9 };
    case 'agents_md':
    case 'ownership_doc':
      return { level: CONFIDENCE_LEVELS.INFERRED, score: 0.75 };
    case 'architecture_doc':
    case 'ci_config':
      return { level: CONFIDENCE_LEVELS.INFERRED, score: 0.7 };
    case 'package_manifest':
      return { level: CONFIDENCE_LEVELS.HEURISTIC, score: 0.6 };
    default:
      return { level: CONFIDENCE_LEVELS.HEURISTIC, score: 0.5 };
  }
}

export function compareSourcePriority(a, b) {
  const ra = PRIORITY_RANK[a] ?? 99;
  const rb = PRIORITY_RANK[b] ?? 99;
  return ra - rb;
}

export function wrapEvidence(value, source, evidence = [], options = {}) {
  const conf = options.confidence ?? confidenceFromSource(options.source_type || 'source_heuristic', options.explicit);
  return {
    value,
    source,
    source_type: options.source_type || 'source_heuristic',
    evidence: [...evidence],
    confidence: conf.score,
    confidence_level: conf.level,
    inferred: conf.level !== CONFIDENCE_LEVELS.VERIFIED,
  };
}

export function emptyCanonicalProfile(projectDir) {
  return {
    identity: {},
    stack: {},
    components: [],
    capabilities: [],
    agents: [],
    ownership: [],
    policies: [],
    verification: [],
    deployment: [],
    environments: [],
    knowledge: [],
    conventions: [],
    research: [],
    confidence: {},
    contradictions: [],
    project_dir: projectDir,
  };
}
