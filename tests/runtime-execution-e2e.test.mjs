#!/usr/bin/env node
/**
 * Architecture 2.0 Stage 5 — Real bounded E2E execution
 *
 * Chain:
 *   ForgeOS → Policy Authority → Runtime Router → Local Executor
 *   → real filesystem write → verification command → evidence → result
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { executeGoverned, clearLifecycleStore } from '../runtime/execution.mjs';
import {
  createLocalExecutorBackend,
  clearLocalExecutorRuns,
} from '../runtime/adapters/local-executor.mjs';
import { clearSession, saveSession } from '../policy/authority.mjs';
import { POLICY_AUTHORITY } from '../policy/identity.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    clearLifecycleStore();
    clearLocalExecutorRuns();
    clearSession();
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

function makeIsolatedProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-e2e-s5-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/project/tasks/active'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os/project.yaml'),
    `contract:
  version: 1
project:
  id: forgeos-e2e-s5
  name: Stage5 E2E
  task_id_prefix: S5E2E
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
runtime:
  requirements: {}
policy:
  protected_paths: []
  tier3_operations: []
`,
    'utf8'
  );
  return dir;
}

console.log('Stage 5 Real E2E Execution\n');

test('E2E — full governed write + verification + evidence', () => {
  const projectDir = makeIsolatedProject();
  const registry = createRuntimeRegistry();
  registry.register(createLocalExecutorBackend());

  const marker = 'docs/project/runtime-e2e/stage5-marker.txt';
  const verifyScript = 'docs/project/runtime-e2e/verify-marker.cjs';
  const payload = `stage5-e2e-${Date.now()}`;

  process.env.CURSOR_PROJECT_DIR = projectDir;
  saveSession({ subagent_type: 'codebase-organization', task_id: 'S5E2E-20260903-001' });

  const result = executeGoverned({
    task_id: 'S5E2E-20260903-001',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    objective: 'Create Stage 5 E2E marker file',
    operation: {
      type: 'write_files',
      writes: [
        { path: marker, content: payload },
        {
          path: verifyScript,
          content:
            "const fs = require('fs');\n" +
            `const expected = ${JSON.stringify(payload)};\n` +
            "const actual = fs.readFileSync('docs/project/runtime-e2e/stage5-marker.txt', 'utf8');\n" +
            'if (actual !== expected) process.exit(2);\n' +
            'process.exit(0);\n',
        },
      ],
    },
    allowed_paths: ['docs/**'],
    forbidden_paths: ['.cursor/**', '.agent-os/**', 'policy/**'],
    verification_commands: ['node docs/project/runtime-e2e/verify-marker.cjs'],
    registry,
  });

  assert(
    result.status === 'COMPLETED',
    `status=${result.status} err=${JSON.stringify(result.error)} ver=${JSON.stringify(result.runtime_evidence?.verification_results)}`
  );
  assert(result.policy_decision?.authority === POLICY_AUTHORITY, 'policy authority');
  assert(result.policy_decision?.decision === 'allow', 'policy allow');
  assert(result.route_decision?.status === 'ROUTED', 'routed');
  assert(result.route_decision?.backend_id === 'local-executor', 'backend id');
  assert(result.backend_id === 'local-executor', 'result backend');
  assert(result.run_handle?.task_id === 'S5E2E-20260903-001', 'task id');
  assert(result.verification_assessment?.satisfied === true, 'verification satisfied');
  assert(result.runtime_evidence?.changed_files?.includes(marker), 'marker in evidence');
  assert(fs.readFileSync(path.join(projectDir, marker), 'utf8') === payload, 'marker content');

  // No unauthorized protected file created
  assert(!fs.existsSync(path.join(projectDir, '.cursor/hooks.json')), 'no hooks.json');
});

test('E2E — protected path remains blocked under full lifecycle', () => {
  const projectDir = makeIsolatedProject();
  const registry = createRuntimeRegistry();
  let starts = 0;
  const backend = createLocalExecutorBackend();
  const orig = backend.start.bind(backend);
  backend.start = (...a) => {
    starts++;
    return orig(...a);
  };
  registry.register(backend);

  process.env.CURSOR_PROJECT_DIR = projectDir;
  const result = executeGoverned({
    task_id: 'S5E2E-20260903-002',
    project_dir: projectDir,
    agent_id: 'codebase-organization',
    operation: {
      type: 'write_file',
      path: '.cursor/hooks.json',
      content: '{"hack":true}',
    },
    allowed_paths: ['docs/**'],
    registry,
  });

  assert(result.status === 'POLICY_DENIED', `got ${result.status}`);
  assert(starts === 0);
  assert(!fs.existsSync(path.join(projectDir, '.cursor/hooks.json')));
});

console.log(`\n────────────────────────────\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed === 0 ? 0 : 1);
