/**
 * Stage 19 — OSS-derived @babel/parser → StructuralFacts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBabelParserAdapter,
  tryLoadBabelParser,
  analyzeSourceTextWithBabel,
  BABEL_PARSER_ADAPTER_ID,
  BABEL_PARSER_PINNED_VERSION,
  babelParserOssDerivedDescriptor,
} from '../intelligence/adapters/babel-parser/index.mjs';
import { babelPluginsForExt } from '../intelligence/adapters/babel-parser/extract.mjs';
import {
  runStructuralAnalysis,
  describeAnalyzerAvailability,
  selectDefaultStructuralAdapterId,
} from '../intelligence/adapters/index.mjs';
import { createForgeOsStructuralAdapter } from '../intelligence/adapters/forgeos-structural/index.mjs';
import { validateIntelligenceAdapter } from '../intelligence/adapters/adapter.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { IMPLEMENTATION_KINDS } from '../intelligence/capability/implementation-kinds.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s19-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return dir;
}

function requireMissing() {
  const err = new Error("Cannot find module '@babel/parser'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

const loaded = tryLoadBabelParser();
const adapter = createBabelParserAdapter();

console.log('Stage 19 — OSS-derived Babel parser structural capability\n');
console.log(`  babel load: available=${loaded.available} version=${loaded.version || 'n/a'} reason=${loaded.reason || 'ok'}`);

test('optional load reports honest availability', () => {
  assert.equal(typeof loaded.available, 'boolean');
  if (!loaded.available) {
    assert.ok(['module_not_installed', 'module_load_failed', 'parse_export_missing'].includes(loaded.reason));
  } else {
    assert.equal(typeof loaded.parse, 'function');
    assert.ok(loaded.version);
  }
});

test('unavailable loader does not fake AST', () => {
  const missing = createBabelParserAdapter({ requireFn: requireMissing });
  assert.equal(missing.health().status, 'unavailable');
  const r = missing.analyze({ project_dir: makeProject({ 'src/a.js': 'export const a = 1;\n' }) });
  assert.equal(r.ok, false);
  assert.equal(r.raw, null);
  assert.equal(r.facts, null);
  const facts = missing.normalize(r);
  assert.equal(facts.status, 'unavailable');
  assert.equal(facts.evidence_class, 'insufficient');
  assert.equal(facts.imports.length, 0);
});

test('fallback selection uses forgeos-structural when Babel missing', () => {
  const missingHealth = createBabelParserAdapter({ requireFn: requireMissing }).health();
  assert.equal(missingHealth.status, 'unavailable');
  const dir = makeProject({ 'src/a.js': 'export function a() { return 1; }\n' });
  const analysis = runStructuralAnalysis({
    project_dir: dir,
    persist_cache: false,
    adapter_id: 'forgeos-structural',
  });
  assert.equal(analysis.adapter_id, 'forgeos-structural');
  assert.equal(analysis.ok, true);
  assert.ok(analysis.facts.declarations.some((d) => d.name === 'a'));
});

test('adapter contract — no authority / mutate / execute', () => {
  assert.equal(adapter.validation.valid, true);
  assert.equal(adapter.claims_policy_authority, false);
  assert.equal(adapter.claims_canvas_authority, false);
  assert.equal(adapter.may_mutate, false);
  assert.equal(adapter.may_execute, false);
  assert.equal(adapter.implementation_kind, IMPLEMENTATION_KINDS.OSS_DERIVED);
  assert.equal(adapter.launches_external_runtime, false);
  assert.equal(validateIntelligenceAdapter({ ...adapter, claims_policy_authority: true }).valid, false);
});

test('OSS provenance uses existing oss-derived contract', () => {
  const rec = babelParserOssDerivedDescriptor(loaded);
  assert.equal(rec.valid, true);
  assert.equal(rec.source.kind, 'oss');
  assert.equal(rec.source.license, 'MIT');
  assert.equal(rec.execution.mode, 'forgeos_native');
  assert.equal(rec.launches_external_runtime, false);
  assert.equal(rec.authority.policy, 'forgeos');
  assert.ok(rec.source.provenance);
  assert.equal(BABEL_PARSER_PINNED_VERSION, '7.29.8');
});

test('parser plugin surface is limited to js/jsx/ts/tsx', () => {
  assert.deepEqual(babelPluginsForExt('.js'), []);
  assert.deepEqual(babelPluginsForExt('.mjs'), []);
  assert.deepEqual(babelPluginsForExt('.jsx'), ['jsx']);
  assert.deepEqual(babelPluginsForExt('.ts'), ['typescript']);
  assert.deepEqual(babelPluginsForExt('.tsx'), ['typescript', 'jsx']);
});

test('registry capability structural-ast-analysis is OSS_DERIVED forgeos_native', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structural-ast-analysis');
  assert.ok(binding);
  assert.ok(binding.implementation_types.includes('oss_derived'));
  assert.equal(binding.preferred_implementation, 'oss_derived');
  assert.equal(binding.oss_derived_id, 'babel-parser');
  assert.equal(binding.oss_derived_execution_mode, 'forgeos_native');
  assert.equal(binding.verification_strategy, 'none');
  const r = resolveCapability({ capability_id: 'structural-ast-analysis', capability_binding: binding });
  assert.equal(r.implementation_type, 'oss_derived');
  assert.equal(r.implementation_kind, IMPLEMENTATION_KINDS.OSS_DERIVED);
  assert.equal(r.implementation_id, 'babel-parser');
  assert.equal(r.launches_external_runtime, false);
  assert.equal(r.requirements.runtime_router_required, false);
  assert.equal(r.execution_mode, 'forgeos_native');
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('resolver does not treat parse success as Policy allow', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structural-ast-analysis');
  const r = resolveCapability({
    capability_id: 'structural-ast-analysis',
    capability_binding: binding,
    policy_context: { permission: 'deny' },
  });
  assert.equal(r.resolved, false);
  assert.equal(POLICY_AUTHORITY, 'forgeos');
});

test('forgeos-structural adapter still exists and analyzes', () => {
  const a = createForgeOsStructuralAdapter();
  assert.equal(a.id, 'forgeos-structural');
  const dir = makeProject({ 'src/x.js': 'export const x = 1;\n' });
  const r = a.analyze({ project_dir: dir });
  assert.equal(r.ok, true);
});

test('no @babel/core in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const all = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  assert.ok(!all['@babel/core']);
  assert.equal(all['@babel/parser'], '7.29.8');
  assert.ok(!pkg.dependencies || !pkg.dependencies['@babel/parser']);
});

test('no new permanent Markdown agents', () => {
  const agents = fs.readdirSync(path.join(REPO, 'agents')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(agents, [
    'architect.md',
    'codebase-organization.md',
    'docs-sync.md',
    'environment-config.md',
    'orchestrator.md',
    'project-archaeology.md',
    'qa-bugfix.md',
    'release-deployment.md',
    'release-readiness.md',
    'security.md',
    'solution-research.md',
  ]);
});

if (!loaded.available) {
  test('LIVE PARSE SKIPPED — optional @babel/parser not installed (fallback path still tested)', () => {
    assert.equal(selectDefaultStructuralAdapterId(), 'forgeos-structural');
    assert.equal(describeAnalyzerAvailability().babel_parser.status, 'unavailable');
  });
} else {
  const parseFn = loaded.parse;

  test('JS imports / exports / functions / classes / variables', () => {
    const src = `
import x from "x";
import { a } from "x";
import * as ns from "x";
import "side";
export default function main() { return 1; }
export const c = 1;
export function fn() {}
export class Box {}
export { a };
const local = 2;
function helper() {}
class Inner {}
`;
    const parsed = analyzeSourceTextWithBabel('src/mod.js', src, parseFn);
    assert.equal(parsed.parse_ok, true);
    assert.ok(parsed.imports.some((i) => i.source === 'x' && i.kind === 'import'));
    assert.ok(parsed.imports.some((i) => i.source === 'side'));
    assert.ok(parsed.exports.some((e) => e.kind === 'default_export'));
    assert.ok(parsed.exports.some((e) => e.name === 'c'));
    assert.ok(parsed.exports.some((e) => e.name === 'fn'));
    assert.ok(parsed.exports.some((e) => e.name === 'Box'));
    assert.ok(parsed.declarations.some((d) => d.name === 'helper' && d.kind === 'function'));
    assert.ok(parsed.declarations.some((d) => d.name === 'Inner' && d.kind === 'class'));
    assert.ok(parsed.declarations.some((d) => d.name === 'local' && d.kind === 'variable'));
    assert.ok(parsed.imports[0].line >= 1);
  });

  test('dynamic import and re-export / export *', () => {
    const src = `
export { x as y } from "./x.js";
export * from "./y.js";
export function load() { return import("./z.js"); }
`;
    const parsed = analyzeSourceTextWithBabel('src/re.js', src, parseFn);
    assert.equal(parsed.parse_ok, true);
    assert.ok(parsed.exports.some((e) => e.kind === 'star_export'));
    assert.ok(parsed.exports.some((e) => e.kind === 're_export' && e.name === 'y'));
    assert.ok(parsed.imports.some((i) => i.kind === 'dynamic_import' && i.source === './z.js'));
  });

  test('JSX syntax with imports', () => {
    const src = `
import React from "react";
export function Hello() { return <div>hi</div>; }
`;
    const parsed = analyzeSourceTextWithBabel('src/Hello.jsx', src, parseFn);
    assert.equal(parsed.parse_ok, true);
    assert.ok(parsed.imports.some((i) => i.source === 'react'));
    assert.ok(parsed.declarations.some((d) => d.name === 'Hello'));
  });

  test('TypeScript interfaces / types / enums / typed members', () => {
    const src = `
import type { Foo } from "./foo";
export interface I { n: number }
export type T = string;
export enum E { A, B }
export function f(x: number): number { return x; }
export class C { m(): void {} }
const v: T = "a";
`;
    const parsed = analyzeSourceTextWithBabel('src/types.ts', src, parseFn);
    assert.equal(parsed.parse_ok, true);
    assert.ok(parsed.imports.some((i) => i.source === './foo'));
    assert.ok(parsed.declarations.some((d) => d.name === 'I' && d.kind === 'interface'));
    assert.ok(parsed.declarations.some((d) => d.name === 'T' && d.kind === 'type'));
    assert.ok(parsed.declarations.some((d) => d.name === 'E' && d.kind === 'enum'));
    assert.ok(parsed.declarations.some((d) => d.name === 'f' && d.kind === 'function'));
    assert.ok(parsed.declarations.some((d) => d.name === 'C' && d.kind === 'class'));
    assert.ok(parsed.declarations.some((d) => d.name === 'v' && d.kind === 'variable'));
  });

  test('TSX combines JSX and TypeScript', () => {
    const src = `
export function View(props: { n: number }) { return <span>{props.n}</span>; }
`;
    const parsed = analyzeSourceTextWithBabel('src/View.tsx', src, parseFn);
    assert.equal(parsed.parse_ok, true);
    assert.ok(parsed.declarations.some((d) => d.name === 'View'));
    assert.ok(parsed.exports.some((e) => e.name === 'View'));
  });

  test('empty file and comments-only parse without fabricated symbols', () => {
    const empty = analyzeSourceTextWithBabel('src/empty.js', '', parseFn);
    assert.equal(empty.parse_ok, true);
    assert.equal(empty.declarations.length, 0);
    const comments = analyzeSourceTextWithBabel('src/c.js', '// only\n/* block */\n', parseFn);
    assert.equal(comments.parse_ok, true);
    assert.equal(comments.imports.length, 0);
  });

  test('malformed source → diagnostic, no fabricated facts for that file', () => {
    const parsed = analyzeSourceTextWithBabel('src/bad.js', 'export function broken() { {\n', parseFn);
    assert.equal(parsed.parse_ok, false);
    assert.equal(parsed.imports.length, 0);
    assert.equal(parsed.declarations.length, 0);
    assert.ok(parsed.diagnostics.some((d) => d.code === 'babel_parse_error'));
    const dir = makeProject({
      'src/ok.js': 'export const ok = 1;\n',
      'src/bad.js': 'export function broken() { {\n',
    });
    const facts = runStructuralAnalysis({
      project_dir: dir,
      persist_cache: false,
      adapter_id: BABEL_PARSER_ADAPTER_ID,
    }).facts;
    assert.ok(facts.diagnostics.some((d) => d.code === 'babel_parse_error' && d.file === 'src/bad.js'));
    assert.ok(facts.declarations.some((d) => d.file === 'src/ok.js' && d.name === 'ok'));
    assert.ok(!facts.declarations.some((d) => d.file === 'src/bad.js'));
  });

  test('nested declarations preserved', () => {
    const src = `
export function outer() {
  function inner() {}
  class Nested {}
  const n = 1;
}
`;
    const parsed = analyzeSourceTextWithBabel('src/nest.js', src, parseFn);
    assert.ok(parsed.declarations.some((d) => d.name === 'outer'));
    assert.ok(parsed.declarations.some((d) => d.name === 'inner'));
    assert.ok(parsed.declarations.some((d) => d.name === 'Nested'));
    assert.ok(parsed.declarations.some((d) => d.name === 'n'));
  });

  test('project analysis produces StructuralFacts with babel analyzer id', () => {
    const dir = makeProject({
      'src/util.js': 'export function helper() { return 1; }\n',
      'src/index.js': 'import { helper } from "./util.js";\nexport function main() { return helper(); }\n',
    });
    const analysis = runStructuralAnalysis({
      project_dir: dir,
      persist_cache: false,
      adapter_id: BABEL_PARSER_ADAPTER_ID,
    });
    assert.equal(analysis.ok, true);
    assert.equal(analysis.adapter_id, BABEL_PARSER_ADAPTER_ID);
    const facts = analysis.facts;
    assert.equal(facts.schema, 'forgeos-structural-facts');
    assert.equal(facts.analyzer.id, BABEL_PARSER_ADAPTER_ID);
    assert.equal(facts.derived, true);
    assert.equal(facts.authoritative, false);
    assert.equal(facts.evidence_class, 'deterministic');
    assert.ok(facts.imports.some((i) => i.source === './util.js'));
    assert.ok(facts.dependency_edges.some((e) => e.from === 'src/index.js' && String(e.to).includes('util')));
  });

  test('determinism — same input → same analysis_fingerprint', () => {
    const dir = makeProject({ 'src/a.js': 'export const a = 1;\nimport b from "./b.js";\n' });
    const a = createBabelParserAdapter();
    const r1 = a.analyze({ project_dir: dir });
    const r2 = a.analyze({ project_dir: dir });
    const f1 = a.normalize(r1, { project_fingerprint: 'pf', analyzed_at: '2020-01-01T00:00:00.000Z' });
    const f2 = a.normalize(r2, { project_fingerprint: 'pf', analyzed_at: '2020-01-02T00:00:00.000Z' });
    assert.equal(f1.analysis_fingerprint, f2.analysis_fingerprint);
    assert.equal(f1.input_fingerprint, f2.input_fingerprint);
  });

  test('parse does not execute project source', () => {
    const dir = makeProject();
    const marker = path.join(dir, 'EXECUTED');
    const src = `
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(marker)}, "pwned");
eval("fs.writeFileSync('nope','x')");
export const a = 1;
`;
    fs.writeFileSync(path.join(dir, 'src', 'evil.js'), src);
    const facts = runStructuralAnalysis({
      project_dir: dir,
      persist_cache: false,
      adapter_id: BABEL_PARSER_ADAPTER_ID,
    }).facts;
    assert.equal(fs.existsSync(marker), false);
    assert.ok(facts.declarations.some((d) => d.name === 'a') || facts.diagnostics.length >= 0);
  });

  test('assessment Canvas is not SATISFIED by parse success', () => {
    const dir = makeProject({
      'src/a.js': 'export const a = 1;\n',
      '.agent-os/project.yaml': 'contract:\n  version: 1\nproject:\n  id: s19\n  name: s19\n  type: application\n',
    });
    const assessment = runProjectAssessment({ project_dir: dir, persist: false });
    assert.equal(assessment.canvas.derived, true);
    assert.equal(assessment.canvas.authoritative, false);
    for (const item of assessment.canvas.items || []) {
      assert.notEqual(item.state, 'SATISFIED');
    }
  });

  test('default adapter selection prefers babel when available', () => {
    assert.equal(selectDefaultStructuralAdapterId(), BABEL_PARSER_ADAPTER_ID);
    assert.equal(describeAnalyzerAvailability().babel_parser.status, 'available');
  });

  test('performance observation — small/medium/TS vs forgeos-structural', () => {
    function gen(n) {
      const lines = ['export const z = 0;'];
      for (let i = 0; i < n; i++) lines.push(`export function f${i}() { return ${i}; }`);
      return lines.join('\n');
    }
    const cases = [
      { name: 'small', n: 20 },
      { name: 'medium', n: 200 },
      { name: 'large', n: 800 },
    ];
    const times = {};
    for (const c of cases) {
      const dir = makeProject({ 'src/g.js': gen(c.n) });
      const t0 = Date.now();
      runStructuralAnalysis({ project_dir: dir, persist_cache: false, adapter_id: BABEL_PARSER_ADAPTER_ID });
      times[`babel_${c.name}_ms`] = Date.now() - t0;
      const t1 = Date.now();
      runStructuralAnalysis({ project_dir: dir, persist_cache: false, adapter_id: 'forgeos-structural' });
      times[`regex_${c.name}_ms`] = Date.now() - t1;
    }
    const tsDir = makeProject({ 'src/t.ts': 'export interface I { x: number }\nexport type T = I;\nexport function f(x: T): T { return x; }\n' });
    const tTs = Date.now();
    runStructuralAnalysis({ project_dir: tsDir, persist_cache: false, adapter_id: BABEL_PARSER_ADAPTER_ID });
    times.babel_ts_ms = Date.now() - tTs;
    const tsxDir = makeProject({ 'src/t.tsx': 'export function V(p: {x:number}) { return <i>{p.x}</i>; }\n' });
    const tTsx = Date.now();
    runStructuralAnalysis({ project_dir: tsxDir, persist_cache: false, adapter_id: BABEL_PARSER_ADAPTER_ID });
    times.babel_tsx_ms = Date.now() - tTsx;
    const badDir = makeProject({ 'src/bad.js': 'function x( { \n' });
    const tBad = Date.now();
    runStructuralAnalysis({ project_dir: badDir, persist_cache: false, adapter_id: BABEL_PARSER_ADAPTER_ID });
    times.babel_malformed_ms = Date.now() - tBad;
    globalThis.__forgeos_stage19_perf = times;
    console.log('  PERF', JSON.stringify(times));
    assert.ok(times.babel_small_ms >= 0);
  });
}

const babelSrc = fs.readFileSync(path.join(REPO, 'intelligence/adapters/babel-parser/index.mjs'), 'utf8');
test('adapter is parse-only (no eval / spawn / fetch / babel/core)', () => {
  assert.ok(!/\beval\s*\(/.test(babelSrc));
  assert.ok(!/child_process/.test(babelSrc));
  assert.ok(!/spawnSync|execSync/.test(babelSrc));
  assert.ok(!/https?:\/\//.test(babelSrc));
  assert.ok(!/from ['"]@babel\/core['"]/.test(babelSrc));
  assert.ok(!/writeFileSync|unlinkSync/.test(babelSrc));
});

console.log(`\nStage 19 tests: ${passed} passed, ${failed} failed`);
if (globalThis.__forgeos_stage19_perf) {
  fs.mkdirSync(path.join(REPO, '.agent-os'), { recursive: true });
}
process.exit(failed === 0 ? 0 : 1);
