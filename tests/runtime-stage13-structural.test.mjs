/**
 * Stage 13 — Deterministic structural intelligence (positive)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateIntelligenceAdapter,
  createProjectContext,
} from '../intelligence/adapters/adapter.mjs';
import {
  createStructuralFacts,
  isStructuralFactsFresh,
  deriveImpactSet,
} from '../intelligence/adapters/structural-facts.mjs';
import { createForgeOsStructuralAdapter, analyzeSourceText } from '../intelligence/adapters/forgeos-structural/index.mjs';
import { createTreeSitterAdapter, TREE_SITTER_BLOCKER } from '../intelligence/adapters/tree-sitter/index.mjs';
import { createScipAdapter, SCIP_BLOCKER, detectScipIndex } from '../intelligence/adapters/scip/index.mjs';
import { runStructuralAnalysis, describeAnalyzerAvailability } from '../intelligence/adapters/index.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { runForgeOsInspectCli } from '../cli/inspect.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';

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

function makeProject(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s13-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage13
  name: Stage13
  type: application
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# s13\n');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# stack\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# a\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s13"}\n');
  fs.writeFileSync(
    path.join(dir, 'src', 'util.mjs'),
    `export function helper() { return 1; }\nexport const X = 2;\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'index.mjs'),
    `import { helper } from './util.mjs';\nexport function main() { return helper(); }\n`,
    'utf8'
  );
  if (extra.rootSource) {
    fs.writeFileSync(path.join(dir, 'orphan.mjs'), 'export function orphan() { return 0; }\n');
  }
  if (extra.malformed) {
    fs.writeFileSync(path.join(dir, 'src', 'bad.mjs'), 'export function broken() { {\n');
  }
  if (extra.python) {
    fs.writeFileSync(path.join(dir, 'src', 'script.py'), 'def foo():\n  return 1\n');
  }
  if (extra.duplicate) {
    const body = 'export function twin() { return 42; }\n';
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), body);
    fs.writeFileSync(path.join(dir, 'src', 'b.mjs'), body);
  }
  return dir;
}

console.log('Stage 13 — Deterministic structural intelligence\n');

test('adapter contract — valid forgeos-structural', () => {
  const a = createForgeOsStructuralAdapter();
  assert.equal(a.validation.valid, true);
  assert.equal(a.claims_policy_authority, false);
  assert.equal(a.may_mutate, false);
  assert.equal(a.may_execute, false);
});

test('adapter contract — invalid claims rejected', () => {
  const bad = validateIntelligenceAdapter({
    ...createForgeOsStructuralAdapter(),
    claims_policy_authority: true,
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.reasons.includes('adapter_cannot_claim_policy_authority'));
});

test('determinism — same input → same analysis_fingerprint', () => {
  const dir = makeProject();
  const a = createForgeOsStructuralAdapter();
  const r1 = a.analyze({ project_dir: dir });
  const r2 = a.analyze({ project_dir: dir });
  const f1 = a.normalize(r1, { project_fingerprint: 'pf', analyzed_at: '2020-01-01T00:00:00.000Z' });
  const f2 = a.normalize(r2, { project_fingerprint: 'pf', analyzed_at: '2020-01-02T00:00:00.000Z' });
  assert.equal(f1.analysis_fingerprint, f2.analysis_fingerprint);
  assert.deepEqual(
    f1.files.map((x) => x.path),
    [...f1.files.map((x) => x.path)].sort()
  );
});

test('stable ordering of imports/exports/declarations', () => {
  const dir = makeProject();
  const facts = runStructuralAnalysis({ project_dir: dir, persist_cache: false }).facts;
  const paths = facts.declarations.map((d) => `${d.file}|${d.name}|${d.kind}`);
  assert.deepEqual(paths, [...paths].sort());
});

test('forgeos-structural — supported JS source', () => {
  const parsed = analyzeSourceText('src/x.mjs', 'import a from "./a.mjs";\nexport function foo() {}\n');
  assert.equal(parsed.language, 'javascript');
  assert.ok(parsed.imports.length >= 1);
  assert.ok(parsed.declarations.some((d) => d.name === 'foo'));
});

test('forgeos-structural — unsupported language recorded without fake CST', () => {
  const dir = makeProject({ python: true });
  const facts = runStructuralAnalysis({ project_dir: dir, persist_cache: false }).facts;
  const py = facts.files.find((f) => f.path.endsWith('script.py'));
  assert.ok(py);
  assert.equal(py.language, null);
  assert.ok(!facts.declarations.some((d) => d.file.endsWith('script.py')));
});

test('forgeos-structural — malformed source diagnostic', () => {
  const dir = makeProject({ malformed: true });
  const facts = runStructuralAnalysis({
    project_dir: dir,
    persist_cache: false,
    adapter_id: 'forgeos-structural',
  }).facts;
  assert.ok(facts.diagnostics.some((d) => d.code === 'unbalanced_braces'));
});

test('forgeos-structural — empty project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s13-empty-'));
  const analysis = runStructuralAnalysis({ project_dir: dir, persist_cache: false });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.facts.files.length, 0);
});

test('forgeos-structural — mixed-language project', () => {
  const dir = makeProject({ python: true });
  const facts = runStructuralAnalysis({ project_dir: dir, persist_cache: false }).facts;
  assert.ok(facts.languages.includes('javascript'));
  assert.ok(facts.files.some((f) => f.path.endsWith('.py')));
});

test('tree-sitter adapter — blocked, no fake output', () => {
  const a = createTreeSitterAdapter();
  assert.equal(a.health().status, 'unavailable');
  assert.equal(TREE_SITTER_BLOCKER.status, 'BLOCKED');
  const r = a.analyze({ project_dir: makeProject() });
  assert.equal(r.ok, false);
  assert.equal(r.raw, null);
  assert.equal(r.facts, null);
});

test('SCIP adapter — missing index / blocked, no fake data', () => {
  const dir = makeProject();
  assert.equal(detectScipIndex(dir).present, false);
  const a = createScipAdapter();
  const r = a.analyze({ project_dir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.raw, null);
  assert.equal(SCIP_BLOCKER.status, 'BLOCKED');
});

test('SCIP adapter — index present still does not fake parse', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'index.scip'), 'not-a-real-index');
  const a = createScipAdapter();
  const can = a.canAnalyze({ project_dir: dir });
  assert.equal(can.ok, false);
  assert.equal(can.reason, 'scip_packaging_blocked');
  const r = a.analyze({ project_dir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.raw, null);
});

test('evidence fingerprint + freshness invalidation', () => {
  const facts = createStructuralFacts({
    analyzer: { id: 'forgeos-structural', name: 'x', version: '0.1.0-stage13' },
    project_fingerprint: 'aaa',
    input_fingerprint: 'bbb',
    evidence_class: 'deterministic',
    files: [{ path: 'a.mjs' }],
  });
  assert.ok(facts.analysis_fingerprint);
  assert.equal(isStructuralFactsFresh(facts, { project_fingerprint: 'aaa' }).fresh, true);
  assert.equal(isStructuralFactsFresh(facts, { project_fingerprint: 'zzz' }).fresh, false);
  assert.equal(isStructuralFactsFresh(facts, { analyzer_version: '9.9.9' }).fresh, false);
});

test('change-impact derivation from import edges', () => {
  const dir = makeProject();
  const facts = runStructuralAnalysis({ project_dir: dir, persist_cache: false }).facts;
  const impact = deriveImpactSet(facts, ['src/util.mjs']);
  assert.ok(impact.dependents.includes('src/index.mjs'));
  assert.ok(impact.impact_set.includes('src/index.mjs'));
});

test('assessment integration — structure uses structural evidence', () => {
  const dir = makeProject({ rootSource: true });
  const assessment = runProjectAssessment({
    project_dir: dir,
    persist: false,
    persist_structural_cache: false,
  });
  assert.equal(assessment.structural_intelligence.derived, true);
  assert.equal(assessment.structural_intelligence.authoritative, false);
  assert.equal(assessment.facts_summary.deterministic_intelligence_available, true);
  const structure = assessment.assessments.find((a) => a.binding.id === 'structure-audit');
  assert.ok(structure.assessment.evidence_class);
  assert.ok(structure.assessment.evidence.some((e) => e.type === 'misplaced_source_root'));
});

test('assessment — insufficient evidence does not become PASS/SATISFIED', () => {
  const dir = makeProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  for (const row of assessment.assessments) {
    assert.notEqual(row.assessment.state, 'SATISFIED');
  }
});

test('Canvas remains derived with evidence metadata', () => {
  const dir = makeProject();
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  assert.equal(assessment.canvas.derived, true);
  assert.equal(assessment.canvas.authoritative, false);
  const item = assessment.canvas.items.find((i) => i.capability_id === 'structure-audit');
  assert.ok(item.evidence_source || item.evidence_class);
});

test('resolver exposes deterministic_intelligence_available', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structure-audit');
  const r = resolveCapability({
    capability_id: 'structure-audit',
    capability_binding: binding,
    deterministic_intelligence_available: true,
  });
  assert.equal(r.deterministic_intelligence_available, true);
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('CLI inspect JSON', () => {
  const dir = makeProject();
  const out = runForgeOsInspectCli(['node', 'cli/inspect.mjs', dir, '--json'], { print: false });
  assert.equal(out.execute, false);
  assert.equal(out.mutate, false);
  assert.ok(out.facts);
  assert.equal(out.availability.tree_sitter.status, 'unavailable');
});

test('duplication assessment module wired', () => {
  const dir = makeProject({ duplicate: true });
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  const row = assessment.assessments.find((a) => a.binding.id === 'duplication-analysis');
  assert.equal(row.binding.assessment_module, 'forgeos.assessment.duplication');
  assert.ok(row.assessment.evidence.some((e) => e.type === 'exact_duplicate'));
});

test('dead-code candidates marked candidate', () => {
  const dir = makeProject({ rootSource: true });
  const assessment = runProjectAssessment({ project_dir: dir, persist: false });
  const row = assessment.assessments.find((a) => a.binding.id === 'dead-code-analysis');
  assert.equal(row.binding.assessment_module, 'forgeos.assessment.dead_code');
});

test('analyzer availability descriptor', () => {
  const d = describeAnalyzerAvailability();
  assert.equal(d.deterministic_intelligence_available, true);
  assert.equal(d.tree_sitter.packaging_status, 'BLOCKED');
  assert.equal(d.scip.packaging_status, 'BLOCKED');
});

test('project context helper', () => {
  const ctx = createProjectContext({ project_dir: '/x', files: ['b', 'a'] });
  assert.deepEqual(ctx.files, ['a', 'b']);
});

test('Stage 8–12 scripts exist', () => {
  for (const n of [8, 9, 10, 11, 12]) {
    assert.ok(fs.existsSync(path.join(REPO, `tests/runtime-stage${n}-negative.test.mjs`)));
  }
});

console.log(`\nStage 13 tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
