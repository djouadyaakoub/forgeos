import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertPermanentAgentFreeze } from '../intelligence/capability/permanent-agent-freeze.mjs';
import { checkInvariantRegistry } from '../scripts/release/invariant-enforcer-registry.mjs';
import { SOURCE_ROOT, deriveRcSourceManifest, classifyRcPath } from '../scripts/release/rc-source-manifest.mjs';
import { copyRcSource, fixtureSnapshot, RC_SUITES } from '../scripts/release/validate-rc-source.mjs';
import { PRODUCT_HOST_IDS } from '../host/catalog.mjs';
import { getHostExecutionAdapter } from '../host/discovery.mjs';
import { defaultRuntimeRegistry } from '../runtime/registry.mjs';
import { createTaskScope, validateTaskScope } from '../policy/task-scope.mjs';
import { evaluatePreToolUse, evaluateShell } from '../policy/authority.mjs';
import { getTasksBasePath, loadRules } from '../policy/engine.mjs';
import { assessCapabilityVerification } from '../intelligence/orchestrator/capability-verification.mjs';
import { createTaskApproval, validateTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { fingerprintOperation } from '../intelligence/assessment/task-candidate.mjs';
import { planCapabilityDependencies } from '../intelligence/orchestrator/dependency-planner.mjs';
import { inspectContext } from '../intelligence/orchestrator/context-diagnostic.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s29-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('forgeos-s29-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test('permanent agents and canonical authority invariants remain enforced', () => {
  const freeze = assertPermanentAgentFreeze();
  assert.equal(freeze.ok, true); assert.deepEqual(freeze.missing, []);
  assert.equal(freeze.on_disk_count, freeze.frozen_count);
  const invariants = checkInvariantRegistry(SOURCE_ROOT);
  assert.equal(invariants.status, 'pass');
  assert.equal(invariants.details.checked_invariant_ids.length, 10);
});

test('all three hosts remain peers, not runtime backends or launchers', () => {
  assert.deepEqual([...PRODUCT_HOST_IDS].sort(), ['claude-code', 'codex', 'cursor']);
  for (const id of PRODUCT_HOST_IDS) {
    assert.equal(defaultRuntimeRegistry.get(id), null);
    assert.equal(getHostExecutionAdapter(id).start().started, false);
  }
});

test('Policy rejects protected writes and scope substitution for every host identity', t => {
  const root = temporary(t), other = temporary(t);
  const scope = createTaskScope({ project_dir: root, task_id: 'S29', capability_id: 'documentation-sync',
    operation_id: 'document', allowed_paths: ['**'] }).scope;
  assert.equal(validateTaskScope(scope, { project_dir: other }).ok, false);
  assert.equal(validateTaskScope(scope, { task_id: 'OTHER' }).ok, false);
  for (const host_id of PRODUCT_HOST_IDS) {
    const decision = evaluatePreToolUse({ host_id, tool_name: 'Write', tool_input: { path: '.cursor/hooks.json' },
      task_scope: scope, scope_action: { project_dir: root } });
    assert.equal(decision.permission, 'deny'); assert.equal(decision.authority, 'forgeos');
  }
});

test('host completion and a presence marker cannot satisfy composite verification', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'done.md'), 'done');
  for (const id of ['architecture-guard', 'release-readiness', 'deployment-plan']) {
    const result = assessCapabilityVerification({ project_dir: root,
      candidate: { capability_id: id, verification_strategy: 'presence', verification_presence: ['done.md'] },
      governed: { status: 'COMPLETED', verification: 'PASS' } });
    assert.equal(result.result, 'UNKNOWN');
  }
});

