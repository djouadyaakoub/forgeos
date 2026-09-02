/**
 * Capability normalization — multi-format sources → canonical capability
 */
import { confidenceFromSource } from './intelligence-model.mjs';

export function normalizeCapability(raw = {}) {
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const sourceType = raw.source_type || inferSourceType(raw.source);
  const conf = confidenceFromSource(sourceType, raw.explicit);
  const score = raw.confidence ?? conf.score;

  return {
    id,
    description: raw.description || id.replace(/-/g, ' '),
    source: raw.source || 'unknown',
    source_type: sourceType,
    confidence: score,
    confidence_level: raw.confidence_level || conf.level,
    inferred: raw.inferred ?? score < 0.9,
    domains: [...(raw.domains || [])],
    paths: [...(raw.paths || [])],
    operations: [...(raw.operations || [])],
    verification: [...(raw.verification || [])],
    agent: raw.agent || null,
    playbook: raw.playbook || null,
    evidence: [...(raw.evidence || [])],
  };
}

function inferSourceType(source) {
  const s = String(source || '');
  if (s.includes('registry.yaml')) return 'project_registry';
  if (s.includes('SPECIALISTS.md')) return 'agents_md';
  if (s.includes('task-playbooks')) return 'playbook';
  if (s.includes('ownership')) return 'ownership_doc';
  if (s.includes('AGENTS.md')) return 'agents_md';
  if (s.includes('workflows')) return 'ci_config';
  if (s.includes('package.json')) return 'package_manifest';
  return 'source_heuristic';
}

export function normalizeAgent(raw = {}) {
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const sourceType = raw.source_type || 'agent_definition';
  const conf = confidenceFromSource(sourceType, raw.explicit);

  return {
    id,
    source_type: raw.source_type || mapAgentSourceType(raw.source),
    source: raw.source || 'unknown',
    capabilities: [...(raw.capabilities || [])],
    ownership: raw.ownership || {},
    confidence: raw.confidence ?? conf.score,
    confidence_level: raw.confidence_level || conf.level,
    inferred: raw.inferred ?? conf.level !== 'VERIFIED',
    evidence: [...(raw.evidence || [])],
    file: raw.file || null,
    playbook: raw.playbook || null,
    exists: raw.exists ?? false,
  };
}

function mapAgentSourceType(source) {
  const s = String(source || '');
  if (s.includes('registry')) return 'project_registry';
  if (s.includes('.cursor/agents')) return 'markdown';
  if (s.includes('playbook')) return 'playbook';
  if (s.includes('SPECIALISTS') || s.includes('AGENTS.md')) return 'documentation';
  return 'documentation';
}

export function normalizeOwnership(raw = {}) {
  const pathVal = raw.path || raw.paths?.[0];
  if (!pathVal && !raw.agent) return null;

  const sourceType = raw.source_type || 'ownership_doc';
  const conf = confidenceFromSource(sourceType);

  return {
    path: pathVal || '',
    paths: [...(raw.paths || (pathVal ? [pathVal] : []))],
    agent: raw.agent || null,
    confidence: raw.confidence ?? conf.score,
    confidence_level: raw.confidence_level || conf.level,
    source: raw.source || 'unknown',
    source_type: sourceType,
    inferred: raw.inferred ?? conf.level !== 'VERIFIED',
    evidence: [...(raw.evidence || [])],
  };
}

export function normalizeVerification(raw = {}) {
  const command = raw.command || raw.name;
  if (!command) return null;

  const sourceType = raw.source_type || 'package_manifest';
  const conf = confidenceFromSource(sourceType);

  return {
    command: String(command),
    name: raw.name || command,
    source: raw.source || 'unknown',
    source_type: sourceType,
    component: raw.component || raw.scope || null,
    scope: raw.scope || raw.component || null,
    confidence: raw.confidence ?? conf.score,
    confidence_level: raw.confidence_level || conf.level,
    inferred: raw.inferred ?? false,
    evidence: [...(raw.evidence || [])],
  };
}

export function dedupeById(items, idKey = 'id') {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item[idKey];
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (item.confidence || 0) > (existing.confidence || 0)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}
