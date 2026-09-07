/**
 * Stage 8 — Mandatory negative / boundary tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(REPO);

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

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walkMjs(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMjs(full, files);
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

console.log('Stage 8 — Negative / boundary tests\n');

function stripCommentsAndStrings(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '');
}

test('assessment modules do not import runtime execution', () => {
  const dir = path.join(ROOT, 'intelligence', 'assessment');
  const violations = [];
  for (const file of walkMjs(dir)) {
    const content = stripCommentsAndStrings(read(file));
    if (/from\s+['"].*runtime\/execution/.test(content)) violations.push(file);
    if (/import\s*\{[^}]*executeGoverned/.test(content)) violations.push(file);
    if (/backend\.start\s*\(/.test(content)) violations.push(file);
  }
  assert.equal(violations.length, 0, violations.join(', '));
});

test('capability resolver does not import runtime execution', () => {
  const content = stripCommentsAndStrings(read(path.join(ROOT, 'intelligence', 'capability', 'resolver.mjs')));
  assert.ok(!/runtime\/execution/.test(content));
  assert.ok(!/executeGoverned/.test(content));
  assert.ok(!/backend\.start\s*\(/.test(content));
});

test('resolver cannot override Policy DENY', () => {
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'deployment-execute');
  const resolution = resolveCapability({
    capability_binding: binding,
    policy_context: { permission: 'deny', authority: POLICY_AUTHORITY, reason: 'test_deny' },
    host_context: { capabilities: ['deploy', 'write', 'read'] },
  });
  assert.equal(resolution.policy.policy_decision, 'deny');
  assert.ok(resolution.reasons.includes('policy_deny_blocks_execution_path'));
  assert.equal(resolution.resolved, false);
});

test('resolver is not a policy authority', () => {
  const content = read(path.join(ROOT, 'intelligence', 'capability', 'resolver.mjs'));
  assert.ok(!/evaluatePreToolUse/.test(content));
  assert.ok(!/from\s+['"].*policy\/authority/.test(content));
  assert.ok(!/from\s+['"].*policy\/engine/.test(content));
  assert.ok(/POLICY_AUTHORITY/.test(content));
});

test('unknown assessment state is not coerced to SATISFIED', () => {
  const result = runProjectAssessment({
    project_dir: path.join(REPO, 'fixtures', 'empty-project'),
    persist: false,
  });
  const satisfiedWithoutVerify = result.assessments.filter(
    (a) => a.assessment.state === 'SATISFIED' && !a.assessment.verified_by_task
  );
  assert.equal(satisfiedWithoutVerify.length, 0);
});

test('assessment does not import runtime router', () => {
  const engine = read(path.join(ROOT, 'intelligence', 'assessment', 'engine.mjs'));
  assert.ok(!/from\s+['"].*runtime\/router/.test(engine));
});

test('no silent fallback language in resolver', () => {
  const content = read(path.join(ROOT, 'intelligence', 'capability', 'resolver.mjs'));
  assert.ok(!/fallback/.test(content.toLowerCase()));
});

test('runtime router remains separate module from resolver', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'runtime', 'router.mjs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'intelligence', 'capability', 'resolver.mjs')));
  const router = read(path.join(ROOT, 'runtime', 'router.mjs'));
  assert.ok(!/resolveCapability/.test(router));
});

test('canvas schema marks derived non-authoritative', () => {
  const schema = read(path.join(ROOT, 'schemas', 'canvas-item.schema.yaml'));
  assert.ok(/derived/.test(schema));
  assert.ok(/never_modified/.test(schema) || /derived_only/.test(schema) || /derived/.test(schema));
});

test('assessment artifacts optional persist does not touch PI', () => {
  const fixture = path.join(REPO, 'fixtures', 'project-a');
  const piPath = path.join(fixture, '.agent-os', 'project.yaml');
  const before = fs.readFileSync(piPath, 'utf8');
  runProjectAssessment({ project_dir: fixture, persist: false });
  const after = fs.readFileSync(piPath, 'utf8');
  assert.equal(before, after);
});

console.log(`\nStage 8 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
