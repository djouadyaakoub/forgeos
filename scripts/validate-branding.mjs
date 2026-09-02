#!/usr/bin/env node
/**
 * Branding validation — product identity = forgeos
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_ID, PACKAGE_NAME, PRODUCT_NAME } from '../policy/identity.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ALLOWED_CURSOR_PATHS = [
  /^adapters\/cursor\//,
  /^\.cursor-plugin\//,
  /^docs\//,
  /^tests\//,
  /^release\/dist\//,
  /^policy\/identity\.mjs$/,
  /^policy\/plugin-root\.mjs$/,
  /^policy\/runtime\.mjs$/,
  /^runtime\/host-registry\.mjs$/,
  /^bootstrap\//,
  /^agents\//,
  /^scripts\/validate-branding\.mjs$/,
];

const FORBIDDEN_IN_CORE = [
  { pattern: /Universal Cursor Agent OS/gi, label: 'old_product_name' },
];

function isAllowedPath(rel) {
  return ALLOWED_CURSOR_PATHS.some((p) => p.test(rel));
}

function walk(dir, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) walk(full, fn);
    else if (/\.(mjs|js|json|yaml|yml|md)$/.test(entry.name)) {
      try {
        fn(rel, fs.readFileSync(full, 'utf8'));
      } catch { /* skip */ }
    }
  }
}

const issues = [];
const coreDirs = ['policy', 'intelligence', 'runtime', 'bootstrap', 'agents', 'schemas'];

for (const dir of coreDirs) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  walk(full, (rel, content) => {
    if (isAllowedPath(rel)) return;
    if (rel.startsWith('policy/tests/')) return;
    for (const rule of FORBIDDEN_IN_CORE) {
      if (rule.allowInCursorAdapter && rel.startsWith('adapters/cursor')) continue;
      if (rule.pattern.test(content)) {
        issues.push({ file: rel, rule: rule.label });
      }
    }
    if (/\bimport\b.*adapters\/cursor/.test(content) && !rel.startsWith('adapters/')) {
      issues.push({ file: rel, rule: 'core_imports_cursor_adapter' });
    }
    if (/\bCURSOR_AGENT_OS_PLUGIN_ROOT\b/.test(content) && !rel.includes('identity.mjs') && !rel.includes('plugin-root.mjs')) {
      issues.push({ file: rel, rule: 'cursor_env_in_core' });
    }
    if (/\bCURSOR_PROJECT_DIR\b/.test(content) && ![
      'policy/runtime.mjs',
      'policy/project-adapter.mjs',
      'intelligence/orchestrator/coordinator.mjs',
      'runtime/host-registry.mjs',
    ].some((p) => rel === p || rel.startsWith('bootstrap/'))) {
      issues.push({ file: rel, rule: 'cursor_env_in_core' });
    }
  });
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const checks = [
  { check: 'package_name', status: pkg.name === PACKAGE_NAME ? 'pass' : 'fail', got: pkg.name },
  { check: 'product_identity_module', status: PRODUCT_ID === 'forgeos' ? 'pass' : 'fail' },
  { check: 'no_core_cursor_coupling', status: issues.length === 0 ? 'pass' : 'fail', issues: issues.slice(0, 10) },
];

const blocked = checks.filter((c) => c.status === 'fail');

console.log(JSON.stringify({
  branding_validation: {
    product: PRODUCT_NAME,
    product_id: PRODUCT_ID,
    status: blocked.length === 0 ? 'PASS' : 'BLOCKED',
    checks,
  },
}, null, 2));

process.exit(blocked.length === 0 ? 0 : 1);
