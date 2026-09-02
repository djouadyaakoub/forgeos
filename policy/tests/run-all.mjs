#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(ROOT);
const TEST_DIR = path.join(REPO_ROOT, 'tests');

const r = spawnSync('node', [path.join(TEST_DIR, 'run-universal.mjs')], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  env: { ...process.env, CURSOR_PROJECT_DIR: ROOT },
});
console.log(r.stdout || '');
if (r.stderr) console.error(r.stderr);
process.exit(r.status ?? 1);
