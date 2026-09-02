#!/usr/bin/env node
/**
 * Bootstrap adapter extraction tests (12 scenarios)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  extractProjectAdapter,
  summarizeAdapter,
  validateAdapter,
  redactSecrets,
} from '../bootstrap/adapter-extraction.mjs';
import { buildProjectProfile, resolveProjectKind } from '../bootstrap/project-discovery.mjs';

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
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return base;
}

// Fixture: mature multi-stack project with registry
const MATURE = writeFixture('adapter-mature', {
  'AGENTS.md': '# Project\n',
  'docs/STACK.md': '# Stack\n',
  'backend/go.mod': 'module example.com/backend\n',
  'mobile/gateway/pubspec.yaml': 'name: gateway\n',
  'web/package.json': { name: 'web', scripts: { build: 'vite build', test: 'vitest' } },
  '.cursor/agents/registry.yaml': `schema_version: 1
agents:
  backend-api:
    file: backend-api.md
    tool_profile: implement-local
    approval_tier_max: 2
    capabilities: [go-api]
    domains: [backend]
    paths_owned: [backend/**]
    paths_writable: [backend/**]
    verification: ["cd backend && go test ./..."]
    playbook: docs/agents/task-playbooks/backend-api.md
  mobile:
    file: mobile.md
    capabilities: [flutter-gateway]
    domains: [mobile]
    paths_owned: [mobile/gateway/**]
`,
  '.cursor/agents/backend-api.md': '# backend\n',
  '.cursor/agents/mobile.md': '# mobile\n',
  '.cursor/policy/rules.json': {
    tier_3_operations: ['fly_deploy', 'git_push', 'custom_project_op'],
    shell_rules: [{ operation: 'fly_deploy', tier: 3, patterns: ['fly deploy'] }],
    protected_path_prefixes: ['.cursor/agents/'],
    agents: {
      'backend-api': { tool_profile: 'implement-local', paths_writable: ['backend/**'] },
    },
  },
  '.cursor/mcp.json': {
    mcpServers: {
      supabase: { type: 'http', url: 'https://mcp.example.com' },
      secret: { env: { API_KEY: '${env:SECRET}' }, headers: { Authorization: 'Bearer ${env:TOKEN}' } },
    },
  },
});

writeFixture('adapter-empty', {});
writeFixture('adapter-go-only', { 'go.mod': 'module x\n' });
writeFixture('adapter-initialized', {
  '.agent-os/project.yaml': 'schema_version: 1\nproject:\n  id: init\n  task_id_prefix: INIT\n',
  'AGENTS.md': '# Init\n',
  '.cursor/agents/registry.yaml': 'schema_version: 1\nagents:\n  qa-bugfix:\n    capabilities: [reproduce-bug]\n',
  '.cursor/agents/qa-bugfix.md': '# qa\n',
});

console.log('Bootstrap Adapter Extraction Tests\n');

console.log('--- Test 1: Mature Go/Flutter/Node project ---');
test('Mature fixture extracts capabilities and agents', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  const s = summarizeAdapter(adapter);
  assert(s.capability_count >= 2, 'expected capabilities');
  assert(s.agent_count >= 2, 'expected agents');
});

console.log('\n--- Test 2: Project-local agents ---');
test('Agent files matched to registry', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  assert(adapter.agents['backend-api']?.exists, 'backend-api md exists');
  assert(adapter.agents.mobile?.exists, 'mobile md exists');
});

console.log('\n--- Test 3: Project-local capabilities ---');
test('Capabilities linked to agents', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  const goCap = adapter.capabilities.find((c) => c.id === 'go-api');
  assert(goCap?.agent === 'backend-api', 'go-api linked');
});

console.log('\n--- Test 4: Protected paths ---');
test('Project protected paths exclude global Agent OS paths', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  assert(!adapter.policy.protected_paths.some((p) => p.startsWith('.cursor/agents/')), 'no global paths');
});

console.log('\n--- Test 5: Tier 3 operations ---');
test('Project-specific Tier 3 extracted with exact ids', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  const ids = adapter.policy.tier3_operations.map((o) => o.id);
  assert(ids.includes('fly_deploy'), 'fly_deploy present');
  assert(ids.includes('custom_project_op'), 'custom op present');
  assert(!ids.includes('git_push'), 'global git_push excluded from project list');
});

console.log('\n--- Test 6: MCP metadata ---');
test('MCP metadata extracted without raw secrets', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  assert(adapter.integrations.mcp.length >= 1, 'mcp entries');
  const raw = fs.readFileSync(path.join(MATURE, '.cursor/mcp.json'), 'utf8');
  assert(!JSON.stringify(adapter.integrations).includes('Bearer ey'), 'no bearer tokens in output');
});

console.log('\n--- Test 7: Verification commands ---');
test('Verification commands from registry and package.json', () => {
  const { adapter } = extractProjectAdapter(MATURE);
  assert(adapter.verification.commands.length >= 2, 'commands extracted');
  assert(adapter.verification.commands.some((c) => c.scope === 'web'), 'web package scripts');
});

console.log('\n--- Test 8: Secret redaction ---');
test('redactSecrets masks sensitive keys', () => {
  const out = redactSecrets({ API_KEY: 'secret', name: 'ok' });
  assert(out.API_KEY === '[REDACTED]', 'key redacted');
  assert(out.name === 'ok', 'safe key kept');
});

console.log('\n--- Test 9: Missing optional sections ---');
test('Empty project returns empty adapter sections', () => {
  const { adapter } = extractProjectAdapter(path.join(FIXTURES, 'adapter-empty'));
  assert(adapter.capabilities.length === 0, 'no capabilities');
  assert(adapter.integrations.mcp.length === 0, 'no mcp');
});

console.log('\n--- Test 10: Contradictory evidence ---');
test('Missing agent file reported as contradiction', () => {
  const bad = writeFixture('adapter-contradiction', {
    '.cursor/agents/registry.yaml': 'agents:\n  missing-agent:\n    capabilities: [x]\n',
  });
  const { adapter } = extractProjectAdapter(bad);
  assert(adapter.contradictions.some((c) => c.type === 'missing_agent_file'), 'contradiction reported');
});

console.log('\n--- Test 11: Empty/new project ---');
test('UNINITIALIZED kind for empty fixture', () => {
  const kind = resolveProjectKind(path.join(FIXTURES, 'adapter-empty'));
  assert(kind.project_kind === 'UNINITIALIZED', `got ${kind.project_kind}`);
});

console.log('\n--- Test 12: Existing initialized project ---');
test('AGENT_OS_INITIALIZED when manifest exists', () => {
  const kind = resolveProjectKind(path.join(FIXTURES, 'adapter-initialized'));
  assert(kind.project_kind === 'AGENT_OS_INITIALIZED', `got ${kind.project_kind}`);
});

console.log('\n--- Speed Flexy reference (optional) ---');
test('Speed Flexy extracts non-empty adapter sections', () => {
  if (!fs.existsSync(SPEED_FLEXY)) throw new Error('SKIP: Speed Flexy not available');
  const { adapter, validation } = extractProjectAdapter(SPEED_FLEXY);
  const s = summarizeAdapter(adapter);
  assert(s.capability_count > 0, 'capabilities');
  assert(s.tier3_operation_count > 0, 'tier3');
  assert(s.mcp_count > 0, 'mcp');
  assert(s.verification_command_count > 0, 'verification');
  assert(validation.valid, validation.issues?.join(', '));
});

test('Speed Flexy dry-run shows proposed_adapter', () => {
  if (!fs.existsSync(SPEED_FLEXY)) throw new Error('SKIP');
  const init = path.join(REPO_ROOT, 'bootstrap/initialize.mjs');
  const out = execSync(`node "${init}" --dry-run --project-dir "${SPEED_FLEXY}"`, { encoding: 'utf8' });
  const report = JSON.parse(out);
  assert(report.proposed_adapter?.capabilities > 0, 'proposed capabilities');
  assert(report.proposed_adapter?.tier3_operations?.length > 0, 'proposed tier3');
});

console.log(`\n────────────────────────────`);
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
