/** Non-destructive same-project preparation. Never installs vendor tools or hooks. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectHost } from './discovery.mjs';
import { readHostConfiguration } from './configuration.mjs';
import { projectRoot, projectPath, readProjectText, writeProjectText } from './project-files.mjs';

export const CLAUDE_FACADE = '@AGENTS.md\n';
const TEMPLATE = fileURLToPath(new URL('../templates/AGENTS.md', import.meta.url));

export function instructionStatus(dir, hostId) {
  try {
    const canonical = readProjectText(dir, 'AGENTS.md');
    const facade = readProjectText(dir, 'CLAUDE.md');
    const override = readProjectText(dir, 'AGENTS.override.md');
    const ready = !!canonical?.trim() && (hostId !== 'claude-code' || facade?.trim() === CLAUDE_FACADE.trim());
    return { ok: true, canonical: 'AGENTS.md', canonical_present: !!canonical?.trim(),
      facade: hostId === 'claude-code' ? 'CLAUDE.md' : null,
      ready, warnings: [
        ...(override !== null ? ['project_instruction_override_present'] : []),
        ...(facade !== null && facade.trim() !== CLAUDE_FACADE.trim() ? ['custom_claude_instructions_preserved'] : []),
      ] };
  } catch (e) { return { ok: false, ready: false, reason: e.message }; }
}

export function prepareHostProject(options = {}) {
  try {
    const root = projectRoot(options.project_dir || process.cwd());
    const selection = selectHost({ ...options, project_dir: root });
    if (!selection.ok || !selection.supported) return { ok: false, reason: selection.reason || 'unsupported_host' };
    const config = readHostConfiguration(root);
    const actions = [];
    if (!config.source) {
      const id = path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'project';
      actions.push({ path: '.agent-os/project.yaml', content: `contract:\n  version: 1\nproject:\n  id: ${id}\n  name: ${id}\n  type: application\ncapabilities: []\nagents: {}\nownership: []\nverification:\n  commands: []\nhost:\n  preferred: ${selection.host_id}\n` });
    }
    const canonical = readProjectText(root, 'AGENTS.md');
    if (canonical === null) actions.push({ path: 'AGENTS.md', content: fs.readFileSync(TEMPLATE, 'utf8') });
    else if (!canonical.trim()) return { ok: false, reason: 'empty_canonical_instructions' };
    if (selection.host_id === 'claude-code') {
      const facade = readProjectText(root, 'CLAUDE.md');
      if (facade === null) actions.push({ path: 'CLAUDE.md', content: CLAUDE_FACADE });
      else if (facade.trim() !== CLAUDE_FACADE.trim()) return { ok: false, reason: 'instruction_facade_conflict', note: 'Existing CLAUDE.md preserved; reconcile manually with AGENTS.md.' };
    }
    for (const action of actions) projectPath(root, action.path); // preflight before any write
    const created = [];
    if (options.apply === true) {
      for (const action of actions) created.push(writeProjectText(root, action.path, action.content, { createOnly: true }));
    }
    return { ok: true, host_id: selection.host_id, project_dir: root.replace(/\\/g, '/'),
      apply: options.apply === true, actions: actions.map(a => ({ path: a.path, action: 'create' })), created,
      existing_files: 'preserved', installs_vendor: false, launches_external_runtime: false, requires_docker: false,
      note: 'Preparation is not Policy approval or proof of a live host session.' };
  } catch (e) { return { ok: false, reason: e.message }; }
}
