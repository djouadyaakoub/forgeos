/**
 * Assessment evidence persistence — project-local, authoritative records.
 * Canvas is derived from these artifacts; they do not modify Project Intelligence.
 */
import fs from 'node:fs';
import { completionSemantics } from '../capability/completion.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getCanonicalVersion } from '../../policy/version.mjs';
import { fingerprintText } from './facts.mjs';
import { capabilityBindingFingerprint } from '../capability/binding.mjs';
import {
  createGovernanceEvidence,
  appendGovernanceEvidence,
  validateGovernanceEvidence,
  listGovernanceEvidence,
  GOVERNANCE_EVIDENCE_SCHEMA,
} from '../orchestrator/governance-evidence.mjs';
import { computeEvidenceFingerprint } from '../orchestrator/fingerprints.mjs';

export const DEFAULT_ASSESSMENT_DIR = 'docs/project/assessments';

export function assessmentEvidenceDir(projectDir, subdir = DEFAULT_ASSESSMENT_DIR) {
  return path.join(projectDir, subdir);
}

export function buildAssessmentArtifact(input = {}) {
  const producedAt = input.produced_at || new Date().toISOString();
  const capabilityId = String(input.capability_id || '');
  const payload = {
    schema: 'capability-assessment',
    schema_version: 1,
    capability_id: capabilityId,
    applicability: input.applicability || 'UNKNOWN',
    state: input.state || 'UNKNOWN',
    confidence: input.confidence || 'LOW',
    severity: input.severity || 'info',
    evidence: input.evidence || [],
    evidence_timestamp: producedAt,
    freshness_ttl: Number(input.freshness_ttl ?? 86400),
    stale: input.stale === true,
    rationale: input.rationale || '',
    recommended_action: input.recommended_action || null,
    verification: input.verification || null,
    forgeos_version: input.forgeos_version || getCanonicalVersion(),
    project_intelligence_contract_version: input.project_intelligence_contract_version ?? null,
    project_intelligence_fingerprint: input.project_intelligence_fingerprint || null,
    capability_binding_fingerprint: input.capability_binding_fingerprint || null,
    input_fingerprint: input.input_fingerprint || null,
    produced_at: producedAt,
    assessment_module: input.assessment_module || null,
  };
  payload.artifact_id = crypto
    .createHash('sha256')
    .update(JSON.stringify({ capabilityId, producedAt, state: payload.state }))
    .digest('hex')
    .slice(0, 16);
  return payload;
}

