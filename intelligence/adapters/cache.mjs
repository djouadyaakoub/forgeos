/**
 * Bounded structural-facts cache — Stage 13
 *
 * Project-scoped, fingerprint-bound, non-authoritative.
 * Never overrides current project state when fingerprints diverge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isStructuralFactsFresh, STRUCTURAL_FACTS_SCHEMA } from './structural-facts.mjs';
import { NORMALIZATION_VERSION } from './adapter.mjs';

export const CACHE_REL_DIR = '.agent-os/cache/structural';

export function structuralCachePath(projectDir, analyzerId = 'forgeos-structural') {
  const safe = String(analyzerId).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(projectDir, CACHE_REL_DIR, `${safe}.json`);
}

export function readStructuralCache(projectDir, analyzerId, context = {}) {
  const full = structuralCachePath(projectDir, analyzerId);
  if (!fs.existsSync(full)) return { hit: false, facts: null, reason: 'cache_missing' };
  let facts;
  try {
    facts = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return { hit: false, facts: null, reason: 'cache_corrupt' };
  }
  if (facts?.schema !== STRUCTURAL_FACTS_SCHEMA) {
    return { hit: false, facts: null, reason: 'cache_schema_mismatch' };
  }
  const freshness = isStructuralFactsFresh(facts, {
    project_fingerprint: context.project_fingerprint,
    input_fingerprint: context.input_fingerprint,
    analyzer_version: context.analyzer_version,
    normalization_version: context.normalization_version || NORMALIZATION_VERSION,
    max_age_ms: context.max_age_ms,
  });
  if (!freshness.fresh) {
    return { hit: false, facts, reason: freshness.reason, stale: true };
  }
  return { hit: true, facts, reason: null, stale: false };
}

export function writeStructuralCache(projectDir, facts, analyzerId = 'forgeos-structural') {
  if (!facts || facts.schema !== STRUCTURAL_FACTS_SCHEMA) {
    return { ok: false, reason: 'invalid_facts' };
  }
  const full = structuralCachePath(projectDir, analyzerId);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const payload = {
    ...facts,
    cache: {
      non_authoritative: true,
      written_at: new Date().toISOString(),
      note: 'Derived cache only — never Project Intelligence authority',
    },
  };
  fs.writeFileSync(full, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, path: full.replace(/\\/g, '/') };
}

export function clearStructuralCache(projectDir, analyzerId = null) {
  const dir = path.join(projectDir, CACHE_REL_DIR);
  if (!fs.existsSync(dir)) return { ok: true, cleared: 0 };
  if (analyzerId) {
    const full = structuralCachePath(projectDir, analyzerId);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true, cleared: 1 };
  }
  let cleared = 0;
  for (const name of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, name));
    cleared++;
  }
  return { ok: true, cleared };
}
