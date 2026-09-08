#!/usr/bin/env node
/**
 * forgeos plan — Stage 11 plan-only capability orchestration
 *
 * Never executes. Never calls backend.start().
 * Preserves Stage 8–10 forgeos run semantics separately (cli/run.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecutedAsMain } from './main.mjs';
import { discoverProject } from '../policy/project-adapter.mjs';
import { selectHost } from '../host/discovery.mjs';
import {
  planFromRequest,
  formatOrchestrationPlan,
} from '../intelligence/orchestrator/main-agent.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function printHelp() {
  console.log(`Usage: node cli/plan.mjs "<request>" [options]

Options:
  --project <dir>     Project directory (default: cwd)
  --request <text>    Explicit request text
  --host <id>         Host context id (default: cli)
  --json              Emit JSON plan
  --persist           Persist assessment artifacts while planning
  --help              Show help

Plan-only. No execution.
--execute, --yes, and --force are rejected.`);
}

function parsePlanArgs(argv) {
  const args = {
    project_dir: process.cwd(),
    json: false,
    persist: false,
    request: null,
    host_id: undefined,
  };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--persist') args.persist = true;
    else if (a === '--no-persist') args.persist = false;
    else if (a === '--yes' || a === '--force') args.forbidden_flag = a;
    else if (a === '--execute') args.forbidden_execute = true;
    else if (a === '--project' && argv[i + 1]) args.project_dir = path.resolve(argv[++i]);
    else if (a === '--host') args.host_id = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    else if (a === '--request' && argv[i + 1]) args.request = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) positional.push(a);
  }

  if (!args.request && positional.length) {
    if (positional.length >= 2) {
      const maybeDir = path.resolve(positional[0]);
      if (fs.existsSync(maybeDir) && fs.statSync(maybeDir).isDirectory()) {
        args.project_dir = maybeDir;
        args.request = positional.slice(1).join(' ');
      } else {
        args.request = positional.join(' ');
      }
    } else {
      const maybeDir = path.resolve(positional[0]);
      if (fs.existsSync(maybeDir) && fs.statSync(maybeDir).isDirectory()) {
        args.project_dir = maybeDir;
      } else {
        args.request = positional[0];
      }
    }
  }
  return args;
}

export function runForgeOsPlanCli(argv = process.argv, options = {}) {
  const args = parsePlanArgs(argv);
  const shouldPrint = options.print !== false;

  if (args.help) {
    if (shouldPrint) printHelp();
    return { ok: true, help: true };
  }

  if (args.forbidden_flag) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'forbidden_global_bypass',
      flag: args.forbidden_flag,
      note: 'No --yes or --force policy/approval bypass exists',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error(`BLOCKED: ${args.forbidden_flag} is not a valid ForgeOS plan flag.`);
    return blocked;
  }

  if (args.forbidden_execute) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'plan_is_plan_only',
      note: 'forgeos plan never executes. Use forgeos run --execute --approve-task after reviewing the plan.',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error('BLOCKED: forgeos plan is plan-only.');
    return blocked;
  }

  if (!args.request) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'request_missing',
      note: 'Provide a request string: node cli/plan.mjs "Organize this project"',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error('BLOCKED: request text required.');
    return blocked;
  }

  const selected = selectHost({ host_id: args.host_id, project_dir: args.project_dir });
  if (!selected.ok) {
    const result = { ok: false, reason: selected.reason };
    if (shouldPrint) console.error(JSON.stringify(result));
    return result;
  }
  args.host_id = selected.source === 'legacy_default' ? 'cli' : selected.host_id;
  const discovery = discoverProject(args.project_dir);
  const result = planFromRequest({
    request: args.request,
    project_dir: args.project_dir,
    persist: args.persist,
    host_context: {
      host_id: args.host_id,
      capabilities: options.host_capabilities || ['read', 'analyze', 'plan', 'write', 'test'],
    },
    ...options.plan_options,
  });

  const payload = {
    ok: result.ok,
    forgeos_root: REPO_ROOT.replace(/\\/g, '/'),
    discovery,
    intent: result.plan.intent,
    capabilities: result.plan.capabilities,
    tasks: result.plan.task_candidates,
    dependencies: result.plan.dependencies,
    unresolved: result.plan.unresolved,
    unresolved_questions: result.plan.unresolved_questions,
    risk_summary: result.plan.risk_summary,
    execution_status: result.plan.execution_status,
    plan: result.plan,
    assessment_summary: result.assessment_summary,
  };

  if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
  else if (shouldPrint) {
    console.log(formatOrchestrationPlan(result.plan));
    console.log('');
    console.log(`Project detected: ${discovery.mode} @ ${args.project_dir}`);
    console.log('Mode: plan only. No execution.');
  }

  return payload;
}

if (isExecutedAsMain(import.meta.url)) {
  runForgeOsPlanCli();
}
