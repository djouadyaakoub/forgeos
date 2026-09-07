/**
 * Finding → Operation selection — Stage 14
 *
 * Deterministic mapping from assessment findings to registered operations.
 * Never invents operations. Never executes.
 */
import crypto from 'node:crypto';
import {
  getOperation,
  listOperationsForCapability,
  loadOperationRegistry,
} from './operations.mjs';
import { fingerprintOperationBinding } from './operation.mjs';

function findingId(finding, index) {
  if (finding.fingerprint) return String(finding.fingerprint);
  if (finding.id) return String(finding.id);
  const base = `${finding.type || 'finding'}|${finding.path || finding.file || ''}|${finding.message || ''}`;
  return crypto.createHash('sha256').update(`${index}|${base}`).digest('hex').slice(0, 16);
}

function evaluatePrerequisites(operation, context = {}) {
  const missing = [];
  const facts = context.facts || {};
  const assessment = context.assessment || {};

  for (const pre of operation.prerequisites || []) {
    if (pre === 'project_initialized' && facts.initialized !== true) {
      missing.push(pre);
    } else if (pre === 'has_source' && facts.has_source !== true) {
      missing.push(pre);
    } else if (pre === 'assessment_available' && !assessment) {
      missing.push(pre);
    } else if (pre === 'explicit_changed_files') {
      const changed = facts.changed_files || context.changed_files || [];
      if (!Array.isArray(changed) || changed.length === 0) missing.push(pre);
    } else if (pre === 'has_package_manifest_or_source') {
      if (!facts.has_package_json && !facts.has_source) missing.push(pre);
    } else if (pre === 'architecture_guard_context') {
      // Soft prerequisite: assessment ecosystem present is enough for planning
      if (!context.assessment && !context.bindings) missing.push(pre);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    status: missing.length === 0 ? 'READY' : 'UNRESOLVED',
  };
}

/**
 * Select registered operations applicable to findings for a capability.
 */
export function selectOperationsForFindings(input = {}) {
  const capabilityId = String(input.capability_id || '').trim();
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const registry = loadOperationRegistry(input.registry_options);
  const ops = capabilityId
    ? listOperationsForCapability(capabilityId, input.registry_options)
    : registry.operations;

  if (!capabilityId) {
    return {
      candidates: [],
      unresolved: [{ status: 'UNRESOLVED', reason: 'capability_id_required' }],
    };
  }

  const findingRecords = findings.map((f, i) => ({
    ...f,
    finding_id: findingId(f, i),
  }));

  const byType = new Map();
  for (const f of findingRecords) {
    const t = String(f.type || '');
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(f);
  }

  const candidates = [];
  const unresolved = [];
  const unmatched_findings = [];

  for (const op of ops) {
    const matched = [];
    for (const type of op.applies_to_finding_types || []) {
      for (const f of byType.get(type) || []) matched.push(f);
    }
    // Deduplicate matched findings
    const seen = new Set();
    const matchedUnique = [];
    for (const f of matched) {
      if (seen.has(f.finding_id)) continue;
      seen.add(f.finding_id);
      matchedUnique.push(f);
    }

    if (!matchedUnique.length) continue;

    const prereq = evaluatePrerequisites(op, input);
    if (!prereq.ok) {
      unresolved.push({
        status: 'UNRESOLVED',
        operation_id: op.id,
        capability_id: op.capability_id,
        reason: 'prerequisites_missing',
        missing: prereq.missing,
        finding_ids: matchedUnique.map((f) => f.finding_id),
      });
      continue;
    }

    const affectedFiles = [...new Set(
      matchedUnique
        .map((f) => f.path || f.file)
        .filter(Boolean)
        .map(String)
    )].sort();

    const findingIds = matchedUnique.map((f) => f.finding_id).sort();
    const findingFingerprints = matchedUnique
      .map((f) => f.fingerprint || f.finding_id)
      .map(String)
      .sort();

    const bindingFingerprint = fingerprintOperationBinding({
      operation_id: op.id,
      operation_fingerprint: op.operation_fingerprint,
      capability_id: op.capability_id,
      allowed_paths: op.scope.allowed_paths,
      forbidden_paths: op.scope.forbidden_paths,
      affected_files: affectedFiles,
      project_intelligence_fingerprint: input.facts?.project_intelligence_fingerprint,
      finding_ids: findingIds,
      finding_fingerprints: findingFingerprints,
      verification_strategy: op.verification_strategy,
    });

    candidates.push({
      schema: 'forgeos-operation-candidate',
      schema_version: 1,
      operation_id: op.id,
      capability_id: op.capability_id,
      operation: op,
      finding_ids: findingIds,
      findings: matchedUnique,
      scope: {
        allowed_paths: [...op.scope.allowed_paths],
        forbidden_paths: [...op.scope.forbidden_paths],
        affected_files: affectedFiles,
      },
      risk: op.risk,
      expected_effects: [...op.expected_effects],
      verification_strategy: op.verification_strategy,
      verification_presence: [...(op.verification_presence || [])],
      prerequisites_status: prereq.status,
      operation_binding_fingerprint: bindingFingerprint,
      execute: false,
      auto_execute: false,
      note: 'Operation candidate — not executed',
    });
  }

  // Findings with no matching registered operation
  for (const f of findingRecords) {
    const type = String(f.type || '');
    const any = ops.some((op) => (op.applies_to_finding_types || []).includes(type));
    if (!any && type) {
      unmatched_findings.push({
        finding_id: f.finding_id,
        type,
        reason: 'no_registered_operation_for_finding_type',
      });
    }
  }

  candidates.sort((a, b) => {
    const r = a.operation_id.localeCompare(b.operation_id);
    if (r !== 0) return r;
    return a.operation_binding_fingerprint.localeCompare(b.operation_binding_fingerprint);
  });

  return {
    capability_id: capabilityId,
    candidates,
    unresolved,
    unmatched_findings,
    registry_version: registry.version,
  };
}

/**
 * Pick a single preferred operation candidate (deterministic).
 */
export function pickPreferredOperationCandidate(selection = {}) {
  const list = selection.candidates || [];
  if (!list.length) return null;
  // Prefer remediation/documentation with forgeos_native when available, else first sorted
  const scored = [...list].map((c, idx) => {
    let score = 0;
    if (c.operation.preferred_implementation === 'forgeos_native') score += 2;
    if (c.operation.operation_type === 'documentation') score += 2;
    if (c.operation.operation_type === 'remediation') score += 1;
    if (c.risk === 'LOW') score += 1;
    return { c, score, idx };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.c.operation_id.localeCompare(b.c.operation_id);
  });
  return scored[0].c;
}

export function resolveOperationById(operationId) {
  return getOperation(operationId);
}

export { evaluatePrerequisites };
