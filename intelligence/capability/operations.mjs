/**
 * Capability Operation registry — Stage 14
 *
 * Static, versioned, capability-bound operations only.
 * Arbitrary user-provided definitions are NOT trusted automatically.
 */
import {
  createCapabilityOperation,
  fingerprintCapabilityOperation,
  OPERATION_SCHEMA,
} from './operation.mjs';
import { loadCapabilityBindings } from './binding.mjs';

export const OPERATIONS_REGISTRY_VERSION = '1.0.0-stage14';

/**
 * Static operation definitions (canonical, host-independent).
 */
const STATIC_OPERATION_DEFS = Object.freeze([
  {
    id: 'create-missing-project-docs',
    capability_id: 'documentation-sync',
    name: 'Create missing project documentation',
    description: 'Create missing project documentation files indicated by assessment evidence (e.g. AGENTS.md).',
    operation_type: 'documentation',
    version: '1.0.0',
    applies_to_finding_types: ['missing_agents_md', 'missing_readme'],
    scope: {
      allowed_paths: ['docs/**', 'AGENTS.md', '**/AGENTS.md', 'README.md'],
      notes: 'Documentation paths only — does not expand into source trees',
    },
    risk: 'LOW',
    prerequisites: ['project_initialized', 'assessment_available'],
    expected_effects: [
      'declared documentation file exists when createable',
    ],
    verification_strategy: 'presence',
    verification_presence: ['AGENTS.md'],
    implementation_types: ['forgeos_native', 'host_native', 'oss_backed'],
    preferred_implementation: 'forgeos_native',
  },
  {
    id: 'propose-module-reorganization',
    capability_id: 'codebase-organization',
    name: 'Propose module reorganization',
    description: 'Produce a bounded reorganization proposal for misplaced modules or structural findings. Does not move files automatically.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'misplaced_source_root',
      'misplaced_file',
      'misplaced_test',
      'structure_issue',
      'mixed_language_directory',
      'convention_violation',
      'high_structural_coupling',
    ],
    scope: {
      allowed_paths: ['docs/**', 'docs/agents/**'],
      notes: 'Proposal/plan artifacts only in Stage 14 — no automatic file moves',
    },
    risk: 'MEDIUM',
    prerequisites: ['has_source', 'assessment_available'],
    expected_effects: [
      'reorganization proposal documented for review',
    ],
    verification_strategy: 'presence',
    verification_presence: [],
    implementation_types: ['host_native', 'forgeos_native', 'oss_backed'],
    preferred_implementation: 'host_native',
  },
  {
    id: 'generate-dead-code-removal-candidates',
    capability_id: 'dead-code-analysis',
    name: 'Generate dead-code removal candidates',
    description: 'Generate reviewable dead-code candidates from deterministic/heuristic evidence. Does not delete code.',
    operation_type: 'analysis',
    version: '1.0.0',
    applies_to_finding_types: [
      'dead_code_candidate',
      'unreferenced_export_file_candidate',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Candidate list generation only — never auto-delete',
    },
    risk: 'LOW',
    prerequisites: ['has_source', 'assessment_available'],
    expected_effects: [
      'dead-code candidates listed with evidence and confidence',
    ],
    verification_strategy: 'none',
    implementation_types: ['forgeos_native', 'host_native'],
    preferred_implementation: 'forgeos_native',
  },
  {
    id: 'propose-duplication-consolidation',
    capability_id: 'duplication-analysis',
    name: 'Propose duplication consolidation',
    description: 'Propose consolidation for exact or structural duplication candidates. Does not merge files automatically.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'exact_duplicate',
      'duplicate_filename',
      'duplicate_declaration_name_candidate',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Consolidation proposals only',
    },
    risk: 'MEDIUM',
    prerequisites: ['has_source', 'assessment_available'],
    expected_effects: [
      'duplication consolidation proposal available for review',
    ],
    verification_strategy: 'none',
    implementation_types: ['host_native', 'forgeos_native'],
    preferred_implementation: 'host_native',
  },
  {
    id: 'generate-dependency-remediation-plan',
    capability_id: 'dependency-audit',
    name: 'Generate dependency remediation plan',
    description: 'Generate a remediation plan for dependency findings. Does not mutate package manifests automatically.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'dependency_issue',
      'structural_external_imports',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Plan artifacts only',
    },
    risk: 'MEDIUM',
    prerequisites: ['has_package_manifest_or_source', 'assessment_available'],
    expected_effects: [
      'dependency remediation plan documented',
    ],
    verification_strategy: 'presence',
    implementation_types: ['forgeos_native', 'host_native'],
    preferred_implementation: 'forgeos_native',
  },
  {
    id: 'generate-boundary-remediation-plan',
    capability_id: 'architecture-guard',
    name: 'Generate architecture boundary remediation plan',
    description: 'Generate a plan to address architecture boundary violations and coupling findings.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'architecture_violation',
      'missing_architecture_docs',
      'high_structural_coupling',
    ],
    scope: {
      allowed_paths: ['docs/**', 'docs/adr/**', 'docs/architecture/**'],
      notes: 'Architecture/docs planning scope',
    },
    risk: 'HIGH',
    prerequisites: ['project_initialized', 'assessment_available'],
    expected_effects: [
      'boundary remediation plan documented',
    ],
    verification_strategy: 'presence',
    implementation_types: ['host_native', 'forgeos_native'],
    preferred_implementation: 'host_native',
  },
  {
    id: 'generate-change-impact-report',
    capability_id: 'change-impact',
    name: 'Generate change-impact report',
    description: 'Generate an impact report for explicitly provided changed files using structural edges when available.',
    operation_type: 'analysis',
    version: '1.0.0',
    applies_to_finding_types: [
      'change_impact_set',
      'change_impact_security_signal',
      'change_impact_no_target',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Report generation only',
    },
    risk: 'LOW',
    prerequisites: ['has_source', 'explicit_changed_files', 'assessment_available'],
    expected_effects: [
      'change-impact set documented for the provided changed files',
    ],
    verification_strategy: 'none',
    implementation_types: ['forgeos_native', 'host_native'],
    preferred_implementation: 'forgeos_native',
  },
  {
    id: 'plan-safe-refactor',
    capability_id: 'safe-refactor',
    name: 'Plan safe refactor',
    description: 'Plan a behavior-preserving refactor workflow with verification requirements. Does not refactor automatically.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'structure_issue',
      'architecture_violation',
      'exact_duplicate',
      'high_structural_coupling',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Planning only — execution requires later approval + policy',
    },
    risk: 'HIGH',
    prerequisites: ['has_source', 'assessment_available', 'architecture_guard_context'],
    expected_effects: [
      'safe-refactor plan with verification requirements',
    ],
    verification_strategy: 'project_verification_commands',
    implementation_types: ['host_native', 'oss_backed'],
    preferred_implementation: 'host_native',
  },
  // structure-audit shares reorganization proposal language via codebase-organization;
  // also register a structure-audit-bound propose op for direct structure findings.
  {
    id: 'propose-structure-remediation',
    capability_id: 'structure-audit',
    name: 'Propose structure remediation',
    description: 'Propose remediation for structure-audit findings without mutating the tree.',
    operation_type: 'planning',
    version: '1.0.0',
    applies_to_finding_types: [
      'misplaced_source_root',
      'misplaced_file',
      'misplaced_test',
      'structure_issue',
      'mixed_language_directory',
      'convention_violation',
      'high_structural_coupling',
      'unreferenced_export_file_candidate',
    ],
    scope: {
      allowed_paths: ['docs/**'],
      notes: 'Proposal only',
    },
    risk: 'MEDIUM',
    prerequisites: ['has_source', 'assessment_available'],
    expected_effects: [
      'structure remediation proposal documented',
    ],
    verification_strategy: 'presence',
    implementation_types: ['forgeos_native', 'host_native'],
    preferred_implementation: 'forgeos_native',
  },
]);

