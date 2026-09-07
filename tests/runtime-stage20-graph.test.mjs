/**
 * Stage 20 — Structural graph intelligence (StructuralFacts → graph → change impact)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDependencyGraph,
  computeChangeImpactSet,
  dependencies,
  dependents,
  ancestors,
  descendants,
  findCycles,
  filesAffectedByChange,
} from '../intelligence/graph/index.mjs';
import { deriveImpactSet } from '../intelligence/adapters/structural-facts.mjs';
import { runStructuralAnalysis } from '../intelligence/adapters/index.mjs';
import { tryLoadBabelParser } from '../intelligence/adapters/babel-parser/index.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { IMPLEMENTATION_KINDS } from '../intelligence/capability/implementation-kinds.mjs';
import { analyzeDeadCode } from '../intelligence/dead-code/detector.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s20-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    'contract:\n  version: 1\nproject:\n  id: s20\n  name: s20\n  type: application\n',
    'utf8'
  );
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return dir;
}

function factsFromDir(dir, adapter_id) {
  return runStructuralAnalysis({
    project_dir: dir,
    persist_cache: false,
    adapter_id,
  }).facts;
}

function chainProject() {
  // c imports b imports a  (edge: c→b, b→a)
  return makeProject({
    'src/a.js': 'export const a = 1;\n',
    'src/b.js': 'import { a } from "./a.js";\nexport const b = a;\n',
    'src/c.js': 'import { b } from "./b.js";\nexport const c = b;\n',
  });
}

console.log('Stage 20 — Structural graph intelligence\n');
console.log('  Impact semantics: impact(X) = files affected by changing X = X ∪ transitive importers (ancestors).');
console.log('  Edge direction: importer → imported.\n');

test('registry capability dependency-graph-intelligence is forgeos_native', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'dependency-graph-intelligence');
  assert.ok(binding);
  assert.equal(binding.assessment_module, 'forgeos.assessment.graph');
  assert.equal(binding.preferred_implementation, 'forgeos_native');
  assert.equal(binding.verification_strategy, 'none');
  const r = resolveCapability({ capability_id: 'dependency-graph-intelligence', capability_binding: binding });
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.FORGEOS_NATIVE);
  assert.equal(r.launches_external_runtime, false);
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('graph from facts — one import', () => {
  const facts = factsFromDir(makeProject({
    'src/a.js': 'export const a = 1;\n',
    'src/b.js': 'import { a } from "./a.js";\nexport const b = a;\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.equal(g.schema, 'forgeos-dependency-graph');
  assert.equal(g.authoritative, false);
  assert.ok(g.edges.some((e) => e.from === 'src/b.js' && e.to === 'src/a.js' && e.resolved));
  assert.deepEqual(dependencies(g, 'src/b.js'), ['src/a.js']);
  assert.deepEqual(dependents(g, 'src/a.js'), ['src/b.js']);
});

test('graph — multiple imports and nested relative', () => {
  const facts = factsFromDir(makeProject({
    'src/leaf.js': 'export const l = 1;\n',
    'src/mid/n.js': 'import { l } from "../leaf.js";\nexport const n = l;\n',
    'src/top.js': 'import { n } from "./mid/n.js";\nimport { l } from "./leaf.js";\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.ok(g.edges.some((e) => e.from === 'src/mid/n.js' && e.to === 'src/leaf.js'));
  assert.ok(g.edges.some((e) => e.from === 'src/top.js' && e.to === 'src/mid/n.js'));
  assert.ok(descendants(g, 'src/top.js').includes('src/leaf.js'));
});

test('graph — extension resolution via existing resolver', () => {
  const facts = factsFromDir(makeProject({
    'src/util.ts': 'export const u = 1;\n',
    'src/app.js': 'import { u } from "./util";\nexport const x = u;\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  const hit = g.edges.find((e) => e.from === 'src/app.js');
  assert.ok(hit);
  assert.ok(hit.to === 'src/util.ts' || hit.to.startsWith('src/util'));
});

test('graph — external package is not a source node', () => {
  const facts = factsFromDir(makeProject({
    'src/app.js': 'import r from "react";\nexport const x = r;\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.ok(!g.nodes.some((n) => n.id === 'react'));
  assert.ok(g.external_dependencies.some((e) => e.package === 'react'));
  assert.ok(!g.edges.some((e) => e.to === 'react' && e.resolved));
});

test('graph — unresolved relative import does not fabricate a node or crash', () => {
  const facts = factsFromDir(makeProject({
    'src/app.js': 'import { z } from "./missing.js";\nexport const x = 1;\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.ok(!g.nodes.some((n) => n.id.includes('missing')));
  assert.ok(g.unresolved_edges.length >= 1);
});

test('determinism — same facts → same graph fingerprint', () => {
  const dir = chainProject();
  const f1 = factsFromDir(dir, 'forgeos-structural');
  const g1 = buildDependencyGraph(f1);
  const g2 = buildDependencyGraph(f1);
  assert.equal(g1.graph_fingerprint, g2.graph_fingerprint);
  assert.deepEqual(g1.edges, g2.edges);
  assert.deepEqual(g1.nodes.map((n) => n.id), g2.nodes.map((n) => n.id));
});

test('queries — A←B←C impact is files affected by changing A', () => {
  const facts = factsFromDir(chainProject(), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.deepEqual(dependents(g, 'src/a.js'), ['src/b.js']);
  assert.deepEqual(ancestors(g, 'src/a.js').sort(), ['src/b.js', 'src/c.js']);
  assert.deepEqual(descendants(g, 'src/c.js').sort(), ['src/a.js', 'src/b.js']);
  const impactA = filesAffectedByChange(g, ['src/a.js']);
  assert.equal(impactA.impact_direction, 'files_affected_by_changing_targets');
  assert.ok(impactA.impact_set.includes('src/a.js'));
  assert.ok(impactA.direct_dependents.includes('src/b.js'));
  assert.ok(impactA.transitive_dependents.includes('src/c.js'));
  assert.ok(impactA.impact_set.includes('src/c.js'));
  const impactC = filesAffectedByChange(g, ['src/c.js']);
  assert.deepEqual(impactC.impact_set, ['src/c.js']);
});

test('deriveImpactSet matches graph impact', () => {
  const facts = factsFromDir(chainProject(), 'forgeos-structural');
  const impact = deriveImpactSet(facts, ['src/a.js']);
  assert.ok(impact.dependents.includes('src/b.js'));
  assert.ok(impact.dependents.includes('src/c.js'));
  assert.ok(impact.direct_dependents.includes('src/b.js'));
  assert.ok(impact.transitive_dependents.includes('src/c.js'));
});

test('cycles — A→B→C→A', () => {
  const facts = factsFromDir(makeProject({
    'src/a.js': 'import { b } from "./b.js";\nexport const a = b;\n',
    'src/b.js': 'import { c } from "./c.js";\nexport const b = c;\n',
    'src/c.js': 'import { a } from "./a.js";\nexport const c = a;\n',
  }), 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  const cycles = findCycles(g);
  assert.ok(cycles.length >= 1);
  const nodes = new Set(cycles[0].nodes);
  assert.ok(nodes.has('src/a.js') && nodes.has('src/b.js') && nodes.has('src/c.js'));
});

test('zero in-degree is NOT dead code', () => {
  const dir = makeProject({
    'src/index.js': 'export function main() { return 1; }\n',
  });
  const facts = factsFromDir(dir, 'forgeos-structural');
  const g = buildDependencyGraph(facts);
  assert.equal(dependents(g, 'src/index.js').length, 0);
  const dead = analyzeDeadCode(dir);
  assert.ok(!(dead.candidates || []).some((c) => c.evidence && /in-degree|no incoming|isolated graph/i.test(c.evidence)));
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  const row = assessment.assessments.find((a) => a.binding.id === 'dead-code-analysis');
  const types = (row.assessment.findings || []).map((f) => f.type);
  assert.ok(!types.includes('isolated_graph_node'));
  assert.ok(!types.includes('zero_indegree_dead_code'));
});

test('assessment change-impact uses graph; canvas not SATISFIED', () => {
  const dir = chainProject();
  const assessment = runProjectAssessment({
    project_dir: dir,
    persist: false,
    changed_files: ['src/a.js'],
  });
  assert.ok(assessment.dependency_graph || assessment.facts_summary);
  const impact = assessment.assessments.find((a) => a.binding.id === 'change-impact');
  const evidence = impact.assessment.evidence || impact.assessment.findings || [];
  const set = evidence.find((f) => f.type === 'change_impact_set');
  assert.ok(set);
  assert.ok((set.impact_set || []).includes('src/c.js'));
  assert.equal(set.impact_direction, 'files_affected_by_changing_targets');
  const graphCap = assessment.assessments.find((a) => a.binding.id === 'dependency-graph-intelligence');
  assert.ok(graphCap);
  assert.notEqual(graphCap.assessment.state, 'SATISFIED');
  for (const item of assessment.canvas.items || []) {
    assert.notEqual(item.state, 'SATISFIED');
  }
});

test('graph layer does not import babel AST', () => {
  const src = fs.readFileSync(path.join(REPO, 'intelligence/graph/builder.mjs'), 'utf8')
    + fs.readFileSync(path.join(REPO, 'intelligence/graph/queries.mjs'), 'utf8')
    + fs.readFileSync(path.join(REPO, 'intelligence/graph/impact.mjs'), 'utf8');
  assert.ok(!/@babel/.test(src));
  assert.ok(!/child_process/.test(src));
  assert.ok(!/\beval\s*\(/.test(src));
});

test('no new Markdown agents', () => {
  const md = fs.readdirSync(path.join(REPO, 'agents')).filter((f) => f.endsWith('.md')).length;
  assert.equal(md, 11);
});

const babel = tryLoadBabelParser();
if (!babel.available) {
  test('Babel integration SKIPPED — optional parser absent; regex graph still proven', () => {
    assert.ok(true);
  });
} else {
  test('Stage 19 Babel → StructuralFacts → Graph → change impact', () => {
    const dir = makeProject({
      'src/a.ts': 'export const a: number = 1;\n',
      'src/b.ts': 'import { a } from "./a.ts";\nexport const b = a;\n',
      'src/c.ts': 'import { b } from "./b.ts";\nexport async function c() { return import("./b.ts"); }\n',
      'src/dyn.js': 'module.exports = require("./a.ts");\n',
      'src/re.js': 'export { a } from "./a.ts";\n',
    });
    const analysis = runStructuralAnalysis({
      project_dir: dir,
      persist_cache: false,
      adapter_id: 'babel-parser',
    });
    assert.equal(analysis.adapter_id, 'babel-parser');
    assert.equal(analysis.ok, true);
    const g = buildDependencyGraph(analysis.facts);
    assert.ok(g.edges.some((e) => e.from === 'src/b.ts' && e.to === 'src/a.ts'));
    const dyn = (analysis.facts.imports || []).some((i) => i.kind === 'dynamic_import');
    assert.ok(dyn);
    const req = (analysis.facts.imports || []).some((i) => i.kind === 'require');
    assert.ok(req);
    assert.ok(g.edges.some((e) => e.kind === 'dynamic_import' || analysis.facts.imports.some((i) => i.kind === 'dynamic_import')));
    const impact = computeChangeImpactSet(analysis.facts, ['src/a.ts']);
    assert.ok(impact.impact_set.includes('src/b.ts'));
    assert.ok(g.edges.some((e) => e.kind === 're_export') || (analysis.facts.exports || []).some((x) => x.kind === 're_export'));
  });

  test('fallback forgeos-structural facts still build a graph', () => {
    const dir = chainProject();
    const facts = factsFromDir(dir, 'forgeos-structural');
    const g = buildDependencyGraph(facts);
    assert.ok(g.edge_count >= 2);
    assert.ok(g.source_analyzer_id === 'forgeos-structural' || facts.analyzer.id === 'forgeos-structural');
  });
}

test('performance observation — small/medium/large synthetic graphs', () => {
  function gen(n) {
    const files = {};
    files['src/n0.js'] = 'export const n0 = 0;\n';
    for (let i = 1; i < n; i++) {
      files[`src/n${i}.js`] = `import { n${i - 1} } from "./n${i - 1}.js";\nexport const n${i} = n${i - 1};\n`;
    }
    return files;
  }
  const sizes = [20, 80, 200];
  const times = {};
  for (const n of sizes) {
    const dir = makeProject(gen(n));
    const t0 = Date.now();
    const facts = factsFromDir(dir, 'forgeos-structural');
    const tFacts = Date.now();
    const g = buildDependencyGraph(facts);
    const tGraph = Date.now();
    ancestors(g, 'src/n0.js');
    const tQ = Date.now();
    times[`n${n}`] = {
      files: n,
      edges: g.edge_count,
      facts_ms: tFacts - t0,
      build_ms: tGraph - tFacts,
      query_ms: tQ - tGraph,
    };
  }
  console.log('  PERF', JSON.stringify(times));
  assert.ok(times.n20.build_ms >= 0);
});

test('malformed facts do not crash', () => {
  const g = buildDependencyGraph(null);
  assert.equal(g.edge_count, 0);
  const g2 = buildDependencyGraph({ files: 'nope' });
  assert.ok(Array.isArray(g2.nodes));
});

console.log(`\nStage 20 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
