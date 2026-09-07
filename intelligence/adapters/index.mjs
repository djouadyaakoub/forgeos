/**
 * Deterministic intelligence orchestration — Stage 13
 *
 * On-demand analysis only. No daemon. No background watcher.
 * Main Agent must not call this for execution — assessment/services only.
 */
import crypto from 'node:crypto';
import { createForgeOsStructuralAdapter, FORGEOS_STRUCTURAL_ID } from './forgeos-structural/index.mjs';
import { createTreeSitterAdapter, TREE_SITTER_BLOCKER } from './tree-sitter/index.mjs';
import { createScipAdapter, SCIP_BLOCKER } from './scip/index.mjs';
import {
  createBabelParserAdapter,
  BABEL_PARSER_ADAPTER_ID,
} from './babel-parser/index.mjs';
import { deriveImpactSet, isStructuralFactsFresh } from './structural-facts.mjs';
import { buildDependencyGraph } from '../graph/builder.mjs';
import { readStructuralCache, writeStructuralCache } from './cache.mjs';
import { NORMALIZATION_VERSION } from './adapter.mjs';

export function listIntelligenceAdapters() {
  return [
    createForgeOsStructuralAdapter(),
    createBabelParserAdapter(),
    createTreeSitterAdapter(),
    createScipAdapter(),
  ];
}

/**
 * Prefer optional OSS-derived Babel provider when the package is loadable.
 * Does not bypass Capability Resolver for execution; this selects an intelligence provider.
 */
export function selectDefaultStructuralAdapterId() {
  const babel = createBabelParserAdapter();
  if (babel.health().status === 'available') return BABEL_PARSER_ADAPTER_ID;
  return FORGEOS_STRUCTURAL_ID;
}

export function getIntelligenceAdapter(id) {
  return listIntelligenceAdapters().find((a) => a.id === id) || null;
}

export function describeAnalyzerAvailability() {
  const tree = createTreeSitterAdapter().health();
  const scip = createScipAdapter().health();
  const structural = createForgeOsStructuralAdapter().health();
  const babel = createBabelParserAdapter().health();
  return {
    forgeos_structural: {
      id: 'forgeos-structural',
      status: structural.status,
      packaging: 'bundled_zero_dependency',
    },
    babel_parser: {
      id: BABEL_PARSER_ADAPTER_ID,
      status: babel.status,
      packaging: 'optional_npm',
      reason: babel.reason || null,
      babel_version: babel.babel_version || null,
      implementation_kind: 'OSS_DERIVED',
    },
    tree_sitter: {
      id: 'tree-sitter',
      status: tree.status,
      packaging_status: TREE_SITTER_BLOCKER.status,
      reason: TREE_SITTER_BLOCKER.reason,
    },
    scip: {
      id: 'scip',
      status: scip.status,
      packaging_status: SCIP_BLOCKER.status,
      reason: SCIP_BLOCKER.reason,
    },
    selected_default_adapter_id: selectDefaultStructuralAdapterId(),
    deterministic_intelligence_available: structural.status === 'available',
  };
}

/**
 * Run on-demand structural analysis.
 * Default: babel-parser when optional package is available, else forgeos-structural.
 */
export function runStructuralAnalysis(input = {}) {
  const projectDir = input.project_dir;
  if (!projectDir) {
    return {
      ok: false,
      reason: 'project_dir_required',
      facts: null,
      availability: describeAnalyzerAvailability(),
    };
  }

  const adapterId = input.adapter_id || selectDefaultStructuralAdapterId();
  const adapter = getIntelligenceAdapter(adapterId) || createForgeOsStructuralAdapter();
  const analyzedAt = input.analyzed_at || new Date().toISOString();
  const projectFingerprint = input.project_fingerprint || null;

  if (input.use_cache !== false) {
    const cached = readStructuralCache(projectDir, adapter.id, {
      project_fingerprint: projectFingerprint,
      analyzer_version: adapter.version,
      normalization_version: NORMALIZATION_VERSION,
      max_age_ms: input.max_age_ms,
    });
    // Input fingerprint checked after analyze if cache hit lacks match — prefer re-run when PI fingerprint changes
    if (cached.hit && cached.facts) {
      return {
        ok: true,
        reason: null,
        from_cache: true,
        adapter_id: adapter.id,
        facts: cached.facts,
        availability: describeAnalyzerAvailability(),
        impact: input.changed_files?.length
          ? deriveImpactSet(cached.facts, input.changed_files)
          : null,
      };
    }
  }

  const result = adapter.analyze({
    project_dir: projectDir,
    project_id: input.project_id,
    project_intelligence_fingerprint: projectFingerprint,
    files: input.files,
    max_files: input.max_files,
    changed_files: input.changed_files,
  });

  const facts = adapter.normalize(result, {
    project_fingerprint: projectFingerprint,
    analyzed_at: analyzedAt,
  });

  if (input.persist_cache !== false && facts.status === 'ok') {
    writeStructuralCache(projectDir, facts, adapter.id);
  }

  return {
    ok: result.ok === true && facts.status === 'ok',
    reason: result.reason || facts.reason,
    from_cache: false,
    adapter_id: adapter.id,
    facts,
    availability: describeAnalyzerAvailability(),
    impact: input.changed_files?.length
      ? deriveImpactSet(facts, input.changed_files)
      : null,
    freshness: isStructuralFactsFresh(facts, {
      project_fingerprint: projectFingerprint,
      analyzer_version: adapter.version,
      normalization_version: NORMALIZATION_VERSION,
    }),
  };
}

/**
 * Collect structural intelligence for assessment engine (derived evidence).
 */
export function collectStructuralIntelligence(projectDir, factsHints = {}, options = {}) {
  const analysis = runStructuralAnalysis({
    project_dir: projectDir,
    project_id: factsHints.project_id,
    project_fingerprint: factsHints.project_intelligence_fingerprint,
    changed_files: options.changed_files,
    use_cache: options.use_cache !== false,
    persist_cache: options.persist_cache === true,
    max_files: options.max_files,
  });

  const graph = analysis.facts ? buildDependencyGraph(analysis.facts) : null;

  return {
    structural_facts: analysis.facts,
    structural_analysis_ok: analysis.ok === true,
    structural_adapter_id: analysis.adapter_id,
    structural_from_cache: analysis.from_cache === true,
    structural_availability: analysis.availability,
    deterministic_intelligence_available:
      analysis.availability?.deterministic_intelligence_available === true
      && analysis.facts?.evidence_class === 'deterministic',
    evidence_class: analysis.facts?.evidence_class || 'insufficient',
    change_impact: analysis.impact,
    dependency_graph: graph,
  };
}

export function fingerprintStructuralInputs(files = [], fileFingerprints = []) {
  const map = new Map(fileFingerprints.map((f) => [f.path, f.sha256]));
  const payload = [...files].sort().map((f) => `${f}:${map.get(f) || ''}`).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
