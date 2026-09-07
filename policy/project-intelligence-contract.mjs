/**
 * ForgeOS — Project Intelligence Contract (Architecture 2.0 Stage 1)
 *
 * Canonical in-memory representation of what ForgeOS knows about a project.
 * Persisted source of truth remains: .agent-os/project.yaml
 *
 * Authority classes (not all equally trustworthy):
 *   DECLARED      — explicit project YAML / human-authored
 *   DISCOVERED    — filesystem/stack evidence (candidate until declared)
 *   INFERRED      — heuristic enrichment
 *   APPROVED      — requires task/human approval to act on
 *   AUTHORITATIVE — binding for policy / ownership / protected paths
 */
import { CURRENT_ADAPTER_SCHEMA } from './version.mjs';

/** Project Intelligence Contract version (persisted as contract.version). */
export const CURRENT_CONTRACT_VERSION = 1;

/** Oldest contract version this loader will normalize without migration tooling. */
export const MIN_SUPPORTED_CONTRACT_VERSION = 1;

/** Newest contract version this loader understands. */
export const MAX_SUPPORTED_CONTRACT_VERSION = 1;

/**
 * Field → authority class for documentation and future consumers.
 * Maps top-level (and selected nested) contract fields.
 */
export const FIELD_AUTHORITY = Object.freeze({
  'contract.version': 'AUTHORITATIVE',
  'schema_version': 'AUTHORITATIVE',
  'project.id': 'AUTHORITATIVE',
  'project.name': 'DECLARED',
  'project.type': 'DECLARED',
  'project.task_id_prefix': 'AUTHORITATIVE',
  'stack': 'DISCOVERED',
  'stack.detected': 'DISCOVERED',
  'stack.components': 'DISCOVERED',
  'paths': 'DECLARED',
  'knowledge': 'DECLARED',
  'capabilities': 'DECLARED',
  'agents': 'AUTHORITATIVE',
  'ownership': 'AUTHORITATIVE',
  'policy.protected_paths': 'AUTHORITATIVE',
  'policy.tier3_operations': 'AUTHORITATIVE',
  'policy.shell_rules': 'AUTHORITATIVE',
  'policy.mcp_rules': 'AUTHORITATIVE',
  'verification.commands': 'DECLARED',
  'deployment': 'DECLARED',
  'integrations.mcp': 'DECLARED',
  'runtime.requirements': 'DECLARED',
  'forgeos.version': 'AUTHORITATIVE',
  'forgeos.adapter_schema_version': 'AUTHORITATIVE',
  'compatibility': 'INFERRED',
});

/**
 * Default runtime requirement keys (constraints only — never select a backend).
 * Future Runtime Router consumes these; Stage 1 only defines the shape.
 */
export const RUNTIME_REQUIREMENT_KEYS = Object.freeze([
  'interactive',
  'autonomous',
  'sandbox',
  'parallel',
  'network',
  'filesystem',
]);

export function resolveContractVersion(raw = {}) {
  const fromContract = raw?.contract?.version;
  if (fromContract != null && fromContract !== '') {
    const n = Number(fromContract);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid contract.version: ${fromContract}`);
    }
    return n;
  }
  const fromSchema = raw?.schema_version;
  if (fromSchema != null && fromSchema !== '') {
    const n = Number(fromSchema);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid schema_version: ${fromSchema}`);
    }
    return n;
  }
  // Legacy manifests without either field — treat as contract v1 if project block exists
  if (raw?.project && typeof raw.project === 'object') return 1;
  return CURRENT_CONTRACT_VERSION;
}

