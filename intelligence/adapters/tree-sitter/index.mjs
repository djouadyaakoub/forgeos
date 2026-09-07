/**
 * Tree-sitter intelligence adapter — Stage 13
 *
 * IMPLEMENTATION STATUS: BLOCKED for default ForgeOS packaging.
 *
 * Reason: ForgeOS ships with zero npm dependencies and release ZIPs exclude
 * node_modules. Native tree-sitter (and language grammars) require native
 * modules / optional WASM packages that would break clean-install reliability.
 *
 * This adapter is real and honest: health/analyze report unavailable.
 * It does NOT invent parse trees or fake symbols.
 */
import {
  validateIntelligenceAdapter,
  unavailableAnalyzeResult,
  createProjectContext,
} from '../adapter.mjs';
import { createStructuralFacts } from '../structural-facts.mjs';

export const TREE_SITTER_ADAPTER_ID = 'tree-sitter';
export const TREE_SITTER_ADAPTER_VERSION = '0.0.0-blocked-stage13';

export const TREE_SITTER_BLOCKER = Object.freeze({
  status: 'BLOCKED',
  reason: 'native_or_wasm_dependency_breaks_zero_dep_clean_install',
  impact: 'tree-sitter syntax CST analysis is not available in default ForgeOS distribution',
  safe_next_step: 'optional opt-in package in a later stage with explicit packaging policy; use forgeos-structural for deterministic JS/TS structure today',
});

/**
 * Attempt optional dynamic load — never required.
 * Returns null when packages are absent (expected in default installs).
 */
export async function tryLoadTreeSitterRuntime() {
  try {
    // Dynamic optional — must not be a static dependency of ForgeOS
    const Parser = (await import('tree-sitter')).default;
    return { Parser, available: true };
  } catch {
    return { Parser: null, available: false, reason: 'module_not_installed' };
  }
}

export function createTreeSitterAdapter(overrides = {}) {
  const adapter = {
    id: TREE_SITTER_ADAPTER_ID,
    name: 'Tree-sitter',
    version: TREE_SITTER_ADAPTER_VERSION,
    schema: 'forgeos-intelligence-adapter',
    authority: 'intelligence_provider',
    claims_policy_authority: false,
    claims_project_intelligence_authority: false,
    claims_canvas_authority: false,
    may_mutate: false,
    may_execute: false,
    capabilities: [
      'syntax_structure',
      'declarations',
      'functions',
      'classes',
      'imports',
      'exports',
    ],
    supported_languages: [],
    packaging_status: TREE_SITTER_BLOCKER,
    programmatic_available: false,

    health() {
      return {
        status: 'unavailable',
        packaging_status: TREE_SITTER_BLOCKER.status,
        reason: TREE_SITTER_BLOCKER.reason,
        detail: TREE_SITTER_BLOCKER.impact,
        safe_next_step: TREE_SITTER_BLOCKER.safe_next_step,
      };
    },

    canAnalyze(projectContext = {}) {
      createProjectContext(projectContext);
      return {
        ok: false,
        reason: 'tree_sitter_packaging_blocked',
        blocker: TREE_SITTER_BLOCKER,
      };
    },

    analyze(projectContext = {}) {
      createProjectContext(projectContext);
      return unavailableAnalyzeResult('tree_sitter_packaging_blocked', {
        blocker: TREE_SITTER_BLOCKER,
        note: 'No fake CST/symbols emitted',
      });
    },

    normalize(result, context = {}) {
      return createStructuralFacts({
        analyzer: { id: this.id, name: this.name, version: this.version },
        project_fingerprint: context.project_fingerprint || null,
        evidence_class: 'insufficient',
        status: 'unavailable',
        reason: result?.reason || 'tree_sitter_packaging_blocked',
        evidence: {
          notes: [
            TREE_SITTER_BLOCKER.reason,
            TREE_SITTER_BLOCKER.safe_next_step,
          ],
        },
        analyzed_at: context.analyzed_at,
      });
    },

    ...overrides,
  };

  const validation = validateIntelligenceAdapter(adapter);
  return { ...adapter, validation };
}

export function getTreeSitterAdapter() {
  return createTreeSitterAdapter();
}
