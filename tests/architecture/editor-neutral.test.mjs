#!/usr/bin/env node
/**
 * Editor neutrality — Core must not depend on Cursor adapter
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGenericHostWorkflow } from '../fixtures/generic-host/runtime.mjs';
import { normalizeCursorHookPayload } from '../../adapters/cursor/integration.mjs';
import { getHostAdapter } from '../../runtime/host-registry.mjs';
import { PRODUCT_ID } from '../../policy/identity.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(ROOT);
const FIXTURE_A = path.join(REPO, 'tests/fixtures/project-a');

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
  if (!cond) throw new Error(msg || 'assertion failed');
}

function walkCoreFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCoreFiles(full, files);
    else if (/\.mjs$/.test(entry.name)) files.push(full);
  }
  return files;
}

console.log('Editor Neutrality Tests\n');

console.log('--- Product identity ---');
test('PRODUCT_ID is forgeos', () => {
  assert(PRODUCT_ID === 'forgeos');
});

console.log('\n--- Core dependency rule ---');
test('Core paths do not import adapters/cursor', () => {
  const coreRoots = ['policy', 'intelligence', 'runtime', 'agents'].map((d) => path.join(REPO, d));
  const violations = [];
  for (const root of coreRoots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkCoreFiles(root)) {
      const rel = path.relative(REPO, file).replace(/\\/g, '/');
      if (rel === 'policy/identity.mjs') continue;
      const content = fs.readFileSync(file, 'utf8');
      if (/from\s+['"].*adapters\/cursor/.test(content)) {
        violations.push(rel);
      }
    }
  }
  assert(violations.length === 0, violations.join(', '));
});

console.log('\n--- Generic host fixture ---');
test('Generic host runs orchestrator without Cursor', () => {
  const { host, event, result } = runGenericHostWorkflow({
    project_path: FIXTURE_A,
    objective: 'explain structure',
  });
  assert(host.id === 'generic');
  assert(event.host.id === 'generic');
  assert(result.phase === 'development_intelligence_orchestration' || result.blocked);
});

console.log('\n--- Cursor adapter boundary ---');
test('Cursor adapter normalizes hook payload to runtime event', () => {
  const event = normalizeCursorHookPayload({
    tool_name: 'read_file',
    workspace_roots: [FIXTURE_A],
    agent: 'orchestrator',
  });
  assert(event.host.id === 'cursor');
  assert(event.type === 'tool_call');
  assert(event.meta.product === 'forgeos');
});

test('Cursor adapter is separate from generic host', () => {
  const cursor = getHostAdapter('cursor');
  const generic = getHostAdapter('generic');
  assert(cursor.id === 'cursor');
  assert(generic.id === 'generic');
  assert(cursor.capabilities.hooks === true);
  assert(generic.capabilities.hooks === false);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
