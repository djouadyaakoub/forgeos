/**
 * SCIP intelligence adapter — Stage 13
 *
 * IMPLEMENTATION STATUS: BLOCKED for default ForgeOS packaging.
 *
 * Reason: SCIP index consumption requires protobuf decoding libraries and/or
 * language indexer binaries. ForgeOS zero-dependency clean-install cannot
 * ship these safely in Stage 13 without packaging risk.
 *
 * The adapter may detect presence of an on-disk index file for status reporting
 * only. It never invents symbols, references, or graphs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  validateIntelligenceAdapter,
  unavailableAnalyzeResult,
  createProjectContext,
} from '../adapter.mjs';
import { createStructuralFacts } from '../structural-facts.mjs';

export const SCIP_ADAPTER_ID = 'scip';
export const SCIP_ADAPTER_VERSION = '0.0.0-blocked-stage13';

export const SCIP_BLOCKER = Object.freeze({
  status: 'BLOCKED',
  reason: 'scip_protobuf_and_indexer_dependencies_not_safe_for_zero_dep_distribution',
  impact: 'SCIP semantic index analysis is not available in default ForgeOS distribution',
  safe_next_step: 'optional SCIP reader stage with explicit dependency policy; keep indexes project-local and non-authoritative',
});

const INDEX_CANDIDATES = Object.freeze([
  'index.scip',
  '.scip/index.scip',
  'scip.index',
]);

export function detectScipIndex(projectDir) {
  const root = path.resolve(projectDir || '.');
  for (const rel of INDEX_CANDIDATES) {
    const full = path.join(root, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const stat = fs.statSync(full);
      return {
        present: true,
        path: rel.replace(/\\/g, '/'),
        size: stat.size,
        mtime_ms: stat.mtimeMs,
      };
    }
  }
  return { present: false, path: null };
}

export function createScipAdapter(overrides = {}) {
  const adapter = {
    id: SCIP_ADAPTER_ID,
    name: 'SCIP',
    version: SCIP_ADAPTER_VERSION,
    schema: 'forgeos-intelligence-adapter',
    authority: 'intelligence_provider',
    claims_policy_authority: false,
    claims_project_intelligence_authority: false,
    claims_canvas_authority: false,
    may_mutate: false,
    may_execute: false,
    capabilities: [
      'symbols',
      'definitions',
      'references',
      'dependency_graph',
      'change_impact_inputs',
    ],
    supported_languages: [],
    packaging_status: SCIP_BLOCKER,
    programmatic_available: false,

    health(projectContext = {}) {
      const ctx = createProjectContext(projectContext);
      const index = ctx.project_dir ? detectScipIndex(ctx.project_dir) : { present: false };
      return {
        status: 'unavailable',
        packaging_status: SCIP_BLOCKER.status,
        reason: SCIP_BLOCKER.reason,
        index_present: index.present === true,
        index_path: index.path || null,
        detail: SCIP_BLOCKER.impact,
        note: index.present
          ? 'Index file detected but SCIP reader is packaging-blocked — no fake parse'
          : 'No SCIP index detected; analyzer blocked regardless',
        safe_next_step: SCIP_BLOCKER.safe_next_step,
      };
    },

    canAnalyze(projectContext = {}) {
      const ctx = createProjectContext(projectContext);
      const index = ctx.project_dir ? detectScipIndex(ctx.project_dir) : { present: false };
      if (!index.present) {
        return {
          ok: false,
          reason: 'scip_index_missing',
          blocker: SCIP_BLOCKER,
        };
      }
      return {
        ok: false,
        reason: 'scip_packaging_blocked',
        blocker: SCIP_BLOCKER,
        index,
      };
    },

    analyze(projectContext = {}) {
      const can = this.canAnalyze(projectContext);
      return unavailableAnalyzeResult(can.reason, {
        blocker: SCIP_BLOCKER,
        index: can.index || (projectContext.project_dir
          ? detectScipIndex(projectContext.project_dir)
          : null),
        note: 'No fake SCIP symbols/references emitted',
      });
    },

    normalize(result, context = {}) {
      return createStructuralFacts({
        analyzer: { id: this.id, name: this.name, version: this.version },
        project_fingerprint: context.project_fingerprint || null,
        evidence_class: 'insufficient',
        status: 'unavailable',
        reason: result?.reason || 'scip_packaging_blocked',
        evidence: {
          notes: [
            SCIP_BLOCKER.reason,
            SCIP_BLOCKER.safe_next_step,
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

export function getScipAdapter() {
  return createScipAdapter();
}
