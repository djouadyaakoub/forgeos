import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskScope, validateTaskScope, checkScopeContainment, bindTaskScope } from '../policy/task-scope.mjs';
import { evaluatePreToolUse, evaluate } from '../policy/authority.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createHostHandoff, requestHostTaskVerification } from '../intelligence/orchestrator/host-handoff.mjs';
import { collectKnowledgeFacts, partitionProjectKnowledge, assessProjectKnowledge } from '../intelligence/assessment/knowledge.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { executeApprovedCandidate } from '../intelligence/orchestrator/approved-execution.mjs';
import { createTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s25-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, '.agent-os'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const value = 1;');
  fs.writeFileSync(path.join(root, 'docs/proof.md'), '# proof');
  fs.writeFileSync(path.join(root, '.agent-os/project.yaml'), 'contract:\n  version: 1\nproject:\n  id: s25\ncapabilities: []\nagents: {}\nownership: []\nverification:\n  commands: []\n');
  return root;
}
const scope = root => createTaskScope({ project_dir: root, task_id: 'T25', capability_id: 'documentation-sync',
  operation_id: 'document', allowed_paths: ['docs/**'], denied_paths: ['docs/private/**'], expected_effects: ['document'] }).scope;
const candidate = root => createTaskCandidate({ project_dir: root, task_id: 'T25', capability_id: 'documentation-sync',
  allowed_paths: ['docs/**'], forbidden_paths: ['policy/**'], verification_strategy: 'presence', verification_presence: ['docs/proof.md'] }).candidate;
const entry = f => ({ id: 'learning-1', kind: 'learning', text: 'Prefer explicit exports', confidence: 0.8,
  workspace: f.workspace, based_on_fact_fingerprint: f.fingerprint, evidence_refs: ['src/a.js'],
  provenance: { kind: 'llm', source: 'stage25-fixture', observed_at: '2026-09-06T00:00:00Z' } });

