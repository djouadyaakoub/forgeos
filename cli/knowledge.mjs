#!/usr/bin/env node
/** Read-only project knowledge diagnostics. No learning promotion or execution. */
import { assessProjectKnowledge } from '../intelligence/assessment/knowledge.mjs';
const args = process.argv.slice(2);
try {
  let project = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('--')) project = args[++i];
    else if (args[i] !== '--json') throw new Error('unsupported_or_missing_option');
  }
  console.log(JSON.stringify({ ok: true, ...assessProjectKnowledge(project) }, null, 2));
} catch (e) { console.log(JSON.stringify({ ok: false, reason: e.message })); process.exitCode = 1; }
