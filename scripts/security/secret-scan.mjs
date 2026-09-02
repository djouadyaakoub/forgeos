#!/usr/bin/env node
/**
 * Secret scan — run before release. Never prints secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'coverage', 'dist', 'build',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

const PATTERNS = [
  { name: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'github_token', regex: /ghp_[a-zA-Z0-9]{20,}/g },
  { name: 'github_oauth', regex: /gho_[a-zA-Z0-9]{20,}/g },
  { name: 'openai_key', regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: 'private_key_block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'password_assignment', regex: /password\s*[:=]\s*['"][^'"]{4,}['"]/gi },
  { name: 'api_key_assignment', regex: /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { name: 'token_assignment', regex: /token\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { name: 'connection_string', regex: /postgres(ql)?:\/\/[^\s'"]+/gi },
  { name: 'bearer_token', regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g },
];

const ALLOWLIST = [
  /__REDACTED/,
  /\[REDACTED\]/,
  /redact/i,
  /example\.com/,
  /placeholder/i,
  /your[_-]?api[_-]?key/i,
  /xxx+/i,
  /\$\{env:[A-Z_]+\}/,
];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (SKIP_FILES.has(path.basename(filePath))) return [];
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  if (content.length > 2_000_000) return [];

  const findings = [];
  for (const { name, regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const snippet = match[0];
      if (ALLOWLIST.some((a) => a.test(snippet))) continue;
      if (rel.includes('secret-scan.mjs') && name !== 'private_key_block') continue;
      findings.push({
        file: rel,
        pattern: name,
        line: content.slice(0, match.index).split('\n').length,
        redacted: `[REDACTED:${name}]`,
      });
    }
  }
  return findings;
}

function walk(dir, findings) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name)) continue;
      walk(path.join(dir, e.name), findings);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (['.mjs', '.js', '.json', '.yaml', '.yml', '.md', '.txt', '.sh', '.ps1', '.env'].includes(ext) || e.name.startsWith('.env')) {
        findings.push(...scanFile(path.join(dir, e.name)));
      }
    }
  }
}

const findings = [];
walk(ROOT, findings);

const report = {
  scan: 'secret-scan',
  root: ROOT.replace(/\\/g, '/'),
  findings_count: findings.length,
  findings,
  clean: findings.length === 0,
  scanned_at: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
process.exit(findings.length > 0 ? 1 : 0);
