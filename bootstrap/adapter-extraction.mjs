/**
 * Universal Cursor Agent OS — project adapter extraction
 * Extracts capabilities, agents, policy, MCP, verification from mature repos.
 * Read-only; never writes to the target project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadGlobalRules } from '../policy/project-adapter.mjs';
import { extractAllFormats } from './multi-format-extraction.mjs';
import { resolveEvidenceSets } from './evidence-resolver.mjs';
import { normalizeCapability, normalizeAgent } from './capability-normalizer.mjs';

const GLOBAL_PROTECTED_PREFIXES = new Set([
  '.cursor/agents/',
  '.cursor/hooks/',
  '.cursor/skills/',
  '.cursor/policy/',
  'docs/agents/RUNTIME_LAW.md',
]);

const GLOBAL_PROTECTED_EXACT = new Set([
  '.cursor/agents/registry.yaml',
  '.cursor/hooks.json',
]);

const SECRET_KEY_PATTERN = /(token|secret|password|api[_-]?key|credential|bearer|auth)/i;

function readIfExists(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function readJsonIfExists(root, rel) {
  const raw = readIfExists(root, rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Minimal YAML parser for registry / mapping files */
export function parseYaml(content) {
  const lines = String(content).split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  function peekNext(fromIdx, indent) {
    for (let i = fromIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const li = l.match(/^(\s*)/)[1].length;
      if (li <= indent) return null;
      if (/^\s*-\s+/.test(l)) return 'list';
      if (/^\s*[a-zA-Z0-9_.-]+:\s*$/.test(l)) return 'map';
      if (/^\s*[a-zA-Z0-9_.-]+:\s+\S/.test(l)) return 'scalar';
      return null;
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)[1].length;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem) {
      const raw = listItem[1].trim();
      const kv = raw.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
      if (Array.isArray(parent)) {
        if (kv) {
          const obj = { [kv[1]]: parseScalar(kv[2]) };
          parent.push(obj);
        } else {
          parent.push(parseScalar(raw));
        }
      }
      continue;
    }

    const kv = line.match(/^(\s*)([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[2];
    const value = kv[3].trim();

    if (value === '') {
      const next = peekNext(i, indent);
      const child = next === 'list' ? [] : {};
      parent[key] = child;
      stack.push({ indent, obj: child });
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      parent[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }

    parent[key] = parseScalar(value);
  }
  return root;
}

function parseScalar(value) {
  const v = value.replace(/^["']|["']$/g, '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function isGlobalProtected(p) {
  const norm = String(p).replace(/\\/g, '/');
  if (GLOBAL_PROTECTED_EXACT.has(norm)) return true;
  return [...GLOBAL_PROTECTED_PREFIXES].some((pref) => norm === pref.replace(/\/$/, '') || norm.startsWith(pref));
}

export function redactSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redactSecrets(v);
    } else if (typeof v === 'string' && SECRET_KEY_PATTERN.test(v)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadRegistry(projectDir) {
  const raw = readIfExists(projectDir, '.cursor/agents/registry.yaml');
  if (!raw) return { data: null, source: null };
  return { data: parseYaml(raw), source: '.cursor/agents/registry.yaml' };
}

function loadSpecialistMapping(projectDir) {
  const raw = readIfExists(projectDir, 'docs/agents/design/specialist-mapping.yaml');
  if (!raw) return { data: null, source: null };
  return { data: parseYaml(raw), source: 'docs/agents/design/specialist-mapping.yaml' };
}

function loadProjectPolicy(projectDir) {
  return readJsonIfExists(projectDir, '.cursor/policy/rules.json');
}

function listAgentMdFiles(projectDir) {
  const dir = path.join(projectDir, '.cursor/agents');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('README'))
    .map((f) => f.replace(/\.md$/, ''));
}

function extractCapabilities(registry, sources) {
  if (!registry?.agents) return [];
  const capabilities = [];

  for (const [agentId, cfg] of Object.entries(registry.agents)) {
    if (agentId === 'orchestrator') continue;
    const caps = normalizeList(cfg.capabilities);
    for (const capId of caps) {
      capabilities.push({
        id: capId,
        description: capId.replace(/-/g, ' '),
        domains: normalizeList(cfg.domains),
        paths: normalizeList(cfg.paths_owned).length ? normalizeList(cfg.paths_owned) : normalizeList(cfg.paths_writable),
        agent: agentId,
        verification: normalizeList(cfg.verification),
        playbook: cfg.playbook || null,
        source: sources.registry,
      });
    }
  }
  return capabilities;
}

function extractAgents(registry, agentFiles, sources) {
  const agents = {};
  const registryIds = registry?.agents ? Object.keys(registry.agents) : [];

  for (const id of registryIds) {
    const cfg = registry.agents[id];
    agents[id] = {
      file: cfg.file || `${id}.md`,
      exists: agentFiles.includes(id),
      tool_profile: cfg.tool_profile || null,
      approval_tier_max: cfg.approval_tier_max ?? null,
      capabilities: normalizeList(cfg.capabilities),
      domains: normalizeList(cfg.domains),
      paths_owned: normalizeList(cfg.paths_owned),
      paths_writable: normalizeList(cfg.paths_writable),
      paths_readable: normalizeList(cfg.paths_readable),
      paths_forbidden: normalizeList(cfg.paths_forbidden),
      handoff_only_writes: cfg.handoff_only_writes ?? null,
      mcp: normalizeList(cfg.mcp),
      source: sources.registry,
    };
  }

  for (const id of agentFiles) {
    if (!agents[id]) {
      agents[id] = { file: `${id}.md`, exists: true, source: '.cursor/agents/*.md' };
    }
  }

  return agents;
}

function extractOwnership(registry, sources) {
  if (!registry?.agents) return [];
  return Object.entries(registry.agents).map(([agent, cfg]) => ({
    agent,
    paths: normalizeList(cfg.paths_owned),
    writable: normalizeList(cfg.paths_writable),
    readable: normalizeList(cfg.paths_readable),
    forbidden: normalizeList(cfg.paths_forbidden),
    source: sources.registry,
  }));
}

function extractProjectProtectedPaths(registry, policy) {
  const paths = new Set();

  if (registry?.agents) {
    for (const cfg of Object.values(registry.agents)) {
      for (const p of normalizeList(cfg.paths_forbidden)) {
        if (p && p !== 'per_handoff' && !p.includes(' as ') && !isGlobalProtected(p)) {
          paths.add(p);
        }
      }
    }
  }

  if (registry?.sensitive_domains) {
    for (const domain of Object.values(registry.sensitive_domains)) {
      for (const c of normalizeList(domain.contracts)) paths.add(c);
    }
  }

  if (policy?.protected_path_prefixes) {
    for (const p of policy.protected_path_prefixes) {
      if (!isGlobalProtected(p)) paths.add(p);
    }
  }
  if (policy?.protected_path_exact) {
    for (const p of policy.protected_path_exact) {
      if (!isGlobalProtected(p)) paths.add(p);
    }
  }

  return [...paths].sort();
}

function extractTier3Operations(policy, registry, sources) {
  const global = new Set(loadGlobalRules().tier_3_operations || []);
  const ops = new Set();

  for (const op of policy?.tier_3_operations || []) {
    if (!global.has(op)) ops.add(op);
  }
  for (const op of registry?.tier_3_operations || []) {
    if (!global.has(op)) ops.add(op);
  }

  const shellByOp = new Map((policy?.shell_rules || []).map((r) => [r.operation, r]));
  const mcpByOp = new Map();
  for (const r of policy?.mcp_rules || []) {
    mcpByOp.set(r.operation, r);
  }

  return [...ops].sort().map((id) => {
    const shell = shellByOp.get(id);
    const mcp = mcpByOp.get(id);
    return {
      id,
      description: shell ? `Shell/MCP gated: ${id}` : `Policy tier 3: ${id}`,
      approval_scope: id,
      tier: 3,
      shell_patterns: shell?.patterns || [],
      mcp_servers: mcp?.server_names || [],
      mcp_tools: mcp?.tool_names || [],
      source: policy ? '.cursor/policy/rules.json' : sources.registry,
    };
  });
}

function extractApprovalScopes(policy, registry, sources) {
  const scopes = [];
  const seen = new Set();

  for (const op of policy?.tier_3_operations || []) {
    if (!seen.has(op)) {
      scopes.push({ operation: op, scope: op, required: true, source: '.cursor/policy/rules.json' });
      seen.add(op);
    }
  }

  if (registry?.agents) {
    for (const [agentId, cfg] of Object.entries(registry.agents)) {
      for (const op of normalizeList(cfg.approval_required)) {
        if (!seen.has(op)) {
          scopes.push({ operation: op, scope: op, required: true, source: `${sources.registry} (${agentId})` });
          seen.add(op);
        }
      }
    }
  }

  return scopes;
}

function extractMcpIntegrations(projectDir, registry, sources) {
  const mcpJson = readJsonIfExists(projectDir, '.cursor/mcp.json');
  const cloudJson = readJsonIfExists(projectDir, '.cursor/cloud-agents-mcp.json');
  const servers = { ...(mcpJson?.mcpServers || {}), ...(cloudJson?.mcpServers || {}) };

  const usage = {};
  if (registry?.agents) {
    for (const [agentId, cfg] of Object.entries(registry.agents)) {
      for (const mcp of normalizeList(cfg.mcp)) {
        const key = mcp.replace(/^user-/, '').replace(/^plugin-[^-]+-/, '');
        if (!usage[key]) usage[key] = [];
        usage[key].push(agentId);
      }
    }
  }

  return Object.entries(servers).map(([id, cfg]) => {
    const safe = redactSecrets(cfg);
    return {
      id,
      purpose: usage[id] ? `Used by: ${usage[id].join(', ')}` : 'Configured in project MCP',
      enabled: true,
      type: safe.type || (safe.command ? 'stdio' : 'http'),
      agents: usage[id] || [],
      has_env_references: JSON.stringify(cfg).includes('${env:'),
      source: '.cursor/mcp.json',
    };
  });
}

function extractVerificationCommands(projectDir, registry, sources) {
  const commands = [];
  const seen = new Set();

  function add(name, command, scope, source) {
    const key = `${name}:${command}`;
    if (!command || seen.has(key)) return;
    seen.add(key);
    commands.push({ name, command, scope, source });
  }

  if (registry?.agents) {
    for (const [agentId, cfg] of Object.entries(registry.agents)) {
      for (const v of normalizeList(cfg.verification)) {
        if (v.includes('&&') || v.includes('cd ') || v.startsWith('npm ')) {
          add(`${agentId}-verification`, v, agentId, sources.registry);
        } else {
          add(`${agentId}-${v}`, v, agentId, sources.registry);
        }
      }
    }
  }

  const packages = ['backend', 'web', 'app', 'superadmin/web', 'mobile/gateway', 'admin-web', 'pdv', 'distributeur'];
  for (const pkg of packages) {
    const pkgJson = readJsonIfExists(projectDir, `${pkg}/package.json`);
    if (pkgJson?.scripts) {
      for (const [name, cmd] of Object.entries(pkgJson.scripts)) {
        if (['build', 'test', 'lint', 'check', 'analyze'].some((k) => name.includes(k))) {
          add(`${pkg}:${name}`, cmd, pkg, `${pkg}/package.json`);
        }
      }
    }
    if (fs.existsSync(path.join(projectDir, pkg, 'go.mod'))) {
      add(`${pkg}:go-build`, `cd ${pkg} && go build ./...`, pkg, `${pkg}/go.mod`);
      add(`${pkg}:go-test`, `cd ${pkg} && go test ./...`, pkg, `${pkg}/go.mod`);
    }
    if (fs.existsSync(path.join(projectDir, pkg, 'pubspec.yaml'))) {
      add(`${pkg}:flutter-analyze`, `cd ${pkg} && flutter analyze`, pkg, `${pkg}/pubspec.yaml`);
      add(`${pkg}:flutter-test`, `cd ${pkg} && flutter test`, pkg, `${pkg}/pubspec.yaml`);
    }
  }

  return commands;
}

function extractKnowledgePaths(projectDir) {
  const mapping = {
    agents: 'AGENTS.md',
    stack: 'docs/STACK.md',
    architecture: 'docs/architecture/',
    contracts: 'docs/contracts/',
    adr: 'docs/adr/',
    tasks: 'docs/project/tasks/',
    lessons: 'docs/runbooks/lessons/',
    specialists: 'docs/agents/SPECIALISTS.md',
    runtime_law: 'docs/agents/RUNTIME_LAW.md',
    playbooks: 'docs/agents/task-playbooks/',
  };
  const knowledge = {};
  for (const [key, rel] of Object.entries(mapping)) {
    if (fs.existsSync(path.join(projectDir, rel))) knowledge[key] = rel;
  }
  return knowledge;
}

function extractDeployment(projectDir) {
  const providers = new Set();
  const targets = [];

  if (fs.existsSync(path.join(projectDir, 'backend/fly.toml'))) {
    providers.add('fly.io');
    targets.push({ component: 'backend', provider: 'fly.io', config: 'backend/fly.toml' });
  }
  for (const rel of ['web/wrangler.toml', 'app/wrangler.toml', 'superadmin/web/wrangler.toml']) {
    if (fs.existsSync(path.join(projectDir, rel))) {
      providers.add('cloudflare-pages');
      targets.push({ component: path.dirname(rel), provider: 'cloudflare-pages', config: rel });
    }
  }
  if (fs.existsSync(path.join(projectDir, 'supabase/migrations'))) {
    providers.add('supabase');
    targets.push({ component: 'database', provider: 'supabase', config: 'supabase/migrations/' });
  }

  return {
    providers: [...providers],
    targets,
    source: 'repository deploy configs',
  };
}

function findContradictions(registry, mapping, agentFiles) {
  const contradictions = [];

  if (registry?.agents && mapping?.specialists) {
    for (const [id, mapCfg] of Object.entries(mapping.specialists)) {
      const regCfg = registry.agents[id];
      if (!regCfg) {
        contradictions.push({
          type: 'missing_registry_agent',
          message: `specialist-mapping defines ${id} but registry.yaml does not`,
          source: 'docs/agents/design/specialist-mapping.yaml',
        });
        continue;
      }
      const mapCaps = new Set(normalizeList(mapCfg.capabilities));
      const regCaps = new Set(normalizeList(regCfg.capabilities));
      for (const c of mapCaps) {
        if (!regCaps.has(c)) {
          contradictions.push({
            type: 'capability_mismatch',
            message: `Capability ${c} in specialist-mapping for ${id} missing from registry.yaml`,
            sources: ['specialist-mapping.yaml', 'registry.yaml'],
          });
        }
      }
    }
  }

  for (const id of Object.keys(registry?.agents || {})) {
    if (id === 'orchestrator') continue;
    if (!agentFiles.includes(id)) {
      contradictions.push({
        type: 'missing_agent_file',
        message: `registry references ${id} but .cursor/agents/${id}.md not found`,
        source: '.cursor/agents/registry.yaml',
      });
    }
  }

  return contradictions;
}

export function validateAdapter(adapter, projectDir) {
  const issues = [];

  for (const cap of adapter.capabilities || []) {
    if (!cap.agent) issues.push(`capability ${cap.id} missing agent`);
    if (cap.agent && !fs.existsSync(path.join(projectDir, '.cursor/agents', `${cap.agent}.md`))) {
      if (!['orchestrator'].includes(cap.agent) && cap.source_type === 'project_registry') {
        issues.push(`capability ${cap.id} references missing agent ${cap.agent}`);
      }
    }
  }

  for (const op of adapter.policy?.tier3_operations || []) {
    if (!op.id) issues.push('tier3 operation missing id');
  }

  for (const mcp of adapter.integrations?.mcp || []) {
    const serialized = JSON.stringify(mcp);
    if (/\bBearer\s+[A-Za-z0-9._-]{8,}\b/.test(serialized)) {
      issues.push(`MCP ${mcp.id} contains inline bearer token in adapter output`);
    }
    if (serialized.includes('[REDACTED]') === false && /"api[_-]?key"\s*:\s*"(?!\\$\{env:)/i.test(serialized)) {
      issues.push(`MCP ${mcp.id} may expose secret values in adapter`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function extractProjectAdapter(projectDir) {
  const root = path.resolve(projectDir);
  const sources = {};

  const registryLoad = loadRegistry(root);
  const mappingLoad = loadSpecialistMapping(root);
  const policy = loadProjectPolicy(root);
  const agentFiles = listAgentMdFiles(root);
  const multi = extractAllFormats(root);

  if (registryLoad.source) sources.registry = registryLoad.source;
  if (mappingLoad.source) sources.specialist_mapping = mappingLoad.source;
  if (policy) sources.policy = '.cursor/policy/rules.json';
  if (multi.sources.specialists) sources.specialists = multi.sources.specialists;
  if (multi.sources.playbooks) sources.playbooks = multi.sources.playbooks;
  if (multi.sources.ownership) sources.ownership_doc = multi.sources.ownership;

  const registry = registryLoad.data;
  const registryCapabilities = extractCapabilities(registry, sources).map((c) =>
    normalizeCapability({ ...c, source_type: 'project_registry', confidence: 0.95, inferred: false })
  );
  const registryAgents = Object.entries(extractAgents(registry, agentFiles, sources)).map(([id, cfg]) =>
    normalizeAgent({ id, ...cfg, source_type: 'project_registry', confidence: 0.95, inferred: false })
  );

  const multiCaps = multi.capability_sources.flatMap((s) => s.capabilities || []);
  const multiAgents = multi.agent_sources.flatMap((s) => s.agents || []);

  const resolved = resolveEvidenceSets({
    capabilities: [registryCapabilities, multiCaps],
    agents: [registryAgents, multiAgents],
    ownership: [...extractOwnership(registry, sources), ...multi.ownership_sources],
    verification: [...extractVerificationCommands(root, registry, sources), ...multi.verification],
  });

  const knowledge = extractKnowledgePaths(root);
  const deployment = extractDeployment(root);

  const adapter = {
    capabilities: resolved.capabilities,
    agents: Object.fromEntries(resolved.agents.map((a) => [a.id, a])),
    ownership: resolved.ownership,
    knowledge,
    deployment,
    policy: {
      protected_paths: extractProjectProtectedPaths(registry, policy),
      tier3_operations: extractTier3Operations(policy, registry, sources),
      shell_rules: (policy?.shell_rules || []).map((r) => ({
        operation: r.operation,
        tier: r.tier,
        patterns: r.patterns || [],
        source: '.cursor/policy/rules.json',
      })),
      mcp_rules: (policy?.mcp_rules || []).map((r) => ({
        operation: r.operation,
        server_names: r.server_names,
        tool_names: r.tool_names,
        source: '.cursor/policy/rules.json',
      })),
    },
    approval: {
      scopes: extractApprovalScopes(policy, registry, sources),
    },
    integrations: {
      mcp: extractMcpIntegrations(root, registry, sources),
    },
    verification: {
      commands: resolved.verification,
    },
    sources,
    contradictions: [...findContradictions(registry, mappingLoad.data, agentFiles), ...resolved.contradictions],
    intelligence: {
      multi_format_sources: multi.sources,
      confidence: {
        capabilities: averageConfidence(resolved.capabilities),
        agents: averageConfidence(resolved.agents),
      },
    },
  };

  const validation = validateAdapter(adapter, root);
  return { adapter, validation };
}

function averageConfidence(items) {
  if (!items?.length) return 0;
  return items.reduce((a, i) => a + (i.confidence || 0), 0) / items.length;
}

export function adapterToYaml(adapter, profileMeta = {}) {
  const lines = [];
  const emit = (s) => lines.push(s);

  emit('schema_version: 1');
  emit('');
  emit('agent_os:');
  emit('  version: ">=1.0 <2.0"');
  emit('');
  emit('project:');
  emit(`  id: ${profileMeta.id || 'project'}`);
  emit(`  name: ${profileMeta.name || 'project'}`);
  emit('  type: application');
  if (profileMeta.task_id_prefix) emit(`  task_id_prefix: ${profileMeta.task_id_prefix}`);
  emit('');

  if (profileMeta.stack) {
    emit('stack:');
    const detected = Object.entries(profileMeta.stack.repository || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    emit(`  detected: [${detected.join(', ')}]`);
    emit('  components:');
    for (const [comp, flags] of Object.entries(profileMeta.stack.components || {})) {
      const techs = Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => k);
      emit(`    ${comp}: [${techs.join(', ')}]`);
    }
    emit('');
  }

  emit('paths:');
  emit('  docs: docs/');
  emit('  tasks: docs/project/tasks/');
  emit('');

  emit('knowledge:');
  for (const [k, v] of Object.entries(adapter.knowledge || {})) {
    emit(`  ${k}: ${v}`);
  }
  emit('');

  emit('capabilities:');
  for (const cap of adapter.capabilities || []) {
    emit(`  - id: ${cap.id}`);
    if (cap.description) emit(`    description: ${cap.description}`);
    if (cap.domains?.length) emit(`    domains: [${cap.domains.join(', ')}]`);
    if (cap.paths?.length) emit(`    paths: [${cap.paths.map((p) => `"${p}"`).join(', ')}]`);
    emit(`    agent: ${cap.agent}`);
    if (cap.verification?.length) emit(`    verification: [${cap.verification.join(', ')}]`);
    if (cap.playbook) emit(`    playbook: ${cap.playbook}`);
    emit(`    source: ${cap.source}`);
  }
  if (!adapter.capabilities?.length) emit('  []');
  emit('');

  emit('agents:');
  for (const [id, cfg] of Object.entries(adapter.agents || {})) {
    emit(`  ${id}:`);
    emit(`    file: ${cfg.file}`);
    if (cfg.tool_profile) emit(`    tool_profile: ${cfg.tool_profile}`);
    if (cfg.approval_tier_max != null) emit(`    approval_tier_max: ${cfg.approval_tier_max}`);
    if (cfg.capabilities?.length) emit(`    capabilities: [${cfg.capabilities.join(', ')}]`);
    if (cfg.domains?.length) emit(`    domains: [${cfg.domains.join(', ')}]`);
    if (cfg.paths_owned?.length) {
      emit('    paths_owned:');
      for (const p of cfg.paths_owned) emit(`      - ${p}`);
    }
    if (cfg.paths_writable?.length) {
      emit('    paths_writable:');
      for (const p of cfg.paths_writable) emit(`      - ${p}`);
    }
    if (cfg.paths_readable?.length) {
      emit('    paths_readable:');
      for (const p of cfg.paths_readable) emit(`      - ${p}`);
    }
    if (cfg.paths_forbidden?.length) {
      emit('    paths_forbidden:');
      for (const p of cfg.paths_forbidden) emit(`      - ${p}`);
    }
    if (cfg.handoff_only_writes) emit(`    handoff_only_writes: true`);
    if (cfg.mcp?.length) emit(`    mcp: [${cfg.mcp.join(', ')}]`);
    emit(`    source: ${cfg.source}`);
  }
  emit('');

  emit('ownership:');
  for (const o of adapter.ownership || []) {
    emit(`  - agent: ${o.agent}`);
    if (o.paths?.length) emit(`    paths: [${o.paths.map((p) => `"${p}"`).join(', ')}]`);
    if (o.writable?.length) emit(`    writable: [${o.writable.map((p) => `"${p}"`).join(', ')}]`);
    if (o.forbidden?.length) emit(`    forbidden: [${o.forbidden.map((p) => `"${p}"`).join(', ')}]`);
    emit(`    source: ${o.source}`);
  }
  if (!adapter.ownership?.length) emit('  []');
  emit('');

  emit('policy:');
  if (!adapter.policy?.protected_paths?.length) emit('  protected_paths: []');
  else {
    emit('  protected_paths:');
    for (const p of adapter.policy?.protected_paths || []) emit(`    - ${p}`);
  }
  if (!adapter.policy?.tier3_operations?.length) emit('  tier3_operations: []');
  else {
    emit('  tier3_operations:');
    for (const op of adapter.policy?.tier3_operations || []) {
      emit(`    - id: ${op.id}`);
      emit(`      description: ${op.description}`);
      emit(`      approval_scope: ${op.approval_scope}`);
      emit(`      source: ${op.source}`);
    }
  }
  if (adapter.policy?.shell_rules?.length) {
    emit('  shell_rules:');
    for (const r of adapter.policy.shell_rules) {
      emit(`    - operation: ${r.operation}`);
      emit(`      tier: ${r.tier}`);
      if (r.patterns?.length) {
        emit('      patterns:');
        for (const p of r.patterns) emit(`        - "${p.replace(/"/g, '\\"')}"`);
      }
      if (r.source) emit(`      source: ${r.source}`);
    }
  }
  if (adapter.policy?.mcp_rules?.length) {
    emit('  mcp_rules:');
    for (const r of adapter.policy.mcp_rules) {
      emit(`    - operation: ${r.operation}`);
      if (r.server_names?.length) emit(`      server_names: [${r.server_names.join(', ')}]`);
      if (r.tool_names?.length) emit(`      tool_names: [${r.tool_names.join(', ')}]`);
      if (r.source) emit(`      source: ${r.source}`);
    }
  }
  emit('');

  if (adapter.approval?.scopes?.length) {
    emit('approval:');
    emit('  scopes:');
    for (const s of adapter.approval.scopes) {
      emit(`    - operation: ${s.operation}`);
      emit(`      scope: ${s.scope}`);
      emit(`      required: ${s.required}`);
    }
    emit('');
  }

  emit('integrations:');
  emit('  mcp:');
  for (const m of adapter.integrations?.mcp || []) {
    emit(`    - id: ${m.id}`);
    emit(`      purpose: ${m.purpose}`);
    emit(`      enabled: ${m.enabled}`);
    emit(`      type: ${m.type}`);
    if (m.agents?.length) emit(`      agents: [${m.agents.join(', ')}]`);
    emit(`      source: ${m.source}`);
  }
  if (!adapter.integrations?.mcp?.length) emit('    []');
  emit('');

  if (adapter.deployment?.providers?.length) {
    emit('deployment:');
    emit(`  providers: [${adapter.deployment.providers.join(', ')}]`);
    emit('  targets:');
    for (const t of adapter.deployment.targets) {
      emit(`    - component: ${t.component}`);
      emit(`      provider: ${t.provider}`);
      emit(`      config: ${t.config}`);
    }
    emit('');
  }

  emit('verification:');
  emit('  commands:');
  for (const c of adapter.verification?.commands || []) {
    emit(`    - name: ${c.name}`);
    emit(`      command: "${c.command.replace(/"/g, '\\"')}"`);
    emit(`      scope: ${c.scope}`);
    emit(`      source: ${c.source}`);
  }
  if (!adapter.verification?.commands?.length) emit('    []');

  return lines.join('\n') + '\n';
}

export function summarizeAdapter(adapter) {
  return {
    capability_count: adapter.capabilities?.length || 0,
    agent_count: Object.keys(adapter.agents || {}).length,
    ownership_count: adapter.ownership?.length || 0,
    protected_path_count: adapter.policy?.protected_paths?.length || 0,
    tier3_operation_count: adapter.policy?.tier3_operations?.length || 0,
    mcp_count: adapter.integrations?.mcp?.length || 0,
    verification_command_count: adapter.verification?.commands?.length || 0,
    deployment_providers: adapter.deployment?.providers || [],
    contradiction_count: adapter.contradictions?.length || 0,
  };
}
