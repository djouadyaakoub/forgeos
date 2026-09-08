#!/usr/bin/env node
/**
 * forgeos run — Stage 8 assess/plan + Stage 9 optional governed execute
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecutedAsMain } from './main.mjs';
import { discoverProject } from '../policy/project-adapter.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import { formatCanvasText } from '../intelligence/assessment/canvas.mjs';
import { createTaskApproval } from '../intelligence/orchestrator/approval.mjs';
import { executeApprovedCandidate, formatLoopOutcome } from '../intelligence/orchestrator/approved-execution.mjs';
import { formatCanvasDelta } from '../intelligence/orchestrator/canvas-delta.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';
import { selectHost } from '../host/discovery.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    project_dir: process.cwd(),
    json: false,
    capability: null,
    host_id: undefined,
    persist: true,
    execute: false,
    approve_task: null,
    approve_by: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--no-persist') args.persist = false;
    else if (a === '--execute') args.execute = true;
    else if (a === '--yes' || a === '--force') {
      args.forbidden_flag = a;
    } else if (a === '--project' && argv[i + 1]) {
      args.project_dir = path.resolve(argv[++i]);
    } else if (a === '--capability' && argv[i + 1]) {
      args.capability = argv[++i];
    } else if (a === '--host') {
      args.host_id = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    } else if (a === '--approve-task' && argv[i + 1]) {
      args.approve_task = argv[++i];
    } else if (a === '--approve-by' && argv[i + 1]) {
      args.approve_by = argv[++i];
    } else if (a === '--exact-approval' && argv[i + 1]) {
      args.exact_approval_id = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (!a.startsWith('-') && i === 2 && !argv[2]?.startsWith('-')) {
      args.project_dir = path.resolve(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node cli/run.mjs [project_dir] [options]

Stage 17 execution model:
  Host-native (primary UX):  forgeos task <task_id> --host codex  → selected host handoff
  Programmatic reference:    forgeos run --execute   → Local Executor (NOT a host launcher)
  Optional runtime:          explicit RuntimeBackend (e.g. OpenHands) — not Core

Options:
  --project <dir>          Project directory (default: cwd) — existing workspace only
  --capability <id>        Filter / select capability
  --host <id>              Host context id (default: cli)
  --json                   Emit JSON result
  --no-persist             Do not write assessment artifacts
  --execute                Programmatic governed execution via Local Executor
                           (requires --approve-task; NOT host-native execution)
  --approve-task <task_id> Explicit task-scoped approval (required with --execute)
  --approve-by <id>        Approval attribution
  --help                   Show help

Default: assess + plan + canvas. No execution.
For host-native development work prefer: forgeos task <task_id>
--yes and --force are rejected.`);
}

function selectCandidate(assessment, capabilityId) {
  const candidates = assessment.canvas.task_candidates || [];
  if (capabilityId) {
    return candidates.find((c) => c.capability_id === capabilityId && c.operation) || null;
  }
  return candidates.find((c) => c.operation) || null;
}

export function runForgeOsAssessmentCli(argv = process.argv, options = {}) {
  const args = parseArgs(argv);
  const shouldPrint = options.print !== false;
  const selected = selectHost({ host_id: args.host_id, project_dir: args.project_dir });
  if (!selected.ok) {
    const blocked = { ok: false, phase: 'blocked', reason: selected.reason };
    if (shouldPrint) console.error(JSON.stringify(blocked));
    return blocked;
  }
  args.host_id = selected.source === 'legacy_default' ? 'cli' : selected.host_id;
  if (args.help) {
    printHelp();
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
    else if (shouldPrint) console.error(`BLOCKED: ${args.forbidden_flag} is not a valid ForgeOS flag.`);
    return blocked;
  }

  const projectDir = args.project_dir;
  const discovery = discoverProject(projectDir);
  const result = runProjectAssessment({
    project_dir: projectDir,
    persist: args.persist,
    host_context: {
      host_id: args.host_id,
      capabilities: options.host_capabilities || ['read', 'analyze', 'plan', 'write', 'test'],
    },
    host_id: args.host_id,
    ...options,
  });

  let output = result;
  if (args.capability) {
    const filtered = result.assessments.filter((a) => a.binding.id === args.capability);
    output = {
      ...result,
      assessments: filtered,
      canvas: {
        ...result.canvas,
        items: result.canvas.items.filter((i) => i.capability_id === args.capability),
        task_candidates: result.canvas.task_candidates.filter((t) => t.capability_id === args.capability),
      },
    };
  }

  if (!args.execute) {
    const payload = {
      ok: true,
      forgeos_root: REPO_ROOT.replace(/\\/g, '/'),
      discovery,
      result: output,
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
    else if (shouldPrint) {
      console.log(formatCanvasText(output.canvas));
      console.log('');
      console.log(`Project detected: ${discovery.mode} @ ${projectDir}`);
      console.log(`Capabilities assessed: ${output.canvas.summary.total}`);
      console.log('Mode: assess + plan only. No execution.');
    }
    return payload;
  }

  const candidate = selectCandidate(output, args.capability);
  if (!candidate) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'no_executable_candidate',
      discovery,
      result: output,
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error('BLOCKED: no executable task candidate (need capability with operation).');
    return blocked;
  }

  if (!args.approve_task) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'approval_missing',
      proposed_task: {
        task_id: candidate.task_id,
        capability_id: candidate.capability_id,
        objective: candidate.objective,
      },
      note: 'Pass --approve-task <task_id> for explicit task-scoped approval. No implicit approval.',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) {
      console.error('BLOCKED: --execute requires explicit --approve-task <task_id>.');
      console.error(`Proposed task: ${candidate.task_id} (${candidate.capability_id})`);
    }
    return blocked;
  }

  const created = createTaskApproval({
    task_id: args.approve_task,
    capability_id: candidate.capability_id,
    approved: true,
    approved_by: args.approve_by || 'cli',
    operation_fingerprint: candidate.operation_fingerprint,
  });
  if (!created.valid) {
    return { ok: false, phase: 'blocked', reason: created.error, executed: false };
  }

  const registry = options.runtime_registry || (() => {
    const r = createRuntimeRegistry();
    r.register(createLocalExecutorBackend());
    return r;
  })();

  const loop = executeApprovedCandidate({
    project_dir: projectDir,
    candidate,
    approval: created.approval,
    exact_approval_id: args.exact_approval_id,
    runtime_registry: registry,
    persist: args.persist,
    host_context: {
      host_id: args.host_id,
      capabilities: options.host_capabilities || ['read', 'analyze', 'plan', 'write', 'test'],
    },
    before_assessment: output,
    ...options.execution_options,
  });

  const payload = {
    ok: loop.ok,
    discovery,
    assessment: output,
    execution: loop,
    verification: loop.verification,
    evidence: loop.governance_evidence,
    canvas: loop.canvas_after,
    delta: loop.canvas_delta,
    result: output,
    execution_model: {
      path: 'programmatic_reference',
      backend: 'local-executor',
      host_native: false,
      primary_ux: false,
      note: 'forgeos run --execute uses Local Executor (programmatic reference). For host-native UX use: forgeos task <task_id> --host codex|cursor|claude-code',
      recommended_host_native_cli: `forgeos task ${candidate.task_id}`,
      project_dir: projectDir.replace(/\\/g, '/'),
      same_workspace: true,
    },
  };

  if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
  else if (shouldPrint) {
    console.log(formatLoopOutcome(loop));
    console.log('');
    console.log('Execution model: programmatic_reference (Local Executor) — NOT host-native execution.');
    console.log(`Host-native UX: forgeos task ${candidate.task_id}`);
    if (loop.canvas_delta) console.log(formatCanvasDelta(loop.canvas_delta));
    if (loop.verification?.result !== 'PASS' && loop.governed?.status === 'COMPLETED') {
      console.log('Not reporting SUCCESS: verification did not pass.');
    }
  }

  return payload;
}

if (isExecutedAsMain(import.meta.url)) {
  runForgeOsAssessmentCli();
}
