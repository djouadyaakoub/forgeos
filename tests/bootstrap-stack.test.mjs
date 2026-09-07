#!/usr/bin/env node
/**
 * Bootstrap stack detection tests (10 scenarios)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildProjectProfile,
  detectStackDetail,
  compareStackDetection,
  resolveProjectKind,
} from '../bootstrap/project-discovery.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(ROOT);
const FIXTURES = path.join(ROOT, 'fixtures');
const SPEED_FLEXY = process.env.SPEED_FLEXY_PATH || 'C:\\Apps\\speed-flexy-server';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function writeFixture(rel, files) {
  const base = path.join(FIXTURES, rel);
  fs.mkdirSync(base, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return base;
}

// Prepare fixtures
writeFixture('stack-go', { 'go.mod': 'module example.com/app\n\ngo 1.22\n' });
writeFixture('stack-flutter', { 'pubspec.yaml': 'name: demo\n' });
writeFixture('stack-node', { 'package.json': '{"name":"demo"}' });
writeFixture('stack-mixed', {
  'backend/go.mod': 'module example.com/backend\n',
  'mobile/pubspec.yaml': 'name: mobile\n',
  'web/package.json': '{"name":"web"}',
});
writeFixture('stack-initialized', {
  '.agent-os/project.yaml': 'schema_version: 1\nproject:\n  id: init\n  task_id_prefix: INIT\n',
  'AGENTS.md': '# Init\n',
});

console.log('Bootstrap Stack Detection Tests\n');

// Test 1 — Speed Flexy reference (skip if unavailable)
console.log('--- Test 1: Speed Flexy reference ---');
test('Speed Flexy detects Go, Flutter, Node from repository evidence', () => {
  if (process.env.FORGEOS_LIVE_PROJECT_TESTS !== '1' || !fs.existsSync(SPEED_FLEXY)) { console.log('  SKIP: live project opt-in/path unavailable'); return; }
  const stack = detectStackDetail(SPEED_FLEXY);
  assert(stack.repository.go, `go false; evidence: ${stack.evidence.go?.join(', ')}`);
  assert(stack.repository.flutter, `flutter false; evidence: ${stack.evidence.flutter?.join(', ')}`);
  assert(stack.repository.node, `node false; evidence: ${stack.evidence.node?.join(', ')}`);
});

// Test 2 — Empty project
console.log('\n--- Test 2: Empty project ---');
test('Empty project has all technologies false', () => {
  const empty = path.join(FIXTURES, 'empty-project');
  fs.mkdirSync(empty, { recursive: true });
  const stack = detectStackDetail(empty);
  assert(Object.values(stack.repository).every((v) => v === false), 'expected all false');
});

// Test 3 — Go fixture
console.log('\n--- Test 3: Go fixture ---');
test('Go fixture with go.mod detects Go', () => {
  const stack = detectStackDetail(path.join(FIXTURES, 'stack-go'));
  assert(stack.repository.go, 'go should be true');
});

// Test 4 — Flutter fixture
console.log('\n--- Test 4: Flutter fixture ---');
test('Flutter fixture with pubspec.yaml detects Flutter', () => {
  const stack = detectStackDetail(path.join(FIXTURES, 'stack-flutter'));
  assert(stack.repository.flutter, 'flutter should be true');
});

// Test 5 — Node fixture
console.log('\n--- Test 5: Node fixture ---');
test('Node fixture with package.json detects Node', () => {
  const stack = detectStackDetail(path.join(FIXTURES, 'stack-node'));
  assert(stack.repository.node, 'node should be true');
});

// Test 6 — Mixed project
console.log('\n--- Test 6: Mixed project ---');
test('Mixed fixture detects Go, Flutter, and Node', () => {
  const stack = detectStackDetail(path.join(FIXTURES, 'stack-mixed'));
  assert(stack.repository.go && stack.repository.flutter && stack.repository.node, 'all three expected');
});

// Test 7 — Absolute vs cwd path
console.log('\n--- Test 7: Path resolution ---');
test('Absolute path and cwd-relative detection are identical', () => {
  const mixed = path.join(FIXTURES, 'stack-mixed');
  const abs = path.resolve(mixed);
  const { same } = compareStackDetection(abs, abs);
  assert(same, 'absolute vs absolute should match');
});

// Test 8 — Existing project without adapter
console.log('\n--- Test 8: Existing project without adapter ---');
test('Existing project without .agent-os plans adapter creation', () => {
  const existing = writeFixture('stack-existing', {
    'AGENTS.md': '# Existing\n',
    'docs/STACK.md': '# Stack\n',
    'backend/go.mod': 'module x\n',
  });
  const kind = resolveProjectKind(existing);
  assert(kind.project_kind === 'EXISTING_PROJECT', `got ${kind.project_kind}`);
  assert(!kind.agent_os_initialized, 'adapter not initialized');
  const init = path.join(REPO_ROOT, 'bootstrap/initialize.mjs');
  const out = execSync(`node "${init}" --dry-run --project-dir "${existing}"`, { encoding: 'utf8' });
  assert(out.includes('"action": "create"'), 'should plan adapter creation');
  assert(out.includes('.agent-os/project.yaml'), 'should plan manifest');
});

// Test 9 — Agent OS initialized
console.log('\n--- Test 9: Agent OS initialized ---');
test('Project with .agent-os/project.yaml is AGENT_OS_INITIALIZED', () => {
  const init = path.join(FIXTURES, 'stack-initialized');
  const kind = resolveProjectKind(init);
  assert(kind.project_kind === 'AGENT_OS_INITIALIZED', `got ${kind.project_kind}`);
  assert(kind.agent_os_initialized, 'should be initialized');
});

// Test 10 — Unsupported/empty diagnostic
console.log('\n--- Test 10: Empty diagnostic ---');
test('Mature-looking project without markers reports stack_detection_warning', () => {
  const bare = writeFixture('stack-bare-docs', {
    'AGENTS.md': '# Bare\n',
    'docs/STACK.md': '# Stack mentions Go and Flutter\n',
    'README.md': '# Readme\n',
  });
  const profile = buildProjectProfile(bare);
  assert(profile.diagnostics.some((d) => d.type === 'stack_detection_warning'), 'expected warning');
  assert(!Object.values(profile.stack.repository).some(Boolean), 'no false positive stack flags');
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
