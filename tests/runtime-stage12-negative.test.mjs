/**
 * Stage 12 — Security / architecture boundary tests
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCursorHostAdapter } from '../host/adapters/cursor/index.mjs';
import { validateHostExecutionAdapter } from '../host/adapter.mjs';
import { resolveCapability } from '../intelligence/capability/resolver.mjs';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import {
  createHostHandoff,
  requestHostTaskVerification,
  validateHostHandoff,
  computeHandoffIntegrity,
} from '../intelligence/orchestrator/host-handoff.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { runForgeOsTaskCli } from '../cli/task.mjs';
import { planFromRequest } from '../intelligence/orchestrator/main-agent.mjs';

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

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function makeDocGapProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s12n-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: stage12n
  name: Stage12N
  type: application
  task_id_prefix: S12N
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# n\n');
  fs.writeFileSync(path.join(dir, 'docs', 'STACK.md'), '# s\n');
  fs.writeFileSync(path.join(dir, 'docs', 'architecture', 'overview.md'), '# a\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"s12n"}\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export {}\n');
  return dir;
}

function docsCandidate(dir) {
  const assessment = runProjectAssessment({
    project_dir: dir,
    persist: false,
    host_context: {
      host_id: 'cursor',
      capabilities: ['read', 'analyze', 'plan', 'write', 'edit', 'documentation', 'test'],
    },
  });
  return assessment.assessments.find((a) => a.binding.id === 'documentation-sync')?.task_candidate;
}

console.log('Stage 12 — Negative / security\n');

test('1 — Host cannot override ForgeOS DENY', () => {
  const adapter = createCursorHostAdapter();
  const can = adapter.canHandle({ tool_profile: 'implement-local' }, null, { permission: 'deny' });
  assert.equal(can.ok, false);
  assert.equal(can.reason, 'policy_deny');
  const binding = loadCapabilityBindings().capabilities.find((c) => c.id === 'documentation-sync');
  const r = resolveCapability({
    capability_id: 'documentation-sync',
    capability_binding: binding,
    host_context: { host_id: 'cursor', capabilities: ['read', 'write', 'edit', 'documentation'] },
    policy_context: { permission: 'deny' },
  });
  assert.equal(r.resolved, false);
  assert.equal(r.executable, false);
});

test('2 — Host cannot expand task scope (forbidden paths remain in handoff)', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  const result = createHostHandoff({ project_dir: dir, candidate, persist: false });
  assert.ok(result.handoff.constraints.forbidden_paths.includes('.agent-os/**'));
  assert.match(result.handoff.instructions, /DO NOT CHANGE/);
  assert.match(result.handoff.instructions, /\.agent-os\/\*\*/);
});

test('3 — Host cannot authorize another task', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  const v = requestHostTaskVerification({
    project_dir: dir,
    task_id: candidate.task_id,
    expected_task_id: 'S12N-other',
    persist: false,
    rescan: false,
  });
  assert.equal(v.ok, false);
});

test('4 — Handoff for task A cannot verify task B', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  const handoff = createHostHandoff({ project_dir: dir, candidate, persist: true }).handoff;
  const validation = validateHostHandoff(handoff, { expected_task_id: 'TASK-B' });
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('task_id_mismatch'));
});

test('5 — Handoff does not imply execution', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  const result = createHostHandoff({ project_dir: dir, candidate, persist: false });
  assert.equal(result.handoff.execution_status, 'HOST_INTERACTIVE_REQUIRED');
  assert.notEqual(result.handoff.verification_status, 'PASS');
});

test('6 — Execution does not imply verification (interactive start false)', () => {
  const started = createCursorHostAdapter().start({});
  assert.equal(started.started, false);
});

test('7 — User done does not imply PASS without project state', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  createHostHandoff({ project_dir: dir, candidate, persist: true });
  // No AGENTS.md written — completion request should FAIL/UNKNOWN, not PASS
  const r = requestHostTaskVerification({
    project_dir: dir,
    task_id: candidate.task_id,
    persist: false,
    rescan: true,
  });
  assert.notEqual(r.verification.result, 'PASS');
  assert.equal(r.capability_satisfied, false);
});

