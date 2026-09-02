/**
 * Canonical Project Intelligence profile builder
 */
import fs from 'node:fs';
import path from 'node:path';
import { emptyCanonicalProfile } from './intelligence-model.mjs';
import { resolveEvidenceSets } from './evidence-resolver.mjs';
import { extractProjectAdapter } from './adapter-extraction.mjs';
import { extractAllFormats } from './multi-format-extraction.mjs';
import { detectStackDetail } from './project-discovery.mjs';
import { discoverDeploymentTargets } from '../intelligence/deployment/discovery.mjs';

function slugFromDir(dir) {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function buildCanonicalProjectProfile(projectDir) {
  const root = path.resolve(projectDir);
  const profile = emptyCanonicalProfile(root);

  profile.identity = {
    id: slugFromDir(root),
    name: path.basename(root),
    path: root,
    has_forgeos_manifest: fs.existsSync(path.join(root, '.agent-os/project.yaml')),
    has_agents_md: fs.existsSync(path.join(root, 'AGENTS.md')),
    has_registry: fs.existsSync(path.join(root, '.cursor/agents/registry.yaml')),
    has_specialists: fs.existsSync(path.join(root, 'docs/agents/SPECIALISTS.md')),
    has_playbooks: fs.existsSync(path.join(root, 'docs/agents/task-playbooks')),
  };

  const stackDetail = detectStackDetail(root);
  profile.stack = {
    repository: stackDetail.repository,
    components: stackDetail.components,
    evidence: stackDetail.evidence,
    evidence_summary: stackDetail.evidence_summary,
  };

  profile.components = Object.entries(stackDetail.components || {}).map(([name, flags]) => ({
    name,
    path: name === '.' ? '.' : `${name}/`,
    stack: Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k),
    evidence: stackDetail.evidence_summary
      ? Object.entries(stackDetail.evidence_summary)
          .filter(([, paths]) => paths.some((p) => p.startsWith(name)))
          .flatMap(([, paths]) => paths.filter((p) => p.startsWith(name)))
      : [],
  }));

  const { adapter } = extractProjectAdapter(root);
  const multi = extractAllFormats(root);

  const registryCaps = (adapter.capabilities || []).map((c) => ({
    ...c,
    source_type: 'project_registry',
    confidence: 0.95,
    inferred: false,
  }));

  const registryAgents = Object.entries(adapter.agents || {}).map(([id, cfg]) => ({
    id,
    ...cfg,
    source_type: 'project_registry',
    confidence: 0.95,
    inferred: false,
  }));

  const multiCaps = multi.capability_sources.flatMap((s) => s.capabilities || []);
  const multiAgents = multi.agent_sources.flatMap((s) => s.agents || []);

  const resolved = resolveEvidenceSets({
    capabilities: [registryCaps, multiCaps],
    agents: [registryAgents, multiAgents],
    ownership: [...(adapter.ownership || []), ...multi.ownership_sources],
    verification: [...(adapter.verification?.commands || []), ...multi.verification],
  });

  profile.capabilities = resolved.capabilities;
  profile.agents = resolved.agents;
  profile.ownership = resolved.ownership;
  profile.verification = resolved.verification;
  profile.contradictions = [
    ...(adapter.contradictions || []),
    ...resolved.contradictions,
  ];

  profile.policies = {
    protected_paths: adapter.policy?.protected_paths || [],
    tier3_operations: adapter.policy?.tier3_operations || [],
    shell_rules: adapter.policy?.shell_rules || [],
    mcp_rules: adapter.policy?.mcp_rules || [],
  };

  const deploymentDiscovery = discoverDeploymentTargets({
    project_dir: root,
    project_adapter: adapter,
  });
  profile.deployment = deploymentDiscovery.targets.map((t) => t.deployment_target);

  profile.knowledge = Object.entries(adapter.knowledge || {}).map(([key, rel]) => ({
    key,
    path: rel,
    source: 'filesystem',
  }));

  profile.confidence = {
    capabilities: averageConfidence(profile.capabilities),
    agents: averageConfidence(profile.agents),
    ownership: averageConfidence(profile.ownership),
    overall: averageConfidence([
      ...profile.capabilities,
      ...profile.agents,
      ...profile.ownership,
    ]),
  };

  profile.project_adapter = adapter;
  profile.adapter_summary = {
    capability_count: profile.capabilities.length,
    agent_count: profile.agents.length,
    ownership_count: profile.ownership.length,
    deployment_count: profile.deployment.length,
    contradiction_count: profile.contradictions.length,
  };

  return profile;
}

function averageConfidence(items) {
  if (!items?.length) return 0;
  const sum = items.reduce((a, i) => a + (i.confidence || 0), 0);
  return Math.round((sum / items.length) * 100) / 100;
}

export function profileToPlannerContext(profile) {
  const adapter = profile.project_adapter || {};
  adapter.capabilities = profile.capabilities;
  adapter.agents = Object.fromEntries(profile.agents.map((a) => [a.id, a]));

  return {
    project_dir: profile.project_dir,
    project_adapter: adapter,
    project_profile: profile,
    capabilities: profile.capabilities,
    agents: adapter.agents,
    manifest: { data: adapter },
  };
}
