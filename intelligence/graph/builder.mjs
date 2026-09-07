/**
 * Deterministic dependency graph from StructuralFacts (Stage 20).
 *
 * Does not parse source. Does not consume Babel AST.
 * Does not execute modules or resolve npm packages.
 */
import crypto from 'node:crypto';
import { resolveImportPath } from '../adapters/forgeos-structural/index.mjs';

export const DEPENDENCY_GRAPH_SCHEMA = 'forgeos-dependency-graph';
export const DEPENDENCY_GRAPH_VERSION = '1.0.0-stage20';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sortByKey(items, keyFn) {
  return [...(items || [])].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

const INTERNAL_EDGE_KINDS = new Set([
  'import',
  'dynamic_import',
  'require',
  're_export',
  'star_export',
]);

function norm(p) {
  return String(p || '').replace(/\\/g, '/');
}

function isBareSpecifier(source) {
  const s = String(source || '');
  if (!s) return true;
  if (s.startsWith('.') || s.startsWith('/')) return false;
  return true;
}

function fileInventory(facts) {
  const set = new Set();
  const meta = new Map();
  for (const f of facts.files || []) {
    const id = norm(f.path || f);
    if (!id) continue;
    set.add(id);
    meta.set(id, f);
  }
  return { set, meta };
}

function isSourceNode(file, id) {
  const lang = file?.language;
  if (lang === 'javascript' || lang === 'typescript') return true;
  const ext = id.includes('.') ? id.slice(id.lastIndexOf('.')).toLowerCase() : '';
  return ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext);
}

function importKindFor(facts, from, source, fallback) {
  const hits = (facts.imports || []).filter(
    (i) => norm(i.file) === from && i.source === source
  );
  if (hits.some((h) => h.kind === 'dynamic_import')) return 'dynamic_import';
  if (hits.some((h) => h.kind === 'require')) return 'require';
  if (hits.some((h) => h.kind === 'import')) return 'import';
  if (INTERNAL_EDGE_KINDS.has(fallback)) return fallback;
  return 'import';
}

function importLine(facts, from, source) {
  const hit = (facts.imports || []).find(
    (i) => norm(i.file) === from && i.source === source && i.line
  );
  return hit?.line || 0;
}

/**
 * Build a directed graph: edge from importer → imported (same as StructuralFacts.dependency_edges).
 */
