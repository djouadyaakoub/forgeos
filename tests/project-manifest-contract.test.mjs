#!/usr/bin/env node
/**
 * P0 contract tests — empty-list YAML round-trip + minimal orchestrator
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { adapterToYaml } from '../bootstrap/adapter-extraction.mjs';
import {
  parseSimpleYaml,
  loadProjectManifest,
  normalizeManifestListFields,
} from '../policy/project-adapter.mjs';
import { discoverCapabilities } from '../intelligence/orchestrator/scoring.mjs';
import { coordinateDevelopmentWorkflow } from '../intelligence/orchestrator/coordinator.mjs';

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
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('project-manifest-contract');

test('A — empty capabilities serialize/parse as []', () => {
  const yaml = adapterToYaml(
    { capabilities: [], agents: {}, ownership: [], policy: {}, integrations: { mcp: [] }, verification: { commands: [] } },
    { id: 'empty-caps', name: 'Empty Caps', task_id_prefix: 'EMP' },
  );
  assert(/capabilities:\s*\[\]/.test(yaml), 'expected inline capabilities: []');
  assert(!/capabilities:\s*\n\s+\[\]/.test(yaml), 'must not emit multiline empty-list sentinel');
  const parsed = parseSimpleYaml(yaml);
  assert(Array.isArray(parsed.capabilities), `capabilities type ${typeof parsed.capabilities}`);
  assert(parsed.capabilities.length === 0, 'capabilities length');
  const normalized = normalizeManifestListFields(parsed);
  assert(Array.isArray(normalized.capabilities) && normalized.capabilities.length === 0);
  const caps = discoverCapabilities({ capabilities: [{ id: 'orchestration', specialist_ids: ['orchestrator'] }] }, normalized);
  assert(caps.some((c) => c.id === 'orchestration'), 'global caps still merge');
});

test('B — inline capabilities: [] loads via loadProjectManifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-manifest-b-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os/project.yaml'),
    `schema_version: 1\nagent_os:\n  version: ">=1.0 <2.0"\nproject:\n  id: bare\n  name: Bare\n  type: application\n  task_id_prefix: BARE\ncapabilities: []\nownership: []\npolicy:\n  protected_paths: []\n  tier3_operations: []\nintegrations:\n  mcp: []\nverification:\n  commands: []\n`,
    'utf8',
  );
  const { data } = loadProjectManifest(dir);
  assert(data, 'manifest loaded');
  assert(Array.isArray(data.capabilities) && data.capabilities.length === 0);
  assert(Array.isArray(data.ownership) && data.ownership.length === 0);
  assert(Array.isArray(data.policy.protected_paths));
  assert(Array.isArray(data.integrations.mcp));
  assert(Array.isArray(data.verification.commands));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B2 — legacy multiline empty list capabilities:\\n  [] normalizes to []', () => {
  const parsed = parseSimpleYaml('capabilities:\n  []\nownership:\n  []\n');
  assert(Array.isArray(parsed.capabilities), 'legacy capabilities must parse as array');
  assert(parsed.capabilities.length === 0);
  assert(Array.isArray(parsed.ownership) && parsed.ownership.length === 0);
});

test('C — orchestrator accepts minimal empty project adapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-orch-c-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"orch-min","version":"0.0.1"}\n');
  fs.writeFileSync(
    path.join(dir, '.agent-os/project.yaml'),
    adapterToYaml(
      { capabilities: [], agents: {}, ownership: [], policy: { protected_paths: [], tier3_operations: [] }, integrations: { mcp: [] }, verification: { commands: [] } },
      { id: 'orch-min', name: 'Orch Min', task_id_prefix: 'ORCH', stack: { repository: { node: true }, components: { '.': { node: true } } } },
    ),
    'utf8',
  );
  process.env.CURSOR_PROJECT_DIR = dir;
  const result = coordinateDevelopmentWorkflow({
    project_dir: dir,
    objective: 'Inspect this project and identify which specialist should own a change. Do not modify files.',
    task_id: 'ORCH-20260903-001',
  });
  assert(!result.blocked, `blocked: ${result.reason || ''}`);
  assert(result.plan?.development_workflow, 'missing development_workflow');
  assert(result.execution?.workflow_execution, 'missing execution record');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('D — non-empty capabilities still round-trip', () => {
  const yaml = adapterToYaml(
    {
      capabilities: [{ id: 'node-api', agent: 'architect', source: 'test', domains: ['backend'] }],
      agents: { architect: { file: 'agents/architect.md', source: 'test' } },
      ownership: [{ agent: 'architect', paths: ['src/**'], source: 'test' }],
      policy: { protected_paths: ['.cursor/hooks.json'], tier3_operations: [] },
      integrations: { mcp: [] },
      verification: { commands: [] },
    },
    { id: 'rich', name: 'Rich', task_id_prefix: 'RICH' },
  );
  const parsed = normalizeManifestListFields(parseSimpleYaml(yaml));
  assert(parsed.capabilities.length === 1);
  assert(parsed.capabilities[0].id === 'node-api' || parsed.capabilities[0] === 'id: node-api' || String(parsed.capabilities[0]).includes('node-api') || parsed.capabilities.some((c) => c === 'id: node-api' || c?.id === 'node-api'));
  // list items with "id: x" may parse as strings in simple yaml — ensure array non-empty
  assert(Array.isArray(parsed.ownership) && parsed.ownership.length >= 1);
  assert(Array.isArray(parsed.policy.protected_paths));
});

test('E — other empty list fields are arrays not objects/strings', () => {
  const yaml = adapterToYaml(
    { capabilities: [], agents: {}, ownership: [], policy: { protected_paths: [], tier3_operations: [] }, integrations: { mcp: [] }, verification: { commands: [] } },
    { id: 'lists', name: 'Lists' },
  );
  const parsed = normalizeManifestListFields(parseSimpleYaml(yaml));
  for (const [label, value] of [
    ['capabilities', parsed.capabilities],
    ['ownership', parsed.ownership],
    ['protected_paths', parsed.policy.protected_paths],
    ['tier3_operations', parsed.policy.tier3_operations],
    ['mcp', parsed.integrations.mcp],
    ['commands', parsed.verification.commands],
  ]) {
    assert(Array.isArray(value), `${label} must be array, got ${typeof value}`);
    assert(value.length === 0, `${label} must be empty`);
    assert(typeof value !== 'string', `${label} must not be string`);
  }
});

test('fail-closed — non-empty object on list field throws', () => {
  let threw = false;
  try {
    normalizeManifestListFields({ capabilities: { id: 'x' } });
  } catch {
    threw = true;
  }
  assert(threw, 'expected throw for non-empty object capabilities');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
