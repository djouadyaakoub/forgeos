/**
 * Orchestrator coordinator — bridges planner to live orchestration
 *
 * Orchestrator coordinates execution.
 * Planner decides recommended workflow.
 * Policy Engine decides ALLOW/BLOCK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverProject,
  loadProjectManifest,
  loadEffectiveRules,
} from '../../policy/project-adapter.mjs';
import { planDevelopmentIntelligenceWorkflow, formatWorkflowSummary } from './planner.mjs';
import {
  createExecutionRecord,
  recordStageEvidence,
  replanWorkflow,
  finalizeWorkflow,
  computeWorkflowEfficiency,
} from './execution.mjs';
import { checkCompatibility, MIGRATION_MODES } from '../compatibility/adapter.mjs';
import { getCanonicalVersion } from '../../policy/version.mjs';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function parseRegistryYaml(content) {
  const capabilities = [];
  let current = null;
  for (const line of content.split('\n')) {
    const idMatch = line.match(/^\s+-\s+id:\s+(\S+)/);
    if (idMatch) {
      if (current) capabilities.push(current);
      current = { id: idMatch[1], specialist_ids: [] };
      continue;
    }
    const specInline = line.match(/^\s+specialist_ids:\s+\[([^\]]+)\]/);
    if (specInline && current) {
      current.specialist_ids = specInline[1].split(',').map((s) => s.trim());
    }
    const agentItem = line.match(/^\s+-\s+(\S+)/);
    if (agentItem && current && line.trim().startsWith('-') && !line.includes('id:')) {
      if (!current.specialist_ids.includes(agentItem[1])) {
        current.specialist_ids.push(agentItem[1]);
      }
    }
  }
  if (current) capabilities.push(current);
  return { capabilities };
}

function loadGlobalRegistry() {
  const registryPath = path.join(REPO_ROOT, 'agents/registry.yaml');
  if (!fs.existsSync(registryPath)) return { capabilities: [] };
  return parseRegistryYaml(fs.readFileSync(registryPath, 'utf8'));
}

export function coordinateDevelopmentWorkflow(input = {}) {
  const projectDir = path.resolve(input.project_dir || process.env.CURSOR_PROJECT_DIR || process.cwd());
  const compat = checkCompatibility(projectDir, { osVersion: getCanonicalVersion() });
  if (!compat.compatible && compat.migration_mode === MIGRATION_MODES.INCOMPATIBLE) {
    return {
      phase: 'blocked_incompatible_environment',
      blocked: true,
      reason: compat.reason || 'incompatible',
      project: { dir: projectDir },
      compatibility: compat,
      policy_note: 'Workflow stopped — Universal OS version incompatible with project adapter',
      silent_mutation: false,
    };
  }
  const discovery = discoverProject(projectDir);
  const manifest = loadProjectManifest(projectDir);
  const policy = loadEffectiveRules(projectDir);
  const registry = input.registry || loadGlobalRegistry();

  const request = {
    objective: input.objective || input.task || '',
    description: input.description || '',
    domains: input.domains || [],
    paths: input.paths || [],
    signals: input.signals || {},
    sensitive_flags: input.sensitive_flags || [],
    complexity: input.complexity,
    knowledge_sufficient: input.knowledge_sufficient,
  };

  const context = {
    project_dir: projectDir,
    project_adapter: manifest.data || {},
    manifest,
    policy,
    registry,
    project_knowledge: manifest.data?.knowledge || {},
    task_state: input.task_state || {},
    previous_risk: input.task_state?.risk,
    previous_plan: input.task_state?.plan,
  };

  const plan = planDevelopmentIntelligenceWorkflow(request, context);
  const execution = createExecutionRecord(plan, { task_id: input.task_id });

  return {
    phase: 'development_intelligence_orchestration',
    project: {
      dir: projectDir,
      mode: discovery.mode,
      id: manifest.data?.project?.id || null,
    },
    request: {
      objective: request.objective,
      domains: request.domains,
    },
    plan,
    execution,
    user_summary: plan.user_summary,
    policy_note: 'Policy Engine retains ALLOW/BLOCK authority — planner recommends only',
    isolation: {
      uses_project_adapter: !!manifest.data,
      global_only_for_sample: manifest.data?.project?.id === 'sample-project',
    },
  };
}

export {
  replanWorkflow,
  createExecutionRecord,
  recordStageEvidence,
  finalizeWorkflow,
  computeWorkflowEfficiency,
} from './execution.mjs';

export { planDevelopmentIntelligenceWorkflow, formatWorkflowSummary } from './planner.mjs';