export function buildDependencyGraph(facts = {}, context = {}) {
  if (!facts || typeof facts !== 'object') {
    return emptyGraph({ reason: 'missing_structural_facts', context });
  }

  const { set: fileSet, meta } = fileInventory(facts);
  const nodeIds = new Set();

  for (const id of fileSet) {
    if (isSourceNode(meta.get(id), id)) nodeIds.add(id);
  }

  const edgeKey = new Set();
  const edges = [];
  const external = [];
  const unresolved = [];
  const externalKey = new Set();
  const unresolvedKey = new Set();

  function pushEdge(edge) {
    const rec = {
      from: norm(edge.from),
      to: norm(edge.to),
      kind: edge.kind,
      source: edge.source || null,
      line: edge.line || 0,
      resolved: edge.resolved === true,
    };
    const key = `${rec.from}|${rec.to}|${rec.kind}|${rec.source || ''}|${rec.line}`;
    if (edgeKey.has(key)) return;
    edgeKey.add(key);
    edges.push(rec);
  }

  function considerResolved(from, source, kindHint, lineHint) {
    const fromN = norm(from);
    if (!fromN || !fileSet.has(fromN)) return;
    const sourceStr = source == null ? '' : String(source);

    if (isBareSpecifier(sourceStr) && !fileSet.has(norm(sourceStr))) {
      const rec = {
        from: fromN,
        package: sourceStr,
        source: sourceStr,
        kind: kindHint === 're_export' ? 'external' : 'external',
      };
      const k = `${rec.from}|${rec.package}`;
      if (!externalKey.has(k)) {
        externalKey.add(k);
        external.push(rec);
      }
      return;
    }

    const resolved = resolveImportPath(fromN, sourceStr, fileSet);
    const target = resolved ? norm(resolved) : null;
    const kind = importKindFor(facts, fromN, sourceStr, kindHint || 'import');
    const line = lineHint || importLine(facts, fromN, sourceStr);

    if (target && fileSet.has(target)) {
      nodeIds.add(fromN);
      nodeIds.add(target);
      pushEdge({
        from: fromN,
        to: target,
        kind,
        source: sourceStr,
        line,
        resolved: true,
      });
      return;
    }

    const urec = {
      from: fromN,
      to: target || sourceStr,
      source: sourceStr,
      kind,
      line,
      resolved: false,
    };
    const uk = `${urec.from}|${urec.source}|${urec.kind}`;
    if (!unresolvedKey.has(uk)) {
      unresolvedKey.add(uk);
      unresolved.push(urec);
    }
  }

  for (const e of facts.dependency_edges || []) {
    const from = norm(e.from);
    const to = norm(e.to);
    const source = e.source != null ? String(e.source) : to;
    if (!from) continue;

    if (e.kind === 'external' || (isBareSpecifier(source) && !fileSet.has(to))) {
      const rec = {
        from,
        package: source || to,
        source: source || null,
        kind: 'external',
      };
      const k = `${rec.from}|${rec.package}`;
      if (!externalKey.has(k)) {
        externalKey.add(k);
        external.push(rec);
      }
      continue;
    }

    if (fileSet.has(to) && fileSet.has(from)) {
      nodeIds.add(from);
      nodeIds.add(to);
      pushEdge({
        from,
        to,
        kind: importKindFor(facts, from, source, e.kind === 'external' ? 'import' : (e.kind || 'import')),
        source,
        line: e.line || importLine(facts, from, source),
        resolved: true,
      });
      continue;
    }

    considerResolved(from, source, e.kind || 'import', e.line);
  }

  for (const exp of facts.exports || []) {
    if (!exp.source) continue;
    const kind = exp.kind === 'star_export' ? 're_export' : (exp.kind === 're_export' ? 're_export' : null);
    if (!kind) continue;
    considerResolved(exp.file, exp.source, 're_export', exp.line);
  }

  const nodes = sortByKey(
    [...nodeIds].filter((id) => fileSet.has(id)).map((id) => ({
      id,
      language: meta.get(id)?.language || null,
    })),
    (n) => n.id
  );

  const sortedEdges = sortByKey(edges, (e) => `${e.from}|${e.to}|${e.kind}|${e.source || ''}|${e.line}`);
  const sortedExternal = sortByKey(external, (e) => `${e.from}|${e.package}|${e.kind}`);
  const sortedUnresolved = sortByKey(unresolved, (e) => `${e.from}|${e.source}|${e.kind}`);

  const payload = {
    schema: DEPENDENCY_GRAPH_SCHEMA,
    schema_version: 1,
    graph_version: DEPENDENCY_GRAPH_VERSION,
    authority: 'derived_evidence',
    authoritative: false,
    derived: true,
    nodes,
    edges: sortedEdges,
    external_dependencies: sortedExternal,
    unresolved_edges: sortedUnresolved,
    source_analysis_fingerprint: facts.analysis_fingerprint || null,
    source_evidence_class: facts.evidence_class || 'insufficient',
    source_facts_status: facts.status || null,
    source_analyzer_id: facts.analyzer?.id || null,
    node_count: nodes.length,
    edge_count: sortedEdges.length,
  };

  payload.graph_fingerprint = crypto
    .createHash('sha256')
    .update(stableStringify({
      ...payload,
      graph_fingerprint: null,
    }))
    .digest('hex')
    .slice(0, 32);

  return payload;
}

function emptyGraph({ reason, context = {} }) {
  const payload = {
    schema: DEPENDENCY_GRAPH_SCHEMA,
    schema_version: 1,
    graph_version: DEPENDENCY_GRAPH_VERSION,
    authority: 'derived_evidence',
    authoritative: false,
    derived: true,
    reason,
    nodes: [],
    edges: [],
    external_dependencies: [],
    unresolved_edges: [],
    source_analysis_fingerprint: context.analysis_fingerprint || null,
    source_evidence_class: 'insufficient',
    source_facts_status: 'unavailable',
    source_analyzer_id: null,
    node_count: 0,
    edge_count: 0,
  };
  payload.graph_fingerprint = crypto
    .createHash('sha256')
    .update(stableStringify({ ...payload, graph_fingerprint: null }))
    .digest('hex')
    .slice(0, 32);
  return payload;
}