test('source-only copies preserve every included hash and distribution selection without fixture pollution', t => {
  const before = fixtureSnapshot(SOURCE_ROOT), manifest = deriveRcSourceManifest(SOURCE_ROOT);
  const root = path.join(temporary(t), 'candidate');
  copyRcSource(SOURCE_ROOT, root);
  const copied = deriveRcSourceManifest(root);
  assert.equal(copied.source_fingerprint, manifest.source_fingerprint);
  const distribution = m => m.files.filter(f => f.decision === 'INCLUDE' && f.required_for_distribution)
    .map(f => [f.path, f.sha256]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(distribution(copied), distribution(manifest));
  for (const file of manifest.files.filter(f => f.decision === 'INCLUDE'))
    assert.equal(hash(fs.readFileSync(path.join(root, file.path))), file.sha256, file.path);
  assert.equal(fs.existsSync(path.join(root, '.agent-os')), false);
  assert.equal(fs.existsSync(path.join(root, 'docs/reports')), false);
  assert.deepEqual(fixtureSnapshot(SOURCE_ROOT), before);
  assert.ok(RC_SUITES.includes('test:stage29'));
});

test('local state, receipts, histories and generated artifacts stay outside source and distribution', () => {
  for (const p of ['.agent-os/knowledge/record.json', '.agent-os/approval/receipt.json',
    'docs/project/tasks/T/task.json', 'release/checksums.json',
    'tests/fixtures/a/docs/project/assessments/result.json']) {
    const result = classifyRcPath(p);
    assert.equal(result.decision, 'EXCLUDE'); assert.equal(result.required_for_distribution, false);
  }
  assert.equal(classifyRcPath('docs/reports/STAGE-29-COMPETITIVE-HARDENING-OSS-ADOPTION-GATE.md').decision, 'HUMAN_REVIEW');
});

test('ordinary local-write approvals stay reusable but malformed expiry rejects', () => {
  // Low-risk approval is deliberately distinct from Stage 30 exact Tier-3 evidence.
  const a = { type: 'write_files', writes: [{ path: 'docs/proof.md', content: 'first' }] };
  const b = { type: 'write_files', writes: [{ path: 'docs/proof.md', content: 'different' }] };
  assert.equal(fingerprintOperation(a), fingerprintOperation(b));
  const candidate = { task_id: 'S29', capability_id: 'documentation-sync', operation_fingerprint: fingerprintOperation(a) };
  const approval = createTaskApproval({ ...candidate, approved: true, approved_at: '2026-09-07T00:00:00.000Z' }).approval;
  const now = Date.parse('2026-09-07T00:01:00Z');
  assert.equal(validateTaskApproval(approval, candidate, { now }).ok, true);
  assert.equal(validateTaskApproval(approval, candidate, { now }).ok, true);
  assert.equal(validateTaskApproval(approval, { ...candidate, task_id: 'OTHER' }, { now }).ok, false);
  assert.equal(validateTaskApproval({ ...approval, expires_at: 'invalid' }, candidate, { now }).ok, false);
});

test('dependency ordering remains deterministic planning, with missing dependencies and cycles explicit', () => {
  const selected = [{ capability_id: 'b', requires: ['a'] }, { capability_id: 'a' }];
  const a = planCapabilityDependencies({ selected }), b = planCapabilityDependencies({ selected: [...selected].reverse() });
  assert.deepEqual(a.ordered_capability_ids, ['a', 'b']);
  assert.deepEqual(a.ordered_capability_ids, b.ordered_capability_ids);
  assert.equal(planCapabilityDependencies({ selected: [{ capability_id: 'a', requires: ['missing'] }] }).unresolved_dependencies.length, 1);
  assert.equal(planCapabilityDependencies({ selected: [{ capability_id: 'a', requires: ['b'] }, { capability_id: 'b', requires: ['a'] }] }).cycle_detected, true);
});

test('Tier 3 rejects legacy category approval without exact dispatch evidence', t => {
  const root = temporary(t), previous = process.env.CURSOR_PROJECT_DIR;
  process.env.CURSOR_PROJECT_DIR = root;
  try {
    const dir = path.join(root, getTasksBasePath(loadRules()), 'active', 'S29');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'task.yaml'), 'approval:\n  required: true\n  status: approved\n  scope:\n    - git_push\n');
    const session = { task_id: 'S29', subagent_type: 'release-deployment' };
    // Policy evaluation only: neither command is launched and no remote is touched.
    for (const command of ['git push origin main', 'git push another release', 'git push origin main'])
      assert.equal(evaluateShell(command, session).permission, 'deny');
    assert.equal(evaluateShell('git push origin main', { ...session, task_id: 'OTHER' }).permission, 'deny');
  } finally {
    if (previous === undefined) delete process.env.CURSOR_PROJECT_DIR;
    else process.env.CURSOR_PROJECT_DIR = previous;
  }
});

test('MINIMAL context is measured bytes, host-neutral and read-only, not vendor tokens or approval', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'proof.md'), '# bounded evidence\n');
  const outputs = PRODUCT_HOST_IDS.map(host_id => inspectContext({ project_dir: root, paths: ['proof.md'], host_id, workflow: 'MINIMAL' }));
  for (const result of outputs) {
    assert.equal(result.executes, false); assert.equal(result.real_token_usage, 'REAL_TOKEN_USAGE_UNAVAILABLE');
    assert.equal(result.metrics.selected_evidence_bytes, Buffer.byteLength('# bounded evidence\n'));
    assert.equal(result.context.assessment, null); assert.equal(result.context.knowledge, null);
    assert.equal(result.metrics.context_bytes, outputs[0].metrics.context_bytes);
  }
});
