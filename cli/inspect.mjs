#!/usr/bin/env node
/**
 * forgeos inspect — Stage 13 structural intelligence inspection (read-only)
 *
 * Does not remediate, execute, authorize, or mutate Project Intelligence.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStructuralAnalysis, describeAnalyzerAvailability } from '../intelligence/adapters/index.mjs';
import { collectProjectFacts } from '../intelligence/assessment/facts.mjs';

function printHelp() {
  console.log(`Usage:
  node cli/inspect.mjs [project_dir] [--json] [--changed <file>]...

Inspect deterministic structural intelligence (analysis only).
No remediation. No execution. No Project Intelligence mutation.`);
}

export function runForgeOsInspectCli(argv = process.argv, options = {}) {
  const shouldPrint = options.print !== false;
  const args = { project_dir: process.cwd(), json: false, changed: [], help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--changed' && argv[i + 1]) args.changed.push(argv[++i]);
    else if (a === '--yes' || a === '--force') {
      const blocked = { ok: false, reason: 'forbidden_global_bypass', flag: a };
      if (shouldPrint) console.error(`BLOCKED: ${a}`);
      return blocked;
    } else if (!a.startsWith('-')) args.project_dir = path.resolve(a);
  }

  if (args.help) {
    if (shouldPrint) printHelp();
    return { ok: true, help: true };
  }

  const facts = collectProjectFacts(args.project_dir);
  const analysis = runStructuralAnalysis({
    project_dir: args.project_dir,
    project_id: facts.project_id,
    project_fingerprint: facts.project_intelligence_fingerprint,
    changed_files: args.changed,
    persist_cache: false,
  });

  const payload = {
    ok: analysis.ok,
    phase: 'structural_inspect',
    execute: false,
    mutate: false,
    project_id: facts.project_id,
    availability: describeAnalyzerAvailability(),
    facts: analysis.facts,
    impact: analysis.impact,
    note: 'Derived evidence only — not Project Intelligence authority',
  };

  if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
  else if (shouldPrint) {
    console.log('ForgeOS Structural Inspect (derived)');
    console.log(`Adapter: ${analysis.adapter_id} ok=${analysis.ok}`);
    console.log(`Evidence class: ${analysis.facts?.evidence_class}`);
    console.log(`Files: ${analysis.facts?.files?.length || 0}`);
    console.log(`Declarations: ${analysis.facts?.declarations?.length || 0}`);
    console.log(`Imports: ${analysis.facts?.imports?.length || 0}`);
    console.log(`Findings: ${analysis.facts?.findings?.length || 0}`);
    console.log(`tree-sitter: ${payload.availability.tree_sitter.status}`);
    console.log(`babel-parser: ${payload.availability.babel_parser?.status || 'unknown'}`);
    console.log(`SCIP: ${payload.availability.scip.status}`);
  }
  return payload;
}

const __cliEntry = fileURLToPath(import.meta.url);
const __isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__cliEntry);

if (__isMain) {
  const result = runForgeOsInspectCli();
  process.exit(result.ok === false && result.reason === 'forbidden_global_bypass' ? 2 : 0);
}
