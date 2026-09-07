/**
 * Normalized Structural Facts — Stage 13
 *
 * Derived evidence only. Never authoritative Project Intelligence.
 */
import crypto from 'node:crypto';
import { NORMALIZATION_VERSION, EVIDENCE_CLASSES } from './adapter.mjs';
import { redactString } from '../deployment/redact.mjs';
import { computeChangeImpactSet } from '../graph/impact.mjs';

export const STRUCTURAL_FACTS_SCHEMA = 'forgeos-structural-facts';

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function sortByKey(items, keyFn) {
  return [...(items || [])].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function redactFinding(f = {}) {
  return {
    ...f,
    message: f.message != null ? redactString(f.message) : f.message,
    note: f.note != null ? redactString(f.note) : f.note,
  };
}

/**
 * Build a versioned, sorted, fingerprinted StructuralFacts record.
 */
export function createStructuralFacts(input = {}) {
  const analyzer = {
    id: input.analyzer?.id || input.analyzer_id || 'unknown',
    name: input.analyzer?.name || input.analyzer_name || 'unknown',
    version: input.analyzer?.version || input.analyzer_version || '0.0.0',
  };

  const evidenceClass = EVIDENCE_CLASSES.includes(input.evidence_class)
    ? input.evidence_class
    : 'insufficient';

  const files = sortByKey(input.files || [], (f) => String(f.path || f));
  const symbols = sortByKey(input.symbols || [], (s) => `${s.file || ''}|${s.name || ''}|${s.kind || ''}`);
  const declarations = sortByKey(
    input.declarations || [],
    (d) => `${d.file || ''}|${d.name || ''}|${d.kind || ''}|${d.line || 0}`
  );
  const references = sortByKey(
    input.references || [],
    (r) => `${r.from_file || ''}|${r.to_name || r.to_file || ''}|${r.kind || ''}`
  );
  const imports = sortByKey(
    input.imports || [],
    (i) => `${i.file || ''}|${i.source || ''}|${i.specifiers?.join(',') || ''}`
  );
  const exports = sortByKey(
    input.exports || [],
    (e) => `${e.file || ''}|${e.name || ''}|${e.kind || ''}`
  );
  const dependency_edges = sortByKey(
    input.dependency_edges || [],
    (e) => `${e.from || ''}|${e.to || ''}|${e.kind || ''}`
  );
  const structural_edges = sortByKey(
    input.structural_edges || [],
    (e) => `${e.from || ''}|${e.to || ''}|${e.kind || ''}`
  );
  const diagnostics = sortByKey(
    (input.diagnostics || []).map((d) => ({
      ...d,
      message: d.message != null ? redactString(d.message) : d.message,
    })),
    (d) => `${d.file || ''}|${d.code || ''}|${d.message || ''}`
  );
  const findings = sortByKey(
    (input.findings || []).map(redactFinding),
    (f) => `${f.type || ''}|${f.path || f.file || ''}|${f.message || ''}`
  );
  const languages = [...new Set((input.languages || []).map(String))].sort();

  const base = {
    schema: STRUCTURAL_FACTS_SCHEMA,
    schema_version: 1,
    normalization_version: NORMALIZATION_VERSION,
    authority: 'derived_evidence',
    authoritative: false,
    derived: true,
    project_fingerprint: input.project_fingerprint || null,
    input_fingerprint: input.input_fingerprint || null,
    analyzer,
    analyzed_at: input.analyzed_at || new Date().toISOString(),
    evidence_class: evidenceClass,
    languages,
    files,
    symbols,
    declarations,
    references,
    imports,
    exports,
    dependency_edges,
    structural_edges,
    diagnostics,
    findings,
    evidence: {
      files_examined: files.length,
      file_fingerprints: sortByKey(
        (input.evidence?.file_fingerprints || []).map((fp) => ({
          path: fp.path,
          sha256: fp.sha256,
        })),
        (x) => x.path
      ),
      tool_version: analyzer.version,
      normalization_version: NORMALIZATION_VERSION,
      notes: (input.evidence?.notes || []).map((n) => redactString(String(n))),
    },
    status: input.status || 'ok',
    reason: input.reason || null,
  };

  base.analysis_fingerprint = crypto
    .createHash('sha256')
    .update(stableStringify({
      ...base,
      analyzed_at: null,
      analysis_fingerprint: null,
    }))
    .digest('hex')
    .slice(0, 32);

  return base;
}

export function isStructuralFactsFresh(facts, context = {}) {
  if (!facts || facts.schema !== STRUCTURAL_FACTS_SCHEMA) {
    return { fresh: false, reason: 'missing_or_invalid_facts' };
  }
  if (context.project_fingerprint && facts.project_fingerprint
    && facts.project_fingerprint !== context.project_fingerprint) {
    return { fresh: false, reason: 'project_fingerprint_mismatch' };
  }
  if (context.input_fingerprint && facts.input_fingerprint
    && facts.input_fingerprint !== context.input_fingerprint) {
    return { fresh: false, reason: 'input_fingerprint_mismatch' };
  }
  if (context.analyzer_version && facts.analyzer?.version
    && facts.analyzer.version !== context.analyzer_version) {
    return { fresh: false, reason: 'analyzer_version_mismatch' };
  }
  if (context.normalization_version
    && facts.normalization_version !== context.normalization_version) {
    return { fresh: false, reason: 'normalization_version_mismatch' };
  }
  if (typeof context.max_age_ms === 'number' && facts.analyzed_at) {
    const age = Date.now() - Date.parse(facts.analyzed_at);
    if (Number.isFinite(age) && age > context.max_age_ms) {
      return { fresh: false, reason: 'ttl_expired' };
    }
  }
  return { fresh: true, reason: null };
}

/**
 * Derive change-impact set: files affected by changing the given files
 * (changed ∪ transitive importers). Uses Stage 20 graph when facts are present.
 */
export function deriveImpactSet(facts, changedFiles = []) {
  return computeChangeImpactSet(facts, changedFiles);
}
