/**
 * Stage 13 — Security / architecture boundary tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForgeOsStructuralAdapter } from '../intelligence/adapters/forgeos-structural/index.mjs';
import { createBabelParserAdapter } from '../intelligence/adapters/babel-parser/index.mjs';
import { createTreeSitterAdapter } from '../intelligence/adapters/tree-sitter/index.mjs';
import { createScipAdapter } from '../intelligence/adapters/scip/index.mjs';
import { validateIntelligenceAdapter } from '../intelligence/adapters/adapter.mjs';
import { runStructuralAnalysis } from '../intelligence/adapters/index.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';
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

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s13n-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

console.log('Stage 13 — Negative / architecture\n');

test('adapter cannot authorize (no policy authority)', () => {
  for (const a of [createForgeOsStructuralAdapter(), createBabelParserAdapter(), createTreeSitterAdapter(), createScipAdapter()]) {
    assert.equal(a.claims_policy_authority, false);
    assert.equal(validateIntelligenceAdapter({ ...a, claims_policy_authority: true }).valid, false);
  }
});

test('adapter cannot execute / mutate flags', () => {
  for (const a of [createForgeOsStructuralAdapter(), createBabelParserAdapter(), createTreeSitterAdapter(), createScipAdapter()]) {
    assert.equal(a.may_execute, false);
    assert.equal(a.may_mutate, false);
    assert.equal(a.claims_project_intelligence_authority, false);
    assert.equal(a.claims_canvas_authority, false);
  }
});

test('adapter modules do not import execution lifecycle', () => {
  const files = [
    'intelligence/adapters/adapter.mjs',
    'intelligence/adapters/structural-facts.mjs',
    'intelligence/adapters/index.mjs',
    'intelligence/adapters/cache.mjs',
    'intelligence/adapters/forgeos-structural/index.mjs',
    'intelligence/adapters/babel-parser/index.mjs',
    'intelligence/adapters/babel-parser/extract.mjs',
    'intelligence/adapters/tree-sitter/index.mjs',
    'intelligence/adapters/scip/index.mjs',
  ];
  for (const rel of files) {
    const src = strip(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bexecuteGoverned\b/.test(src), rel);
    assert.ok(!/backend\.start/.test(src), rel);
    assert.ok(!/from ['"].*runtime\/execution/.test(src), rel);
    assert.ok(!/from ['"].*policy\/authority/.test(src), rel);
  }
});

test('adapter cannot mutate Project Intelligence', () => {
  const dir = makeDir();
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  const yaml = path.join(dir, '.agent-os', 'project.yaml');
  fs.writeFileSync(yaml, 'contract:\n  version: 1\nproject:\n  id: x\n');
  const before = fs.readFileSync(yaml, 'utf8');
  runStructuralAnalysis({ project_dir: dir, persist_cache: false });
  assert.equal(fs.readFileSync(yaml, 'utf8'), before);
});

test('assessment cannot execute', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/assessment/engine.mjs'), 'utf8'));
  assert.ok(!/\bexecuteGoverned\b/.test(src));
  assert.ok(!/backend\.start/.test(src));
  const dir = makeDir();
  const result = runProjectAssessment({ project_dir: dir, persist: false, skip_structural: false });
  assert.equal(result.execute, false);
});

test('resolver cannot execute', () => {
  const binding = loadCapabilityBindings().capabilities[0];
  const r = resolveCapability({ capability_id: binding.id, capability_binding: binding });
  assert.equal(r.execution_boundary, 'resolver_does_not_execute');
});

test('main agent cannot execute analyzers as executor', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/main-agent.mjs'), 'utf8'));
  assert.ok(!/runStructuralAnalysis|createForgeOsStructuralAdapter|backend\.start|executeGoverned/.test(src));
  const plan = planFromRequest({ request: 'audit structure', project_dir: makeDir(), persist: false });
  assert.equal(plan.execute, false);
});

test('deterministic evidence does not bypass Policy DENY', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'structure-audit');
  const r = resolveCapability({
    capability_id: 'structure-audit',
    capability_binding: binding,
    deterministic_intelligence_available: true,
    policy_context: { permission: 'deny' },
  });
  assert.equal(r.resolved, false);
  assert.equal(r.executable, false);
});

test('tree-sitter / SCIP do not invent symbols', () => {
  const dir = makeDir();
  assert.equal(createTreeSitterAdapter().analyze({ project_dir: dir }).raw, null);
  assert.equal(createScipAdapter().analyze({ project_dir: dir }).raw, null);
});

test('structural facts marked derived non-authoritative', () => {
  const facts = runStructuralAnalysis({ project_dir: makeDir(), persist_cache: false }).facts;
  assert.equal(facts.derived, true);
  assert.equal(facts.authoritative, false);
  assert.equal(facts.authority, 'derived_evidence');
});

test('Canvas authority not claimed by adapters', () => {
  assert.equal(
    validateIntelligenceAdapter({
      ...createForgeOsStructuralAdapter(),
      claims_canvas_authority: true,
    }).valid,
    false
  );
});

test('no automatic remediation in structural analyzer', () => {
  const src = strip(fs.readFileSync(path.join(REPO, 'intelligence/adapters/forgeos-structural/index.mjs'), 'utf8'));
  assert.ok(!/writeFileSync|unlinkSync|renameSync/.test(src));
});

console.log(`\nStage 13 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