export function assertSupportedContractVersion(version) {
  if (version < MIN_SUPPORTED_CONTRACT_VERSION || version > MAX_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported Project Intelligence Contract version ${version} ` +
        `(supported ${MIN_SUPPORTED_CONTRACT_VERSION}..${MAX_SUPPORTED_CONTRACT_VERSION})`,
    );
  }
  return version;
}

function emptyRuntimeRequirements() {
  return {};
}

/**
 * Normalize optional runtime.requirements mapping.
 * Values may be boolean or omitted; unknown keys are preserved (forward-compatible).
 */
export function normalizeRuntimeRequirements(runtime) {
  if (runtime == null) {
    return { requirements: emptyRuntimeRequirements() };
  }
  if (typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error('Invalid field runtime: expected mapping object');
  }
  const req = runtime.requirements;
  if (req == null) return { ...runtime, requirements: emptyRuntimeRequirements() };
  if (typeof req !== 'object' || Array.isArray(req)) {
    throw new Error('Invalid field runtime.requirements: expected mapping object');
  }
  return { ...runtime, requirements: { ...req } };
}

/**
 * Build the canonical Project Intelligence Contract from a parsed/normalized manifest.
 * Does not rewrite disk files.
 */
export function toProjectIntelligenceContract(raw, options = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('toProjectIntelligenceContract: expected object');
  }

  const version = assertSupportedContractVersion(resolveContractVersion(raw));
  const legacy = raw.contract?.version == null;
  const adapterSchema =
    raw.forgeos?.adapter_schema_version ??
    raw.agent_os?.adapter_schema_version ??
    CURRENT_ADAPTER_SCHEMA;

  const contract = {
    ...raw,
    schema_version: raw.schema_version ?? version,
    contract: {
      ...(typeof raw.contract === 'object' && raw.contract ? raw.contract : {}),
      version,
    },
    runtime: normalizeRuntimeRequirements(raw.runtime),
  };

  // Ensure agents mapping exists (object, never list)
  if (contract.agents == null) contract.agents = {};
  if (Array.isArray(contract.agents)) {
    throw new Error('Invalid field agents: expected mapping object, got array');
  }

  // Ensure list fields exist as arrays (callers may have already normalized)
  for (const key of ['capabilities', 'ownership']) {
    if (contract[key] == null) contract[key] = [];
    if (!Array.isArray(contract[key])) {
      throw new Error(`Invalid list field ${key}: expected array`);
    }
  }

  if (!contract.policy || typeof contract.policy !== 'object') {
    contract.policy = { protected_paths: [], tier3_operations: [] };
  } else {
    contract.policy = {
      ...contract.policy,
      protected_paths: Array.isArray(contract.policy.protected_paths)
        ? contract.policy.protected_paths
        : [],
      tier3_operations: Array.isArray(contract.policy.tier3_operations)
        ? contract.policy.tier3_operations
        : [],
    };
  }

  if (!contract.integrations || typeof contract.integrations !== 'object') {
    contract.integrations = { mcp: [] };
  } else if (!Array.isArray(contract.integrations.mcp)) {
    contract.integrations = { ...contract.integrations, mcp: [] };
  }

  if (!contract.verification || typeof contract.verification !== 'object') {
    contract.verification = { commands: [] };
  } else if (!Array.isArray(contract.verification.commands)) {
    contract.verification = { ...contract.verification, commands: [] };
  }

  contract._meta = {
    contract_version: version,
    adapter_schema_version: adapterSchema,
    legacy_without_contract_block: legacy,
    authority: FIELD_AUTHORITY,
    source: options.source || null,
    product: 'forgeos',
    /**
     * Capability model reminder for consumers / future Runtime Router:
     * global_capabilities + project_capabilities → effective (see mergeEffectiveCapabilities)
     */
    capability_model: {
      global: 'ForgeOS agents/registry.yaml (+ policy rules agents)',
      project: 'project.capabilities / project.agents in this contract',
      effective: 'global + project (project may add; may not weaken global policy)',
    },
  };

  return contract;
}

/**
 * Validate canonical contract shape (post-normalization).
 * Returns { valid, issues[] }.
 */
export function validateProjectIntelligenceContract(contract) {
  const issues = [];
  if (!contract || typeof contract !== 'object') {
    return { valid: false, issues: ['contract_not_object'] };
  }
  try {
    assertSupportedContractVersion(resolveContractVersion(contract));
  } catch (err) {
    issues.push(err.message);
  }
  if (!contract.project || typeof contract.project !== 'object') {
    issues.push('missing_project_block');
  } else if (!contract.project.id) {
    issues.push('missing_project_id');
  }
  if (!Array.isArray(contract.capabilities)) issues.push('capabilities_not_array');
  if (!Array.isArray(contract.ownership)) issues.push('ownership_not_array');
  if (contract.agents != null && (typeof contract.agents !== 'object' || Array.isArray(contract.agents))) {
    issues.push('agents_not_mapping');
  }
  if (contract.policy) {
    if (!Array.isArray(contract.policy.protected_paths)) issues.push('protected_paths_not_array');
    if (!Array.isArray(contract.policy.tier3_operations)) issues.push('tier3_operations_not_array');
  }
  if (contract.runtime && (typeof contract.runtime !== 'object' || Array.isArray(contract.runtime))) {
    issues.push('runtime_not_mapping');
  }
  if (contract.runtime?.requirements && (typeof contract.runtime.requirements !== 'object' || Array.isArray(contract.runtime.requirements))) {
    issues.push('runtime_requirements_not_mapping');
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Effective capabilities = global registry capabilities + project contract capabilities.
 * Does not apply policy path/tier filters (that remains Policy Engine).
 */
export function mergeEffectiveCapabilities(globalRegistry = {}, projectContract = {}) {
  const global = Array.isArray(globalRegistry.capabilities) ? globalRegistry.capabilities : [];
  const project = Array.isArray(projectContract.capabilities) ? projectContract.capabilities : [];
  if (projectContract.capabilities != null && !Array.isArray(projectContract.capabilities)) {
    throw new Error('mergeEffectiveCapabilities: project.capabilities must be an array');
  }
  const merged = new Map();
  for (const cap of global) {
    const id = typeof cap === 'string' ? cap : cap.id;
    if (!id) continue;
    merged.set(id, { ...(typeof cap === 'object' ? cap : { id: cap }), id, scope: 'global' });
  }
  for (const cap of project) {
    const id = typeof cap === 'string' ? String(cap).replace(/^id:\s*/, '') : cap.id;
    if (!id) continue;
    const existing = merged.get(id) || {};
    merged.set(id, {
      ...existing,
      ...(typeof cap === 'object' ? cap : { id }),
      id,
      scope: 'project',
    });
  }
  return [...merged.values()];
}

export function getFieldAuthority(fieldPath) {
  return FIELD_AUTHORITY[fieldPath] || null;
}
