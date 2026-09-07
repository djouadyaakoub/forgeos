/**
 * Stage 9 negative / invariant tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('Stage 9 — Negative invariants\n');

test('assessment still does not import executeGoverned', () => {
  const engine = read('intelligence/assessment/engine.mjs');
  assert.ok(!/executeGoverned/.test(engine));
  assert.ok(!/coordinateGovernedExecution/.test(engine));
});

test('resolver still does not execute', () => {
  const resolver = read('intelligence/capability/resolver.mjs');
  assert.ok(!/executeGoverned/.test(resolver));
  assert.ok(!/coordinateGovernedExecution/.test(resolver));
});

test('approved loop uses coordinateGovernedExecution only', () => {
  const loop = read('intelligence/orchestrator/approved-execution.mjs');
  assert.ok(/coordinateGovernedExecution/.test(loop));
  assert.ok(!/backend\.start\s*\(/.test(loop.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')));
});

test('CLI has no --yes/--force handlers that approve', () => {
  const cli = read('cli/run.mjs');
  assert.ok(/forbidden_global_bypass/.test(cli));
  assert.ok(!/args\.yes === true/.test(cli));
});

test('approval module is not policy authority', () => {
  const approval = read('intelligence/orchestrator/approval.mjs');
  assert.ok(!/evaluatePreToolUse/.test(approval));
  assert.ok(!/POLICY_AUTHORITY/.test(approval));
});

console.log(`\nStage 9 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