let _cache = null;

function knownCapabilityIds() {
  const bindings = loadCapabilityBindings();
  return new Set((bindings.capabilities || []).map((c) => c.id));
}

function buildRegistry(defs = STATIC_OPERATION_DEFS) {
  const known = knownCapabilityIds();
  const byId = new Map();
  const byCapability = new Map();
  const errors = [];

  for (const def of defs) {
    const created = createCapabilityOperation(def, { known_capability_ids: known });
    if (!created.valid) {
      errors.push({ id: def.id, reasons: created.reasons });
      continue;
    }
    const op = created.operation;
    if (byId.has(op.id)) {
      errors.push({ id: op.id, reasons: ['duplicate_operation_id'] });
      continue;
    }
    byId.set(op.id, op);
    if (!byCapability.has(op.capability_id)) byCapability.set(op.capability_id, []);
    byCapability.get(op.capability_id).push(op);
  }

  for (const [, list] of byCapability) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const operations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const registry_fingerprint = fingerprintCapabilityOperation({
    id: 'registry',
    capability_id: 'registry',
    version: OPERATIONS_REGISTRY_VERSION,
    operation_type: 'planning',
    applies_to_finding_types: operations.map((o) => o.id),
    scope: { allowed_paths: [], forbidden_paths: [] },
    risk: 'LOW',
    prerequisites: [],
    expected_effects: operations.map((o) => o.operation_fingerprint),
    verification_strategy: 'none',
    implementation_types: ['forgeos_native'],
    preferred_implementation: 'forgeos_native',
  });

  return {
    schema: 'forgeos-capability-operations-registry',
    schema_version: 1,
    version: OPERATIONS_REGISTRY_VERSION,
    operation_schema: OPERATION_SCHEMA,
    count: operations.length,
    operations,
    by_id: byId,
    by_capability: byCapability,
    errors,
    registry_fingerprint,
    trusted_source: 'static_registry_only',
    note: 'User-provided operation definitions are not auto-trusted',
  };
}

export function loadOperationRegistry(options = {}) {
  if (!options.fresh && _cache) return _cache;
  _cache = buildRegistry(options.definitions || STATIC_OPERATION_DEFS);
  return _cache;
}

export function clearOperationRegistryCache() {
  _cache = null;
}

export function getOperation(operationId, options = {}) {
  const registry = loadOperationRegistry(options);
  return registry.by_id.get(String(operationId || '')) || null;
}

export function listOperationsForCapability(capabilityId, options = {}) {
  const registry = loadOperationRegistry(options);
  return [...(registry.by_capability.get(String(capabilityId || '')) || [])];
}

export function listAllOperations(options = {}) {
  return loadOperationRegistry(options).operations;
}

/**
 * Reject untrusted dynamic registration attempts.
 */
export function registerExternalOperation() {
  return {
    ok: false,
    reason: 'external_operations_not_auto_trusted',
    note: 'Stage 14 only trusts the static ForgeOS operation registry',
  };
}

export { STATIC_OPERATION_DEFS };
