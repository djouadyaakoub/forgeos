#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 1 — Project Intelligence Contract tests
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
  toProjectIntelligenceContract,
  validateProjectIntelligenceContract,
  mergeEffectiveCapabilities,
  CURRENT_CONTRACT_VERSION,
  getFieldAuthority,
} from '../policy/project-adapter.mjs';
import { discoverCapabilities } from '../intelligence/orchestrator/scoring.mjs';
import { coordinateDevelopmentWorkflow } from '../intelligence/orchestrator/coordinator.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_A = path.join(ROOT, 'tests/fixtures/project-a');
const FIXTURE_INIT = path.join(ROOT, 'tests/fixtures/adapter-initialized');

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

console.log('project-intelligence-contract (Stage 1)');

test('A — empty greenfield contract', () => {
  const yaml = adapterToYaml(
    {
      capabilities: [],
      agents: {},
      ownership: [],
      policy: { protected_paths: [], tier3_operations: [] },
      integrations: { mcp: [] },
      verification: { commands: [] },
    },
    { id: 'green', name: 'Green', task_id_prefix: 'GRN' },
  );
  assert(/contract:\s*\n\s*version:\s*1/.test(yaml), 'writes contract.version');
  assert(/runtime:\s*\n\s*requirements:\s*\{\}/.test(yaml), 'writes runtime.requirements');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-pic-a-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agent-os/project.yaml'), yaml);
  const { data, validation } = loadProjectManifest(dir);
  assert(validation.valid, validation.issues?.join('; '));
  assert(data.contract.version === CURRENT_CONTRACT_VERSION);
  assert(Array.isArray(data.capabilities) && data.capabilities.length === 0);
  assert(data.agents && typeof data.agents === 'object' && !Array.isArray(data.agents));
  assert(Array.isArray(data.ownership) && data.ownership.length === 0);
  assert(data.runtime?.requirements && typeof data.runtime.requirements === 'object');
  assert(data._meta?.capability_model?.effective);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B — existing populated project-a preserves identity', () => {
  const { data, validation } = loadProjectManifest(FIXTURE_A);
  assert(validation.valid, validation.issues?.join('; '));
  assert(data.project.id === 'project-a');
  assert(data.contract.version === 1);
  assert(data._meta.legacy_without_contract_block === true);
  assert(Object.keys(data.agents).includes('postgres-specialist'));
  assert(Array.isArray(data.capabilities));
  assert(Array.isArray(data.policy.tier3_operations));
});

test('C — YAML round-trip semantic structure', () => {
  const original = {
    capabilities: [{ id: 'cap-a', agent: 'architect', source: 't' }],
    agents: { architect: { file: 'agents/architect.md', source: 't' } },
    ownership: [{ agent: 'architect', paths: ['src/**'], source: 't' }],
    policy: { protected_paths: ['.cursor/hooks.json'], tier3_operations: [] },
    integrations: { mcp: [] },
    verification: { commands: [] },
    knowledge: { stack: 'docs/STACK.md' },
  };
  const yaml = adapterToYaml(original, { id: 'rt', name: 'RT', task_id_prefix: 'RT', stack: { repository: { node: true }, components: { '.': { node: true } } } });
  const parsed = toProjectIntelligenceContract(normalizeManifestListFields(parseSimpleYaml(yaml)));
  assert(parsed.contract.version === 1);
  assert(Array.isArray(parsed.capabilities));
  assert(parsed.capabilities.length >= 1);
  assert(Array.isArray(parsed.ownership) && parsed.ownership.length >= 1);
  assert(Array.isArray(parsed.policy.protected_paths));
  assert(parsed.stack?.detected?.includes?.('node') || (Array.isArray(parsed.stack?.detected) && parsed.stack.detected.includes('node')));
  // booleans / empty object
  const emptyMap = parseSimpleYaml('runtime:\n  requirements: {}\nagents: {}\n');
  assert(typeof emptyMap.agents === 'object' && !Array.isArray(emptyMap.agents));
  assert(typeof emptyMap.runtime.requirements === 'object');
});

test('D — legacy adapter-initialized minimal manifest', () => {
  const { data, validation } = loadProjectManifest(FIXTURE_INIT);
  assert(validation.valid, validation.issues?.join('; '));
  assert(data.project.id === 'init');
  assert(data.contract.version === 1);
  assert(Array.isArray(data.capabilities));
});

test('E — invalid capabilities object fail-closed', () => {
  let threw = false;
  try {
    normalizeManifestListFields({ capabilities: { id: 'x' }, project: { id: 'bad' } });
  } catch {
    threw = true;
  }
  assert(threw, 'expected normalize throw');
});

test('F — global + project capability merge', () => {
  const global = { capabilities: [{ id: 'orchestration', specialist_ids: ['orchestrator'] }] };
  const project = { capabilities: [{ id: 'postgres-specialist', agent: 'postgres-specialist' }] };
  const effective = mergeEffectiveCapabilities(global, project);
  assert(effective.some((c) => c.id === 'orchestration' && c.scope === 'global'));
  assert(effective.some((c) => c.id === 'postgres-specialist' && c.scope === 'project'));
  const emptyProject = mergeEffectiveCapabilities(global, { capabilities: [] });
  assert(emptyProject.some((c) => c.id === 'orchestration'));
  assert(emptyProject.length === 1);
});

test('G — protected paths field authority is AUTHORITATIVE', () => {
  assert(getFieldAuthority('policy.protected_paths') === 'AUTHORITATIVE');
  assert(getFieldAuthority('stack') === 'DISCOVERED');
  assert(getFieldAuthority('runtime.requirements') === 'DECLARED');
});

test('H — empty capabilities still merge via discoverCapabilities', () => {
  const caps = discoverCapabilities(
    { capabilities: [{ id: 'orchestration', specialist_ids: ['orchestrator'] }] },
    { capabilities: [] },
  );
  assert(caps.some((c) => c.id === 'orchestration'));
});

test('I — orchestrator on greenfield contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-pic-i-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"pic-min","version":"0.0.1"}\n');
  fs.writeFileSync(
    path.join(dir, '.agent-os/project.yaml'),
    adapterToYaml(
      { capabilities: [], agents: {}, ownership: [], policy: { protected_paths: [], tier3_operations: [] }, integrations: { mcp: [] }, verification: { commands: [] } },
      { id: 'pic-min', name: 'PIC Min', task_id_prefix: 'PIC', stack: { repository: { node: true }, components: { '.': { node: true } } } },
    ),
  );
  process.env.CURSOR_PROJECT_DIR = dir;
  const result = coordinateDevelopmentWorkflow({
    project_dir: dir,
    objective: 'Inspect this project. Do not modify files.',
    task_id: 'PIC-20260903-001',
  });
  assert(!result.blocked, result.reason || 'blocked');
  assert(result.plan?.development_workflow);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unsupported contract version fails closed', () => {
  let threw = false;
  try {
    toProjectIntelligenceContract({ contract: { version: 99 }, project: { id: 'x' }, capabilities: [], ownership: [], agents: {} });
  } catch {
    threw = true;
  }
  assert(threw);
});

test('validate rejects missing project id', () => {
  const v = validateProjectIntelligenceContract({
    contract: { version: 1 },
    project: {},
    capabilities: [],
    ownership: [],
    agents: {},
    policy: { protected_paths: [], tier3_operations: [] },
  });
  assert(!v.valid);
  assert(v.issues.includes('missing_project_id'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
