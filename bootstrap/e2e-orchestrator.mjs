#!/usr/bin/env node
/**
 * Full Orchestrator E2E — Development Intelligence Planner integration
 *
 * Usage:
 *   node bootstrap/e2e-orchestrator.mjs --project-dir <path> --task "<objective>"
 */
import path from 'node:path';
import { coordinateDevelopmentWorkflow } from '../intelligence/orchestrator/coordinator.mjs';

const args = process.argv.slice(2);
const projectDirIdx = args.indexOf('--project-dir');
const taskIdx = args.indexOf('--task');
const projectDir = projectDirIdx >= 0 ? path.resolve(args[projectDirIdx + 1]) : process.cwd();
const task =
  taskIdx >= 0
    ? args.slice(taskIdx + 1).join(' ')
    : 'Analyze backend architecture without modifying files';

process.env.CURSOR_PROJECT_DIR = projectDir;

const result = coordinateDevelopmentWorkflow({
  project_dir: projectDir,
  objective: task,
  task_id: `E2E-${Date.now()}`,
});

const trail = {
  phase: 'orchestrator_e2e',
  project_dir: projectDir,
  task,
  planner: {
    task_class: result.plan.development_workflow.task_class,
    complexity: result.plan.development_workflow.complexity,
    risk: result.plan.development_workflow.risk,
    stages: result.plan.development_workflow.stages.map((s) => ({
      name: s.name,
      agent: s.agent,
      capability: s.capability,
      required: s.required,
      depends_on: s.depends_on,
    })),
    skipped_agents: result.plan.development_workflow.skipped_agents,
    research_required: result.plan.development_workflow.research.required,
    security_required: result.plan.development_workflow.security_review.required,
    architecture_required: result.plan.development_workflow.architecture_review.required,
  },
  user_summary: result.user_summary,
  execution: result.execution.workflow_execution,
  result: {
    delegated: result.plan.development_workflow.stages.length > 0,
    read_only: /explain|analyze without modifying/i.test(task),
    specialist: result.plan.development_workflow.recommended_agents[0] || null,
  },
};

console.log(JSON.stringify(trail, null, 2));
const ok = result.project.mode === 'INITIALIZED' || result.plan.development_workflow.stages.length > 0;
process.exit(ok ? 0 : 1);