test('8 — Secrets are not included in handoff', () => {
  const dir = makeDocGapProject();
  // Construct at runtime so source stays secret-scan clean
  const fakeJwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'aaa', 'bbb'].join('.');
  const secretObjective = `update docs with token ${['Bear', 'er'].join('')}${String.fromCharCode(32)}${fakeJwt}`;
  const built = createHostHandoff({
    project_dir: dir,
    candidate: {
      ...docsCandidate(dir),
      objective: secretObjective,
    },
    persist: false,
  });
  assert.ok(!built.handoff.instructions.includes(fakeJwt));
  assert.match(built.handoff.instructions, /REDACTED/);
});

test('9 — Protected paths remain protected in instructions', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  const result = createHostHandoff({ project_dir: dir, candidate, persist: false });
  assert.match(result.handoff.instructions, /policy\/\*\*/);
  assert.match(result.handoff.instructions, /\.cursor\/\*\*/);
});

test('10 — Main Agent cannot directly execute host', () => {
  const src = stripCommentsAndStrings(
    fs.readFileSync(path.join(REPO, 'intelligence/orchestrator/main-agent.mjs'), 'utf8')
  );
  assert.ok(!/createHostHandoff|getHostExecutionAdapter|\.start\s*\(/.test(src));
  const plan = planFromRequest({
    request: 'Improve documentation',
    project_dir: makeDocGapProject(),
    persist: false,
  });
  assert.equal(plan.execute, false);
  assert.equal(plan.plan.execution_status, 'NOT_STARTED');
});

test('11 — Host Adapter does not become Policy Authority', () => {
  const adapter = createCursorHostAdapter();
  assert.equal(adapter.claims_policy_authority, false);
  assert.equal(adapter.authority, 'host_adapter');
  const bad = validateHostExecutionAdapter({
    ...adapter,
    claims_policy_authority: true,
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.reasons.includes('host_cannot_claim_policy_authority'));
});

test('12 — No second execution lifecycle in host modules', () => {
  const files = [
    'host/adapter.mjs',
    'host/discovery.mjs',
    'host/adapters/cursor/index.mjs',
    'intelligence/orchestrator/host-handoff.mjs',
    'cli/task.mjs',
  ];
  for (const rel of files) {
    const src = stripCommentsAndStrings(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bexecuteGoverned\b/.test(src), `${rel} must not call executeGoverned`);
    assert.ok(!/from ['"].*runtime\/execution/.test(src), `${rel} must not import runtime/execution`);
    assert.ok(!/from ['"].*adapters\/openhands/.test(src), `${rel} must not import openhands`);
  }
});

test('static — Host Adapter cannot modify Project Intelligence', () => {
  const src = stripCommentsAndStrings(
    fs.readFileSync(path.join(REPO, 'host/adapters/cursor/index.mjs'), 'utf8')
  );
  assert.ok(!/project\.yaml|writeFileSync/.test(src));
});

test('static — Assessment / Resolver still do not execute', () => {
  for (const rel of [
    'intelligence/assessment/engine.mjs',
    'intelligence/capability/resolver.mjs',
  ]) {
    const src = stripCommentsAndStrings(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(!/\bexecuteGoverned\b/.test(src));
    assert.ok(!/\bbackend\.start\s*\(/.test(src));
  }
});

test('altered handoff integrity fails', () => {
  const dir = makeDocGapProject();
  const candidate = docsCandidate(dir);
  const handoff = createHostHandoff({ project_dir: dir, candidate, persist: false }).handoff;
  handoff.objective = 'tampered';
  const v = validateHostHandoff(handoff);
  assert.ok(v.reasons.includes('integrity_mismatch'));
});

test('CLI rejects --yes/--force', () => {
  assert.equal(
    runForgeOsTaskCli(['node', 'cli/task.mjs', '--yes', 'T'], { print: false }).reason,
    'forbidden_global_bypass'
  );
});

test('Resolver does not execute', () => {
  assert.equal(typeof resolveCapability, 'function');
  const src = fs.readFileSync(path.join(REPO, 'intelligence/capability/resolver.mjs'), 'utf8');
  assert.match(src, /resolver_does_not_execute/);
});

console.log(`\nStage 12 negative tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