test('scope canonicalization is ordered, deduplicated and fingerprint stable', t => {
  const root = fixture(t), a = scope(root);
  const b = createTaskScope({ project_dir: root, task_id: 'T25', capability_id: 'documentation-sync', operation_id: 'document',
    allowed_paths: ['docs/**','docs/**'], denied_paths: ['docs/private/**'], expected_effects: ['document','document'] }).scope;
  assert.deepEqual(a, b); assert.equal(validateTaskScope(a, { project_dir: root }).ok, true);
});
test('scope containment includes permitted paths and denies explicit exclusions', t => {
  const s = scope(fixture(t));
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'docs/public.md' }).ok, true);
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'docs/private/key.md' }).reason, 'scope_path_denied');
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'src/a.js' }).reason, 'scope_path_outside');
  assert.equal(checkScopeContainment(s, { action_class: 'execute' }).ok, false);
  assert.equal(checkScopeContainment(s, { action_class: 'write' }).ok, false);
});
test('scope rejects traversal, absolute/ambiguous/device paths and unsafe globs', t => {
  const root = fixture(t);
  for (const p of ['../escape','/abs','C:/abs','a//b','a/./b','docs/NUL','docs/x:stream','docs/a.','docs/[abc]']) {
    assert.equal(createTaskScope({ project_dir: root, task_id: 'T25', capability_id: 'docs', allowed_paths: [p] }).ok, false, p);
  }
});
test('scope checks workspace/task/capability/operation identity and integrity', t => {
  const root = fixture(t), other = fixture(t), s = scope(root);
  for (const ctx of [{ project_dir: other }, { task_id: 'OTHER' }, { capability_id: 'unknown' }, { operation_id: 'other' }]) assert.equal(validateTaskScope(s, ctx).ok, false);
  assert.equal(validateTaskScope({ ...s, allowed_paths: ['**'] }).ok, false);
});
test('manifest changes invalidate scope and candidate widening cannot reuse old fingerprint', t => {
  const root = fixture(t), c = candidate(root);
  assert.equal(bindTaskScope({ ...c, policy_context: { ...c.policy_context, allowed_paths: ['**'] } }, root).ok, false);
  fs.appendFileSync(path.join(root, '.agent-os/project.yaml'), '# changed\n');
  assert.equal(validateTaskScope(c.task_scope).reason, 'stale_task_scope');
});
test('scope rejects symlink/junction escapes including existing directory inside allowed paths', t => {
  const root = fixture(t), other = fixture(t), s = scope(root);
  fs.symlinkSync(other, path.join(root, 'docs/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'docs/link/new.md' }).reason, 'project_symlink_forbidden');
});
test('Policy intersects real tool path with scope; forged scope_action does not widen it', t => {
  const root = fixture(t), s = scope(root);
  const input = { tool_name: 'Read', tool_input: { path: 'src/a.js' }, task_scope: s,
    scope_action: { action_class: 'read', path: 'docs/proof.md', project_dir: root } };
  assert.equal(evaluatePreToolUse(input).permission, 'deny');
  assert.equal(evaluate({ kind: 'pre_tool', input }).permission, 'deny');
  assert.equal(checkScopeContainment(s, { action_class: 'read', path: 'docs/proof.md' }).authorized, false);
});
test('scope cannot permit a globally protected write under Policy', t => {
  const root = fixture(t), s = createTaskScope({ project_dir: root, task_id: 'T25', capability_id: 'docs', allowed_paths: ['**'] }).scope;
  const decision = evaluatePreToolUse({ tool_name: 'Write', tool_input: { path: '.cursor/hooks.json' }, task_scope: s, scope_action: { project_dir: root } });
  assert.equal(decision.permission, 'deny'); assert.equal(decision.authority, 'forgeos');
});
test('host handoff carries scope and completion detects observed scope violation', t => {
  const root = fixture(t), c = candidate(root);
  const h = createHostHandoff({ project_dir: root, candidate: c, host_id: 'codex', persist: false });
  assert.equal(h.ok, true); assert.equal(h.handoff.task_scope.fingerprint, c.task_scope.fingerprint);
  const result = requestHostTaskVerification({ project_dir: root, task_id: c.task_id, handoff: h.handoff,
    observed_changed_paths: ['src/a.js'], persist: false, rescan: false });
  assert.equal(result.verification_status, 'FAIL'); assert.equal(result.evidence.authority, 'forgeos');
  assert.equal(result.verification.task_scope_fingerprint, c.task_scope.fingerprint);
  assert.equal(result.evidence.task_scope_fingerprint, c.task_scope.fingerprint);
});
test('governed candidate refuses substituted scope before any write', t => {
  const root = fixture(t), c = candidate(root);
  const modified = { ...c, policy_context: { ...c.policy_context, allowed_paths: ['**'] }, operation: { type: 'write_files', writes: [{ path: 'src/evil.js', content: 'x' }] } };
  const approval = createTaskApproval({ task_id: c.task_id, capability_id: c.capability_id, approved: true }).approval;
  const r = executeApprovedCandidate({ project_dir: root, candidate: modified, approval, persist: false });
  assert.equal(r.executed, false); assert.equal(fs.existsSync(path.join(root, 'src/evil.js')), false);
});
test('facts snapshot is deterministic and deeply immutable', t => {
  const root = fixture(t), f = collectKnowledgeFacts(root), again = collectKnowledgeFacts(root);
  assert.equal(f.fingerprint, again.fingerprint);
  assert.throws(() => { f.filesystem[0].path = 'forged'; });
  assert.throws(() => partitionProjectKnowledge({ ...f }, []), /collector/);
});
test('interpretation merge cannot replace facts or promote successful learning', t => {
  const f = collectKnowledgeFacts(fixture(t)), p = partitionProjectKnowledge(f, [entry(f)]);
  assert.equal(p.facts, f); assert.equal(p.interpretations[0].state, 'CURRENT');
  assert.equal(p.interpretations[0].authoritative, false); assert.equal(p.interpretations[0].promotion, 'never_to_facts');
  assert.equal(partitionProjectKnowledge(f, [{ ...entry(f), facts: { source: 'fake' } }]).interpretations[0].state, 'INVALID');
});
test('changed source invalidates interpretation despite same manifest and no structural cache', t => {
  const root = fixture(t), f = collectKnowledgeFacts(root), learning = entry(f);
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const value = 2;');
  const next = assessProjectKnowledge(root, { interpretations: [learning] });
  assert.notEqual(next.facts.fingerprint, f.fingerprint); assert.equal(next.interpretations[0].state, 'STALE');
});
test('cross-project interpretation is quarantined even with matching project IDs', t => {
  const a = collectKnowledgeFacts(fixture(t)), b = collectKnowledgeFacts(fixture(t));
  assert.equal(partitionProjectKnowledge(b, [entry(a)]).interpretations[0].state, 'QUARANTINED');
});
test('provenance, references, confidence and duplicate IDs validated', t => {
  const f = collectKnowledgeFacts(fixture(t));
  for (const patch of [{ provenance: null }, { confidence: 9 }, { evidence_refs: [] }, { based_on_fact_fingerprint: 'bad' }]) {
    assert.equal(partitionProjectKnowledge(f, [{ ...entry(f), ...patch }]).interpretations[0].state, 'INVALID');
  }
  assert.equal(partitionProjectKnowledge(f, [{ ...entry(f), evidence_refs: ['../foreign'] }]).interpretations[0].state, 'QUARANTINED');
  assert.equal(partitionProjectKnowledge(f, [entry(f), entry(f)]).interpretations[1].state, 'INVALID');
});
test('project-local interpretation file does not alter fact fingerprint or self-invalidate', t => {
  const root = fixture(t), f = collectKnowledgeFacts(root);
  fs.writeFileSync(path.join(root, '.agent-os/interpretations.json'), JSON.stringify([entry(f)]));
  const p = assessProjectKnowledge(root);
  assert.equal(p.facts.fingerprint, f.fingerprint); assert.equal(p.interpretations[0].state, 'CURRENT');
  fs.writeFileSync(path.join(root, '.agent-os/interpretations.json'), '{');
  assert.equal(assessProjectKnowledge(root).interpretations[0].state, 'INVALID');
});
test('analysis omissions/limits are explicit and no symlink is inventoried as fact', t => {
  const root = fixture(t), other = fixture(t);
  fs.symlinkSync(other, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const f = collectKnowledgeFacts(root, { max_files: 1 });
  assert.equal(f.analysis_scope.truncated, true); assert.equal(f.analysis_scope.status, 'PARTIAL');
  assert.ok(f.analysis_scope.omitted.some(x => x.reason === 'symlink'));
  assert.equal(f.filesystem.length, 1);
});
test('assessment exposes partition without interpreting it as Canvas approval', t => {
  const root = fixture(t), f = collectKnowledgeFacts(root);
  const base = runProjectAssessment({ project_dir: root, persist: false });
  const interpreted = runProjectAssessment({ project_dir: root, persist: false, interpretations: [entry(f)] });
  assert.ok(interpreted.project_knowledge);
  assert.deepEqual(base.canvas.items.map(i => i.state), interpreted.canvas.items.map(i => i.state));
});
test('knowledge CLI is read-only and outputs structural partition', t => {
  const root = fixture(t), before = fs.readdirSync(root);
  const r = spawnSync(process.execPath, ['cli/knowledge.mjs', '--project', root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).learning_scope, 'project_only');
  assert.deepEqual(fs.readdirSync(root), before);
});

test('empty inventory cannot trigger implicit analyzer fallback to excluded files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-s25-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'release'));
  fs.writeFileSync(path.join(root, 'release/omitted.js'), 'export const notIncluded = 1;');
  const f = collectKnowledgeFacts(root);
  assert.equal(f.filesystem.length, 0); assert.equal(f.structural, null); assert.equal(f.analysis_scope.status, 'PARTIAL');
});
test('globstar, separators and literal punctuation normalize without regex injection', t => {
  const root = fixture(t);
  const s = createTaskScope({ project_dir: root, task_id: 'T25', capability_id: 'docs',
    allowed_paths: ['docs\\**','docs/**','a+b.md','**/AGENTS.md'] }).scope;
  assert.equal(s.allowed_paths.length, 3);
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'a+b.md' }).ok, true);
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'aaab.md' }).ok, false);
  assert.equal(checkScopeContainment(s, { action_class: 'write', path: 'AGENTS.md' }).ok, true);
});
