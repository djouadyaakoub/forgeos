/**
 * Installed projects registry — metadata only
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkCompatibility } from '../compatibility/adapter.mjs';
import { loadProjectManifest } from '../../policy/project-adapter.mjs';
import { classifyProjectCompatibility } from '../update/planner.mjs';

export function getRegistryPath() {
  return path.join(os.homedir(), '.cursor', 'agent-os', 'projects.yaml');
}

function parseSimpleRegistry(content) {
  const projects = [];
  const lines = String(content).split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const item = line.match(/^\s*-\s+path:\s*"?([^"]+)"?/);
    if (item) {
      if (current) projects.push(current);
      current = { path: item[1] };
      continue;
    }
    const kv = line.match(/^\s+(\w+):\s*"?([^"]+)"?/);
    if (kv && current) current[kv[1]] = kv[2];
  }
  if (current) projects.push(current);
  return { projects };
}

export function readRegistry(registryPath = getRegistryPath()) {
  if (!fs.existsSync(registryPath)) return { projects: [] };
  try {
    return parseSimpleRegistry(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return { projects: [] };
  }
}

function writeRegistry(projects, registryPath = getRegistryPath()) {
  const lines = ['projects:'];
  for (const p of projects) {
    lines.push(`  - path: "${p.path}"`);
    if (p.project_id) lines.push(`    project_id: ${p.project_id}`);
    lines.push(`    adapter_schema_version: ${p.adapter_schema_version ?? p.adapter_version ?? 1}`);
    lines.push(`    universal_os_version: "${p.universal_os_version ?? p.agent_os_version ?? '1.0.0'}"`);
    lines.push(`    status: ${p.status}`);
    if (p.updated_at) lines.push(`    updated_at: ${p.updated_at}`);
  }
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${lines.join('\n')}\n`, 'utf8');
}

export function registerProject(projectPath, registryPath = getRegistryPath()) {
  const resolved = path.resolve(projectPath).replace(/\\/g, '/');
  const reg = readRegistry(registryPath);
  const compat = checkCompatibility(resolved);
  const { data: manifest } = loadProjectManifest(resolved);
  const record = {
    path: resolved,
    project_id: manifest?.project?.id || path.basename(resolved),
    adapter_schema_version: manifest?.agent_os?.adapter_schema_version ?? manifest?.schema_version ?? 1,
    universal_os_version: compat.installed_agent_os_version ?? '1.0.0',
    status: compat.compatible ? 'compatible' : 'incompatible',
    updated_at: new Date().toISOString(),
  };
  const idx = reg.projects.findIndex((p) => path.resolve(p.path) === path.resolve(resolved));
  if (idx >= 0) reg.projects[idx] = { ...reg.projects[idx], ...record };
  else reg.projects.push(record);
  writeRegistry(reg.projects, registryPath);
  return record;
}

export function unregisterProject(projectPath, registryPath = getRegistryPath()) {
  const resolved = path.resolve(projectPath);
  const reg = readRegistry(registryPath);
  reg.projects = reg.projects.filter((p) => path.resolve(p.path) !== resolved);
  writeRegistry(reg.projects, registryPath);
  return { removed: true, path: resolved };
}

export function discoverInstalledProjects(registryPath = getRegistryPath()) {
  const reg = readRegistry(registryPath);
  return reg.projects.map((p) => ({
    ...p,
    path: path.resolve(p.path).replace(/\\/g, '/'),
  }));
}

export function writeRegistryEntry(entry, registryPath = getRegistryPath()) {
  return registerProject(entry.path, registryPath);
}

export function listAffectedProjects(registryPath = getRegistryPath()) {
  const reg = readRegistry(registryPath);
  return reg.projects.map((p) => {
    const compat = checkCompatibility(p.path);
    return {
      ...p,
      current_status: compat.compatible
        ? compat.migration_required ? 'migration_available' : 'compatible'
        : 'incompatible',
      migration_required: compat.migration_required,
    };
  });
}

export function getProjectDashboard(options = {}) {
  const projects = discoverInstalledProjects(options.registry_path);
  return projects.map((p) => {
    const { compatibility } = options.target_version
      ? classifyProjectCompatibility(p.path, {
        from_version: options.from_version || p.universal_os_version,
        to_version: options.target_version,
      })
      : { compatibility: { status: (p.status || 'unknown').toUpperCase(), migrations: [] } };
    return {
      project: {
        id: p.project_id,
        path: p.path,
        installed_os: p.universal_os_version,
        adapter_schema: p.adapter_schema_version,
        compatibility: compatibility.status,
        update_status: compatibility.status,
        migration_required: (compatibility.migrations || []).length > 0,
      },
    };
  });
}
