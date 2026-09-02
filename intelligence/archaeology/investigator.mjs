/**
 * Project archaeology — git history and docs context (read-only)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function gitLog(projectDir, filePath, limit = 5) {
  const r = spawnSync('git', ['log', `--max-count=${limit}`, '--format=%h %s (%an, %ar)', '--', filePath], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  if (r.status !== 0) return [];
  return r.stdout.trim().split('\n').filter(Boolean);
}

function findMentions(projectDir, query, searchDirs = ['docs', 'docs/adr']) {
  const mentions = [];
  for (const dir of searchDirs) {
    const full = path.join(projectDir, dir);
    if (!fs.existsSync(full)) continue;
    function walk(d) {
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /\.(md|yaml|yml|txt)$/i.test(e.name)) {
          try {
            const content = fs.readFileSync(p, 'utf8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              mentions.push(path.relative(projectDir, p).replace(/\\/g, '/'));
            }
          } catch {
            /* skip */
          }
        }
      }
    }
    walk(full);
  }
  return mentions;
}

export function investigate(projectDir, question, options = {}) {
  const target = options.file || options.dependency || options.topic || '';
  const result = {
    capability: 'project-archaeology',
    question,
    target,
    git_history: target ? gitLog(projectDir, target) : [],
    doc_mentions: target ? findMentions(projectDir, path.basename(target)) : [],
    adrs: findMentions(projectDir, target, ['docs/adr']),
    conclusions: [],
    safe_to_remove: false,
    auto_remove: false,
  };

  if (result.git_history.length > 0) {
    result.conclusions.push(`File has ${result.git_history.length} recent git commits — likely intentional.`);
    result.safe_to_remove = false;
  } else if (target) {
    result.conclusions.push('No recent git history — verify references before removal.');
    result.safe_to_remove = false;
  }

  if (result.adrs.length > 0) {
    result.conclusions.push(`Referenced in ADR(s): ${result.adrs.join(', ')}`);
    result.safe_to_remove = false;
  }

  return result;
}
