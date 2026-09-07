#!/usr/bin/env node
/**
 * Universal Cursor Agent OS — non-destructive project bootstrapper
 * Usage: node bootstrap/initialize.mjs [--dry-run] [--apply-adapter] [--project-dir <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildProjectProfile, findContradictions } from './project-discovery.mjs';
import { adapterToYaml } from './adapter-extraction.mjs';
import { loadProjectManifest } from '../policy/project-adapter.mjs';
import { installPortablePolicyHooks } from '../policy/portable-hooks.mjs';
import { prepareHostProject } from '../host/preparation.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const applyAdapter = args.includes('--apply-adapter');
const projectDirIdx = args.indexOf('--project-dir');
const projectDir = projectDirIdx >= 0 ? path.resolve(args[projectDirIdx + 1]) : process.cwd();

// Explicit host-native preparation is separate from legacy Cursor hook installation.
if (args.includes('--prepare-host')) {
  const hostIndex = args.indexOf('--host');
  const result = prepareHostProject({ project_dir: projectDir,
    host_id: hostIndex >= 0 ? (args[hostIndex + 1] || '') : undefined,
    apply: args.includes('--apply') && !dryRun });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function slugFromDir(dir) {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function buildManifest(profile, metaOverrides = {}) {
  const id = metaOverrides.id || slugFromDir(projectDir);
  const prefix = metaOverrides.task_id_prefix || id.toUpperCase().replace(/-/g, '').slice(0, 6) || 'TASK';
  const name = metaOverrides.name || path.basename(projectDir);

  if (profile.adapter) {
    return adapterToYaml(profile.adapter, {
      id,
      name,
      task_id_prefix: prefix,
      stack: profile.stack,
    });
  }

  const stack = Object.entries(profile.stack?.repository || profile.stack_indicators || {})
    .filter(([, v]) => v)
    .map(([k]) => k);

  const componentLines = Object.entries(profile.stack?.components || {})
    .map(([name, flags]) => {
      const techs = Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => k);
      return `    ${name}: [${techs.join(', ')}]`;
    })
    .join('\n');

  return `schema_version: 1

contract:
  version: 1

agent_os:
  version: ">=2.0 <3.0"
  adapter_schema_version: 1

forgeos:
  version: ">=2.0 <3.0"
  adapter_schema_version: 1

project:
  id: ${id}
  name: ${path.basename(projectDir)}
  type: application
  task_id_prefix: ${prefix}

stack:
  detected: [${stack.join(', ')}]
  components:
${componentLines || '    # populated by bootstrap from repository evidence'}

paths:
  docs: docs/
  tasks: docs/project/tasks/

knowledge:
  agents: AGENTS.md
  stack: docs/STACK.md
  architecture: docs/architecture/
  contracts: docs/contracts/
  adr: docs/adr/
  tasks: docs/project/tasks/
  lessons: docs/runbooks/lessons/

capabilities: []

agents: {}

ownership: []

policy:
  protected_paths: []
  tier3_operations: []

integrations:
  mcp: []

verification:
  commands: []

runtime:
  requirements: {}
`;
}

function planBootstrap(profile) {
  const actions = [];
  const manifestPath = path.join(projectDir, '.agent-os/project.yaml');

  if (!fs.existsSync(manifestPath)) {
    actions.push({ action: 'create', path: '.agent-os/project.yaml', reason: 'project adapter' });
  } else {
    actions.push({ action: 'preserve', path: '.agent-os/project.yaml', reason: 'already exists' });
  }

  const tasksDir = path.join(projectDir, 'docs/project/tasks');
  if (!fs.existsSync(tasksDir)) {
    actions.push({ action: 'create', path: 'docs/project/tasks/index.yaml', reason: 'task store skeleton' });
  }

  const registryPath = path.join(projectDir, '.cursor/agents/registry.yaml');
  if (!fs.existsSync(registryPath)) {
    actions.push({ action: 'create', path: '.cursor/agents/registry.yaml', reason: 'project capability stub' });
  }

  const agentsMd = path.join(projectDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    actions.push({ action: 'create_optional', path: 'AGENTS.md', reason: 'project entrypoint template' });
  }

  const hooksPath = path.join(projectDir, '.cursor/hooks.json');
  if (!fs.existsSync(hooksPath)) {
    actions.push({ action: 'create', path: '.cursor/hooks.json', reason: 'wire project policy hooks' });
  }

  return actions;
}

function applyBootstrap(profile, actions) {
  const created = [];

  for (const a of actions) {
    if (a.action === 'preserve') continue;
    if (a.action === 'create_optional') continue;

    const full = path.join(projectDir, a.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });

    if (a.path === '.agent-os/project.yaml') {
      fs.writeFileSync(full, buildManifest(profile), 'utf8');
      created.push(a.path);
    } else if (a.path === 'docs/project/tasks/index.yaml') {
      fs.writeFileSync(full, 'schema_version: 1\ntasks: []\nnext_sequence: 1\n', 'utf8');
      fs.mkdirSync(path.join(projectDir, 'docs/project/tasks/active'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'docs/project/tasks/completed'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'docs/project/tasks/archived'), { recursive: true });
      created.push(a.path);
    } else if (a.path === '.cursor/agents/registry.yaml') {
      fs.writeFileSync(
        full,
        'schema_version: 1\n# Project-specific capabilities — extends global Agent OS registry\ncapabilities: []\n',
        'utf8'
      );
      created.push(a.path);
    } else if (a.path === '.cursor/hooks.json') {
      // Architecture 2.0 Stage 2: portable shims only — no absolute plugin paths.
      // Same authority path as integrate-runtime → Policy Authority (forgeos).
      installPortablePolicyHooks(projectDir, {
        integrated_by: 'bootstrap/initialize.mjs',
      });
      created.push(a.path);
      created.push('.cursor/hooks/agent-os/');
      created.push('.agent-os/runtime.yaml');
    }
  }

  return created;
}

function readManifestMetaOverrides() {
  const existing = loadProjectManifest(projectDir);
  if (!existing.data?.project) return {};
  return {
    id: existing.data.project.id,
    name: existing.data.project.name,
    task_id_prefix: existing.data.project.task_id_prefix,
  };
}

function applyAdapterOnly(profile) {
  if (!profile.adapter) {
    throw new Error('No adapter extraction available for this project');
  }
  const manifestPath = path.join(projectDir, '.agent-os/project.yaml');
  const meta = readManifestMetaOverrides();
  const content = buildManifest(profile, meta);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, content, 'utf8');
  return manifestPath;
}

const profile = buildProjectProfile(projectDir);
const contradictions = findContradictions(profile);
const actions = planBootstrap(profile);

const report = {
  project_dir: profile.project_dir,
  project_kind: profile.project_kind,
  agent_os_initialized: profile.agent_os_initialized,
  existing_project: profile.existing_project,
  mode: profile.mode,
  initialized: profile.initialized,
  stack: {
    repository: profile.stack.repository,
    components: profile.stack.components,
  },
  stack_evidence: profile.stack.evidence_summary,
  existing_docs: profile.existing_docs,
  diagnostics: profile.diagnostics,
  adapter_summary: profile.adapter_summary,
  adapter_validation: profile.adapter_validation,
  adapter_contradictions: profile.adapter?.contradictions || [],
  proposed_adapter: dryRun && profile.adapter
    ? {
        summary: profile.adapter_summary,
        capabilities: profile.adapter.capabilities?.length || 0,
        agents: Object.keys(profile.adapter.agents || {}),
        tier3_operations: (profile.adapter.policy?.tier3_operations || []).map((o) => o.id),
        mcp: (profile.adapter.integrations?.mcp || []).map((m) => m.id),
        verification_commands: (profile.adapter.verification?.commands || []).length,
        deployment: profile.adapter.deployment,
      }
    : undefined,
  contradictions,
  planned_actions: actions,
  dry_run: dryRun,
  apply_adapter: applyAdapter,
};

if (applyAdapter && !dryRun) {
  const appliedPath = applyAdapterOnly(profile);
  report.applied_adapter_path = appliedPath.replace(/\\/g, '/');
  report.applied_adapter_summary = profile.adapter_summary;
}

console.log(JSON.stringify(report, null, 2));

if (!dryRun && !applyAdapter) {
  const created = applyBootstrap(profile, actions);
  console.log('\nCreated:', created.join(', ') || '(none)');
}

if (applyAdapter && dryRun) {
  console.error('\nNote: --apply-adapter requires running without --dry-run');
  process.exit(1);
}

process.exit(0);