export function writeAssessmentArtifact(projectDir, artifact, options = {}) {
  const dir = assessmentEvidenceDir(projectDir, options.assessment_dir);
  fs.mkdirSync(dir, { recursive: true });
  const safeTs = artifact.produced_at.replace(/[:.]/g, '-');
  const filename = `${artifact.capability_id}-${safeTs}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return {
    path: fullPath.replace(/\\/g, '/'),
    relative_path: path.relative(projectDir, fullPath).replace(/\\/g, '/'),
    artifact,
  };
}

export function listAssessmentArtifacts(projectDir, options = {}) {
  const dir = assessmentEvidenceDir(projectDir, options.assessment_dir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('governance-evidence-')).sort();
  const artifacts = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      artifacts.push({
        file: file.replace(/\\/g, '/'),
        relative_path: path.join(options.assessment_dir || DEFAULT_ASSESSMENT_DIR, file).replace(/\\/g, '/'),
        artifact: parsed,
        mtime_ms: fs.statSync(path.join(dir, file)).mtimeMs,
      });
    } catch {
      /* skip corrupt artifact */
    }
  }
  return artifacts;
}

export function latestArtifactForCapability(artifacts, capabilityId) {
  const matches = artifacts
    .filter((a) => a.artifact?.capability_id === capabilityId)
    .sort((a, b) => String(b.artifact.produced_at).localeCompare(String(a.artifact.produced_at)));
  return matches[0] || null;
}

export function computeInputFingerprint(facts, bindings) {
  return fingerprintText(
    JSON.stringify({
      pi: facts.project_intelligence_fingerprint,
      initialized: facts.initialized,
      has_source: facts.has_source,
      has_tests: facts.has_tests,
      has_docs: facts.has_docs,
      has_deployment: facts.has_deployment,
      project_type: facts.project_type,
      binding: capabilityBindingFingerprint(bindings),
    })
  );
}

export function evaluateEvidenceFreshness(artifact, facts, options = {}) {
  if (!artifact) {
    return { stale: true, reasons: ['no_evidence'] };
  }
  const reasons = [];
  const now = Date.now();
  const produced = Date.parse(
    artifact.produced_at
    || artifact.timestamps?.verified_at
    || artifact.verified_at
    || ''
  );
  const ttlMs = Number(artifact.freshness_ttl ?? 86400) * 1000;
  if (Number.isFinite(produced) && ttlMs > 0 && now - produced > ttlMs) {
    reasons.push('ttl_expired');
  }
  if (
    artifact.project_intelligence_fingerprint &&
    facts.project_intelligence_fingerprint &&
    artifact.project_intelligence_fingerprint !== facts.project_intelligence_fingerprint
  ) {
    reasons.push('project_intelligence_changed');
  }
  if (
    options.input_fingerprint &&
    artifact.input_fingerprint &&
    artifact.input_fingerprint !== options.input_fingerprint
  ) {
    reasons.push('assessment_inputs_changed');
  }
  if (options.binding_fingerprint && artifact.capability_binding_fingerprint) {
    if (artifact.capability_binding_fingerprint !== options.binding_fingerprint) {
      reasons.push('capability_binding_changed');
    }
  }
  if (
    options.strategy_fingerprint
    && artifact.verification_strategy_fingerprint
    && artifact.verification_strategy_fingerprint !== options.strategy_fingerprint
  ) {
    reasons.push('verification_strategy_changed');
  }
  if (
    options.scoped_state_fingerprint
    && artifact.scoped_state_fingerprint
    && artifact.scoped_state_fingerprint !== options.scoped_state_fingerprint
  ) {
    reasons.push('relevant_files_changed');
  }
  if (options.fingerprints && artifact.project_fingerprint?.composite) {
    if (artifact.project_fingerprint.composite !== options.fingerprints.composite) {
      reasons.push('project_fingerprint_changed');
    }
  }
  return { stale: reasons.length > 0, reasons };
}

export function writeVerifiedRecord(projectDir, record, options = {}) {
  const evidence = record.schema === GOVERNANCE_EVIDENCE_SCHEMA
    ? record
    : createGovernanceEvidence({
      ...record,
      verification: record.verification || {
        result: record.verification_result,
        strategy: record.verification_strategy,
        checks: record.checks || [],
        reason: record.rationale,
        project_fingerprint: record.project_fingerprint,
      },
      project_fingerprint: record.project_fingerprint || computeEvidenceFingerprint({
        project_intelligence_fingerprint: record.project_intelligence_fingerprint,
      }, record),
    });
  if (options.persist === false) {
    return { path: null, record: evidence, persisted: false };
  }
  const written = appendGovernanceEvidence(projectDir, evidence, options);
  return { path: written.path, record: evidence, persisted: true };
}

export function loadVerifiedRecords(projectDir, options = {}) {
  const map = {};
  const governance = listGovernanceEvidence(projectDir, options);
  const ordered = governance
    .map((e) => e.artifact)
    .sort((a, b) => String(a.timestamps?.recorded_at || '').localeCompare(String(b.timestamps?.recorded_at || '')));
  for (const a of ordered) {
    if (a?.capability_id) map[a.capability_id] = a;
  }
  const artifacts = listAssessmentArtifacts(projectDir, options);
  for (const entry of artifacts) {
    const a = entry.artifact || {};
    if (a.schema === 'forgeos-verified-capability' && a.verified === true && a.capability_id) {
      if (!map[a.capability_id]) map[a.capability_id] = a;
    }
  }
  return map;
}

export function latestGovernanceForCapability(projectDir, capabilityId, options = {}) {
  const list = listGovernanceEvidence(projectDir, options)
    .map((e) => e.artifact)
    .filter((a) => a?.capability_id === capabilityId)
    .sort((a, b) => String(b.timestamps?.recorded_at || '').localeCompare(String(a.timestamps?.recorded_at || '')));
  return list[0] || null;
}

export function mergeVerifiedState(assessment, verifiedRecord, context = {}) {
  if (!verifiedRecord || verifiedRecord.capability_id !== assessment.capability_id) {
    return assessment;
  }

  const validation = validateGovernanceEvidence(verifiedRecord, {
    expected_capability_id: assessment.capability_id,
    expected_task_id: context.expected_task_id,
    fingerprints: context.fingerprints,
    expected_strategy: context.expected_strategy || assessment.verification?.strategy,
    now: context.now,
  });

  if (verifiedRecord.verification_result === 'FAIL' || validation.reasons.includes('pass_inconsistent_with_checks')) {
    return {
      ...assessment,
      last_evidence_id: verifiedRecord.evidence_id || null,
      verification: {
        ...(assessment.verification || {}),
        status: 'failed',
        result: 'FAIL',
        verified_at: verifiedRecord.timestamps?.verified_at || verifiedRecord.verified_at || null,
        task_id: verifiedRecord.task_id || null,
        evidence_id: verifiedRecord.evidence_id || null,
      },
    };
  }

  if (verifiedRecord.verification_result === 'UNKNOWN') {
    return {
      ...assessment,
      last_evidence_id: verifiedRecord.evidence_id || null,
      verification: {
        ...(assessment.verification || {}),
        status: 'not_verified',
        result: 'UNKNOWN',
        verified_at: verifiedRecord.timestamps?.verified_at || verifiedRecord.verified_at || null,
        task_id: verifiedRecord.task_id || null,
        evidence_id: verifiedRecord.evidence_id || null,
      },
    };
  }

  if (validation.stale) {
    return {
      ...assessment,
      stale: true,
      stale_reasons: validation.stale_reasons,
      last_evidence_id: verifiedRecord.evidence_id || null,
      verification: {
        ...(assessment.verification || {}),
        status: 'stale',
        result: verifiedRecord.verification_result,
        verified_at: verifiedRecord.timestamps?.verified_at || verifiedRecord.verified_at || null,
        task_id: verifiedRecord.task_id || null,
        evidence_id: verifiedRecord.evidence_id || null,
      },
    };
  }

  if (!validation.accept_satisfied) {
    return assessment;
  }

  const semantics = completionSemantics(assessment.capability_id);
  if (!semantics.automatic || (semantics.classification === 'COMMAND_IS_SEMANTIC'
    && (verifiedRecord.verification_strategy !== 'project_verification_commands' || assessment.evidence?.length))) {
    return {...assessment, last_evidence_id:verifiedRecord.evidence_id,
      verification:{...assessment.verification,result:'UNKNOWN',status:'completion_contract_insufficient',
        task_result:verifiedRecord.verification_result,reason:semantics.reason},
      rationale:`${assessment.rationale}; no automatic capability satisfaction from this evidence`};
  }

  // A scoped task PASS does not discharge other current capability findings.
  if (['documentation-sync','documentation-drift'].includes(assessment.capability_id) && assessment.evidence?.length) {
    return {...assessment, last_evidence_id:verifiedRecord.evidence_id,
      verification:{...assessment.verification, status:'scoped_pass_with_remaining_findings', result:'PASS',
        task_id:verifiedRecord.task_id, evidence_id:verifiedRecord.evidence_id},
      rationale:`${assessment.rationale}; scoped verification does not resolve remaining documentation findings`};
  }

  return {
    ...assessment,
    state: 'SATISFIED',
    confidence: 'HIGH',
    last_verified: verifiedRecord.timestamps?.verified_at || verifiedRecord.verified_at,
    verified_by_task: verifiedRecord.task_id || null,
    last_evidence_id: verifiedRecord.evidence_id || null,
    stale: false,
    verification: {
      ...(assessment.verification || {}),
      status: 'passed',
      result: 'PASS',
      verified_at: verifiedRecord.timestamps?.verified_at || verifiedRecord.verified_at || null,
      task_id: verifiedRecord.task_id || null,
      evidence_id: verifiedRecord.evidence_id || null,
    },
    rationale: verifiedRecord.rationale || assessment.rationale,
  };
}
