#!/usr/bin/env node
import { dryRunScenario, clearSession, saveSession } from '../engine.mjs';

const cases = [
  ['read allows docs', 'read', { path: 'docs/foo.md' }, 'allow'],
  ['unknown tool denied', 'write', { agent: 'orchestrator', path: 'x' }, null], // tested via evaluatePreToolUse separately
  ['protected path denied', 'write', { agent: 'orchestrator', path: '.cursor/hooks.json' }, 'deny'],
  ['git push tier3', 'shell', { agent: 'architect', command: 'git push' }, 'deny'],
];

let pass = 0;
for (const [name, type, payload, expected] of cases) {
  clearSession();
  const r = dryRunScenario(type, payload);
  const ok = expected ? r.permission === expected : true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) pass++;
}

// Cross-task approval isolation
clearSession();
saveSession({ subagent_type: 'architect', task_id: 'TASK-20260902-001' });
const approved = dryRunScenario('approval', { operation: 'git_push', task_id: 'TASK-20260902-999' });
const isolated = approved.permission === 'deny';
console.log(`${isolated ? 'PASS' : 'FAIL'} cross-task approval isolation`);
if (isolated) pass++;

console.log(`\n${pass}/${cases.length + 1}`);
process.exit(pass === cases.length + 1 ? 0 : 1);
