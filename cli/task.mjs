#!/usr/bin/env node
/**
 * forgeos task — Stage 12 host-native handoff + verification request
 *
 * forgeos task <task_id>           → display / generate host handoff
 * forgeos task complete <task_id>  → request ForgeOS verification (not success)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecutedAsMain } from './main.mjs';
import { discoverProject } from '../policy/project-adapter.mjs';
import { runProjectAssessment } from '../intelligence/assessment/engine.mjs';
import {
  createHostHandoff,
  loadHostHandoff,
  formatHostHandoff,
  requestHostTaskVerification,
} from '../intelligence/orchestrator/host-handoff.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { selectHost, discoverHostCapabilities } from '../host/discovery.mjs';
import { validateHostHandoff } from '../intelligence/orchestrator/host-handoff.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function printHelp() {
  console.log(`Usage:
  node cli/task.mjs <task_id> [options]
  node cli/task.mjs complete <task_id> [options]

Options:
  --project <dir>     Project directory (default: cwd)
  --host <id>         codex | cursor | claude-code (configured active host, else cursor)
  --capability <id>   Capability filter when resolving from assessment
  --json              Emit JSON
  --no-persist        Do not write handoff/verification artifacts
  --regenerate        Regenerate a handoff from its task candidate for the selected host
  --help              Show help

Modes:
  task <id>           Generate/display host-native interactive handoff
  task complete <id>  Request ForgeOS verification (does not declare PASS)

--yes and --force are rejected.
forgeos run --execute is the programmatic_reference path (Local Executor), NOT Cursor host-native.
For host-native development work use: forgeos task <task_id> (same project workspace).`);
}

function parseArgs(argv) {
  const args = {
    project_dir: process.cwd(),
    json: false,
    persist: true,
    host_id: undefined,
    capability: null,
    task_id: null,
    complete: false,
  };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--regenerate') args.regenerate = true;
    else if (a === '--no-persist') args.persist = false;
    else if (a === '--yes' || a === '--force') args.forbidden_flag = a;
    else if (a === '--project' && argv[i + 1]) args.project_dir = path.resolve(argv[++i]);
    else if (a === '--host') {
      args.host_id = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    }
    else if (a === '--capability' && argv[i + 1]) args.capability = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) positional.push(a);
  }

  if (positional[0] === 'complete') {
    args.complete = true;
    args.task_id = positional[1] || null;
  } else {
    args.task_id = positional[0] || null;
  }
  return args;
}

function findCandidate(assessment, taskId, capabilityId) {
  const candidates = assessment.canvas?.task_candidates || [];
  if (taskId) {
    const byId = candidates.find((c) => c.task_id === taskId);
    if (byId) return byId;
  }
  if (capabilityId) {
    return candidates.find((c) => c.capability_id === capabilityId) || null;
  }
  return taskId ? null : candidates[0] || null;
}

function candidateFromHandoff(handoff) {
  if (!handoff) return null;
  const created = createTaskCandidate({
    task_id: handoff.task_id,
    capability_id: handoff.capability_id,
    objective: handoff.objective,
    task_scope: handoff.task_scope,
    permitted_action_classes: handoff.task_scope?.permitted_action_classes,
    scope: handoff.scope,
    rationale: handoff.rationale,
    expected_evidence: handoff.expected_evidence,
    verification_strategy: handoff.verification_strategy,
    verification_contract: handoff.verification_contract,
    verification_presence: handoff.verification_presence,
    verification_commands: handoff.verification_commands,
    project_id: handoff.policy_context?.project_id,
    agent_id: handoff.policy_context?.agent_id,
    allowed_paths: handoff.constraints?.allowed_paths,
    forbidden_paths: handoff.constraints?.forbidden_paths,
    operation_id: handoff.operation_id,
    expected_effects: handoff.expected_effects,
    finding_ids: handoff.relevant_evidence?.finding_ids,
  });
  return created.valid ? created.candidate : null;
}

export function runForgeOsTaskCli(argv = process.argv, options = {}) {
  try { return runForgeOsTaskCliChecked(argv, options); }
  catch (e) {
    const result = { ok: false, reason: e.message };
    if (options.print !== false) console.error(JSON.stringify(result));
    return result;
  }
}

function runForgeOsTaskCliChecked(argv = process.argv, options = {}) {
  const args = parseArgs(argv);
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
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error(`BLOCKED: ${args.forbidden_flag} is not valid.`);
    return blocked;
  }

  if (!args.task_id) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'task_id_required',
      note: 'Usage: node cli/task.mjs <task_id> | node cli/task.mjs complete <task_id>',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error('BLOCKED: task_id required.');
    return blocked;
  }

  const discovery = discoverProject(args.project_dir);
  const selection = selectHost({ host_id: args.host_id, project_dir: args.project_dir });
  if (!selection.ok || !selection.supported) {
    const blocked = { ok: false, phase: 'blocked', reason: selection.reason || 'unsupported_host' };
    if (shouldPrint) console.error(JSON.stringify(blocked));
    return blocked;
  }
  const explicitHost = selection.source === 'legacy_default' ? undefined : selection.host_id;
  const regenerate = args.regenerate === true || options.regenerate === true;
  args.host_id = selection.host_id;

  if (args.complete) {
    const result = requestHostTaskVerification({
      project_dir: args.project_dir,
      task_id: args.task_id,
      host_id: explicitHost,
      policy_context: options.policy_context,
      policy_decision: options.policy_decision,
      persist: args.persist,
      rescan: true,
      ...options.verification_options,
    });
    const payload = {
      ok: result.ok,
      forgeos_root: REPO_ROOT.replace(/\\/g, '/'),
      discovery,
      task: {
        task_id: args.task_id,
        capability_id: result.capability_id || null,
      },
      implementation: result.handoff?.implementation || null,
      host: result.handoff?.host || null,
      invocation_mode: result.handoff?.invocation_mode || null,
      handoff: result.handoff || null,
      execution_status: result.execution_status || null,
      verification_status: result.verification_status || null,
      verification: result.verification || null,
      evidence: result.evidence || null,
      capability_satisfied: result.capability_satisfied === true,
      canvas_delta: result.canvas_delta || null,
      note: result.note,
      reason: result.reason,
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
    else if (shouldPrint) {
      console.log('FORGEOS TASK COMPLETE REQUEST');
      console.log(`Task: ${args.task_id}`);
      console.log(`EXECUTION: ${payload.execution_status}`);
      console.log(`VERIFICATION: ${payload.verification_status}`);
      console.log(`CAPABILITY SATISFIED: ${payload.capability_satisfied ? 'YES' : 'NO'}`);
      console.log('Note: completion request is not automatic PASS.');
    }
    return payload;
  }

  const assessment = options.assessment || runProjectAssessment({
    project_dir: args.project_dir,
    persist: false,
    host_context: {
      host_id: args.host_id,
      capabilities: discoverHostCapabilities({ host_id: args.host_id }).capabilities,
    },
  });

  let candidate = findCandidate(assessment, args.task_id, args.capability);
  const existing = loadHostHandoff(args.project_dir, args.task_id);
  if (existing) {
    if (regenerate && !candidate) {
      const current = validateHostHandoff(existing, { project_dir: args.project_dir, expected_task_id: args.task_id });
      if (!current.ok) {
        const blocked = { ok: false, reason: 'regeneration_requires_current_candidate', validation: current };
        if (shouldPrint) console.error(JSON.stringify(blocked));
        return blocked;
      }
    }
    const validation = validateHostHandoff(existing, { project_dir: regenerate && !existing.workspace && candidate ? undefined : args.project_dir,
      expected_task_id: args.task_id, expected_host_id: regenerate ? undefined : explicitHost,
      check_freshness: !regenerate });
    const denied = [options.policy_decision, options.policy_context?.permission,
      options.policy_context?.policy_decision, existing.policy_context?.permission]
      .some(p => p === 'deny' || p?.permission === 'deny' || p?.decision === 'deny');
    if (!validation.ok || denied) {
      const blocked = { ok: false, reason: denied ? 'policy_deny' : validation.reasons.includes('stale_handoff') ? 'stale_handoff' : 'handoff_invalid', validation };
      if (shouldPrint) console.error(JSON.stringify(blocked));
      return blocked;
    }
  }
  if (!candidate && existing) {
    candidate = candidateFromHandoff(existing);
  }

  if (!candidate) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: 'task_not_found',
      task_id: args.task_id,
      note: 'No matching task candidate or handoff. Run forgeos plan / forgeos run first.',
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error(`BLOCKED: task not found: ${args.task_id}`);
    return blocked;
  }

  // Ensure task_id matches requested id when generating from capability filter
  if (candidate.task_id !== args.task_id) {
    candidate = { ...candidate, task_id: args.task_id };
  }

  const handoffResult = existing && existing.task_id === args.task_id && !regenerate
    ? { ok: true, handoff: existing, path: null, execution_status: existing.execution_status, verification_status: existing.verification_status }
    : createHostHandoff({
      project_dir: args.project_dir,
      candidate,
      host_id: args.host_id,
      persist: args.persist,
      host_context: {
        host_id: args.host_id,
        capabilities: options.host_capabilities || [
          'read', 'analyze', 'plan', 'write', 'edit', 'test', 'documentation',
        ],
      },
      policy_context: options.policy_context || {},
      policy_decision: options.policy_decision || null,
    });

  if (!handoffResult.ok) {
    const blocked = {
      ok: false,
      phase: 'blocked',
      reason: handoffResult.reason,
      note: handoffResult.note,
    };
    if (args.json && shouldPrint) console.log(JSON.stringify(blocked, null, 2));
    else if (shouldPrint) console.error(`BLOCKED: ${handoffResult.reason}`);
    return blocked;
  }

  const handoff = handoffResult.handoff;
  const payload = {
    ok: true,
    forgeos_root: REPO_ROOT.replace(/\\/g, '/'),
    discovery,
    task: candidate,
    implementation: handoff.implementation,
    host: handoff.host,
    invocation_mode: handoff.invocation_mode,
    handoff,
    execution_status: handoff.execution_status,
    verification_status: handoff.verification_status,
    path: handoffResult.path,
    note: 'Handoff generated ≠ execution started ≠ verification PASS',
  };

  if (args.json && shouldPrint) console.log(JSON.stringify(payload, null, 2));
  else if (shouldPrint) {
    console.log(formatHostHandoff(handoff));
    if (handoffResult.path) console.log(`\nHandoff written: ${handoffResult.path}`);
  }
  return payload;
}

if (isExecutedAsMain(import.meta.url)) {
  const result = runForgeOsTaskCli();
  process.exitCode = !result.ok ? 1 : result.verification_status === 'FAIL' ? 2 : 0;
}
