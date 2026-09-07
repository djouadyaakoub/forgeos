/**
 * Permanent agent freeze — Stage 17
 *
 * Capabilities are the architectural unit.
 * Do NOT add new permanent Markdown specialist agents.
 * Existing agents under agents/*.md are legacy/host-facing prompts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOBAL_PERMANENT_AGENT_IDS } from '../../policy/ephemeral-factory.mjs';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');

/** Frozen set of permanent specialist Markdown agent stems (Stage 17). */
export const FROZEN_PERMANENT_AGENT_MD = Object.freeze([
  'orchestrator',
  'architect',
  'qa-bugfix',
  'docs-sync',
  'security',
  'codebase-organization',
  'solution-research',
  'project-archaeology',
  'release-readiness',
  'release-deployment',
  'environment-config',
]);

export function listPermanentAgentMarkdownFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

/**
 * Detect accidental growth of permanent Markdown agents.
 */
export function assertPermanentAgentFreeze() {
  const onDisk = listPermanentAgentMarkdownFiles();
  const unexpected = onDisk.filter((id) => !FROZEN_PERMANENT_AGENT_MD.includes(id));
  const missing = FROZEN_PERMANENT_AGENT_MD.filter((id) => !onDisk.includes(id));
  const registryMismatch = GLOBAL_PERMANENT_AGENT_IDS.filter(
    (id) => !FROZEN_PERMANENT_AGENT_MD.includes(id)
  );

  return {
    ok: unexpected.length === 0 && registryMismatch.length === 0,
    frozen_count: FROZEN_PERMANENT_AGENT_MD.length,
    on_disk_count: onDisk.length,
    unexpected,
    missing,
    registry_mismatch: registryMismatch,
    note: 'Capabilities are SoT — do not add permanent Markdown agents',
  };
}

export function permanentAgentGrowthForbidden() {
  return true;
}
