#!/usr/bin/env node
/**
 * Validate applied project adapter — project-agnostic (Phase 21)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadProjectManifest,
  loadEffectiveRules,
  checkAgentOsCompatibility,
} from '../policy/project-adapter.mjs';
import {
  dryRunScenario,
  saveSession,
  clearSession,
  evaluateApprovalForOperation,
} from '../policy/engine.mjs';
import { extractProjectAdapter, validateAdapter } from './adapter-extraction.mjs';

const args = process.argv.slice(2);
const idx = args.indexOf('--project-dir');
const projectDir = idx >= 0 ? path.resolve(args[idx + 1]) : process.cwd();

process.env.CURSOR_PROJECT_DIR = projectDir;
process.env.AGENT_OS_TEST_DIR = projectDir;

const results = [];

function check(name, fn) {
  try {
    const ok = fn();
    results.push({ name, ok: !!ok, detail: ok === true ? 'pass' : ok });
    return ok;
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    return false;
  }
}

const manifest = loadProjectManifest(projectDir);
check('manifest exists', () => manifest.data !== null);
check('agent_os version compatible', () => checkAgentOsCompatibility(projectDir).compatible);

const rules = loadEffectiveRules(projectDir);
check('capabilities loaded via agents', () => Object.keys(rules.agents || {}).length > 5);

const { adapter } = extractProjectAdapter(projectDir);
const validation = validateAdapter(adapter, projectDir);
check('adapter extraction validates', () => validation.valid || validation.issues.join('; '));

const yaml = fs.readFileSync(path.join(projectDir, '.agent-os/project.yaml'), 'utf8');
check('no bearer tokens in manifest', () => !/\bBearer\s+[A-Za-z0-9._-]{8,}\b/.test(yaml));
check('capabilities non-empty in file', () => /capabilities:\s*\n\s+- id:/.test(yaml));
check('no speed-flexy paths in manifest', () => !/speed-flexy|backend\/internal\/api\/server\.go|fly\.toml/i.test(yaml));

check('no Speed Flexy leakage in adapter', () => {
  const blob = JSON.stringify(adapter);
  return !blob.includes('speed-flexy') && !blob.includes('speed_flexy');
});

clearSession();
const protectedWrite = dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' });
check('Test C protected path BLOCK', () => protectedWrite.permission === 'deny');

clearSession();
const gitPush = dryRunScenario('shell', { agent: 'orchestrator', command: 'git push origin main' });
check('Test D tier3 git_push BLOCK without approval', () => gitPush.permission === 'deny');

const prefix = rules.project?.task_id_prefix || 'TASK';
const taskA = `${prefix}-20260902-001`;
const taskB = `${prefix}-20260902-002`;

clearSession();
saveSession({ subagent_type: 'devops-release', task_id: taskA });
const wrongTask = evaluateApprovalForOperation('git_push', taskB);
check('Test E cross-task approval BLOCK', () => wrongTask.permission === 'deny');

clearSession();
const pdvWrite = dryRunScenario('write', { agent: 'orchestrator', path: 'pdv/lib/main.dart' });
check('Test G orchestrator pdv write BLOCK without ownership', () => pdvWrite.permission === 'deny');

const hooksPath = path.join(projectDir, '.cursor/hooks.json');
check('portable hooks exist', () => fs.existsSync(hooksPath));
if (fs.existsSync(hooksPath)) {
  const hooks = fs.readFileSync(hooksPath, 'utf8');
  check('hooks use portable shim not dev path', () =>
    hooks.includes('.cursor/hooks/agent-os/') && !/[A-Za-z]:[\\/].*(?:cursor-agent-os|ForgeOS)/i.test(hooks)
  );
}

const passed = results.filter((r) => r.ok).length;
const report = {
  project_dir: projectDir,
  project_id: manifest.data?.project?.id,
  passed,
  total: results.length,
  status: passed === results.length ? 'PASS' : 'PASS WITH LIMITATIONS',
  results,
};

console.log(JSON.stringify(report, null, 2));
process.exit(passed === results.length ? 0 : 1);
