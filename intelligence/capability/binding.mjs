/**
 * Capability binding loader — Stage 8
 *
 * Extends agents/registry.yaml into a stable capability abstraction.
 * Does not invent a second capability registry.
 */
import fs from 'node:fs';
import { completionSemantics } from './completion.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanonicalVersion } from '../../policy/version.mjs';
import {
  IMPLEMENTATION_TYPES,
  isValidImplementationType,
} from './implementation-kinds.mjs';

export {
  IMPLEMENTATION_TYPES,
  IMPLEMENTATION_KINDS,
  canonicalizeImplementationType,
  implementationTypeToKind,
  launchesExternalRuntime,
  isValidImplementationType,
  LEGACY_OPTIONAL_RUNTIME_ALIAS,
  IMPLEMENTATION_PREFERENCE_ORDER,
} from './implementation-kinds.mjs';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export const CAPABILITY_STATES = Object.freeze([
  'SATISFIED',
  'PARTIAL',
  'NEEDS_IMPROVEMENT',
  'NOT_CONFIGURED',
  'NOT_APPLICABLE',
  'UNKNOWN',
]);

export const APPLICABILITY_STATES = Object.freeze([
  'APPLICABLE',
  'NOT_APPLICABLE',
  'UNKNOWN',
]);

const BINDING_DEFAULTS = Object.freeze({
  canvas_category: 'uncategorized',
  applicability: 'when_initialized',
  assessment_module: 'forgeos.assessment.generic',
  evidence_schema: 'capability-assessment',
  verification_strategy: 'none',
  implementation_types: ['forgeos_native', 'host_native'],
  preferred_implementation: 'forgeos_native',
  default_severity: 'medium',
  freshness_ttl: 86400,
});

function asList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

function parseScalar(value) {
  let parsed = String(value).trim().replace(/^["']|["']$/g, '');
  if (parsed === 'true') return true;
  if (parsed === 'false') return false;
  if (/^\d+$/.test(parsed)) return Number(parsed);
  if (parsed.startsWith('[') && parsed.endsWith(']')) {
    const inner = parsed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((p) => p.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return parsed;
}

/**
 * Parse capability list items as objects (existing parseSimpleYaml cannot).
 */
export function parseCapabilityRegistryYaml(content) {
  const capabilities = [];
  let current = null;
  let inCapabilities = false;

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (/^capabilities:\s*$/.test(line)) {
      inCapabilities = true;
      continue;
    }
    if (inCapabilities && /^\S/.test(line) && !line.startsWith(' ')) {
      inCapabilities = false;
      if (current) capabilities.push(current);
      current = null;
      continue;
    }
    if (!inCapabilities) continue;

    const item = line.match(/^\s+-\s+id:\s+(\S+)\s*$/);
    if (item) {
      if (current) capabilities.push(current);
      current = { id: item[1].replace(/^["']|["']$/g, '') };
      continue;
    }
    const kv = line.match(/^\s{4,}([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (kv && current) {
      current[kv[1]] = parseScalar(kv[2]);
    }
  }
  if (current) capabilities.push(current);
  return { capabilities };
}

export function normalizeCapabilityBinding(raw = {}) {
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const implementationTypes = asList(raw.implementation_types).length
    ? asList(raw.implementation_types)
    : [...BINDING_DEFAULTS.implementation_types];

  const preferred = String(
    raw.preferred_implementation || BINDING_DEFAULTS.preferred_implementation
  );
  const preferredValid = IMPLEMENTATION_TYPES.includes(preferred)
    ? preferred
    : BINDING_DEFAULTS.preferred_implementation;

  return {
    id,
    description: raw.description || id,
    domains: asList(raw.domains),
    specialist_ids: asList(raw.specialist_ids),
    tool_profile: raw.tool_profile || 'read-explore',
    approval_tier_max: Number(raw.approval_tier_max ?? 1),
    permanent: raw.permanent !== false,
    paths_writable: asList(raw.paths_writable),
    canvas_category: raw.canvas_category || BINDING_DEFAULTS.canvas_category,
    applicability: raw.applicability || BINDING_DEFAULTS.applicability,
    assessment_module: raw.assessment_module || BINDING_DEFAULTS.assessment_module,
    evidence_schema: raw.evidence_schema || BINDING_DEFAULTS.evidence_schema,
    verification_strategy: raw.verification_strategy || BINDING_DEFAULTS.verification_strategy,
    completion_strategy: raw.completion_strategy || raw.verification_strategy || BINDING_DEFAULTS.verification_strategy,
    acceptance_semantics: completionSemantics(raw.id),
    implementation_types: implementationTypes.filter((t) => IMPLEMENTATION_TYPES.includes(t)),
    preferred_implementation: preferredValid,
    default_severity: raw.default_severity || BINDING_DEFAULTS.default_severity,
    freshness_ttl: Number(raw.freshness_ttl ?? BINDING_DEFAULTS.freshness_ttl),
    requires: asList(raw.requires),
    source: raw.source || 'global',
    oss_derived_id: raw.oss_derived_id ? String(raw.oss_derived_id) : null,
    oss_derived_execution_mode: raw.oss_derived_execution_mode
      ? String(raw.oss_derived_execution_mode)
      : null,
  };
}

export function loadCapabilityBindings(options = {}) {
  const registryPath = options.registry_path
    || path.join(REPO_ROOT, 'agents', 'registry.yaml');
  if (!fs.existsSync(registryPath)) {
    return { capabilities: [], forgeos_version: getCanonicalVersion(), source: null };
  }
  const parsed = parseCapabilityRegistryYaml(fs.readFileSync(registryPath, 'utf8'));
  const capabilities = parsed.capabilities
    .map((c) => normalizeCapabilityBinding({ ...c, source: 'global' }))
    .filter(Boolean);
  return {
    capabilities,
    forgeos_version: getCanonicalVersion(),
    source: registryPath.replace(/\\/g, '/'),
    binding_count: capabilities.length,
  };
}

export function getCapabilityBinding(capabilityId, bindings = null) {
  const set = bindings || loadCapabilityBindings();
  return set.capabilities.find((c) => c.id === capabilityId) || null;
}

export function capabilityBindingFingerprint(bindings) {
  const ids = (bindings?.capabilities || [])
    .map((c) => [
      c.id,
      c.assessment_module,
      c.verification_strategy,
      c.applicability,
      c.preferred_implementation,
      (c.requires || []).slice().sort().join(','),
    ].join(':'))
    .sort();
  return ids.join('|');
}
