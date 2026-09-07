/**
 * ForgeOS governance evidence — Stage 10
 *
 * Append-only. Distinct from runtime-native transcripts.
 * Evidence is not an authorization mechanism.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { POLICY_AUTHORITY, PRODUCT_ID } from '../../policy/identity.mjs';
import { getCanonicalVersion } from '../../policy/version.mjs';
import { fingerprintsMatch } from './fingerprints.mjs';

export const DEFAULT_ASSESSMENT_DIR = 'docs/project/assessments';

function assessmentEvidenceDir(projectDir, subdir = DEFAULT_ASSESSMENT_DIR) {
  return path.join(projectDir, subdir);
}

export const GOVERNANCE_EVIDENCE_SCHEMA = 'forgeos-governance-evidence';
export const EVIDENCE_CLASS_GOVERNANCE = 'FORGEOS_GOVERNANCE_EVIDENCE';
export const EVIDENCE_CLASS_RUNTIME = 'RUNTIME_NATIVE_EVIDENCE';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function computeEvidenceIntegrity(record) {
  const copy = { ...record };
  delete copy.integrity;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

export function createGovernanceEvidence(input = {}) {
  const verifiedAt = input.verified_at || new Date().toISOString();
  const verification = input.verification || {};
  const result = verification.result || input.verification_result || 'UNKNOWN';
  const nonce = input.nonce || crypto.randomBytes(8).toString('hex');
  const evidenceId = input.evidence_id || crypto
    .createHash('sha256')
    .update([
      input.task_id || '',
      input.capability_id || '',
      input.execution_id || '',
      verifiedAt,
      nonce,
    ].join('|'))
    .digest('hex')
    .slice(0, 24);

  const record = {
    schema: GOVERNANCE_EVIDENCE_SCHEMA,
    schema_version: 1,
    evidence_class: EVIDENCE_CLASS_GOVERNANCE,
    evidence_id: evidenceId,
    task_id: input.task_id || null,
    capability_id: input.capability_id || null,
    execution_id: input.execution_id || null,
    verification_result: result,
    task_scope_fingerprint: verification.task_scope_fingerprint || null,
    verification_strategy: verification.strategy || input.verification_strategy || 'none',
    checks: verification.checks || input.checks || [],
    project_fingerprint: input.project_fingerprint || verification.project_fingerprint || null,
    forgeos_version: input.forgeos_version || getCanonicalVersion(),
    timestamps: {
      recorded_at: input.recorded_at || verifiedAt,
      verified_at: verifiedAt,
      started_at: input.started_at || null,
      completed_at: input.completed_at || null,
    },
    authority: POLICY_AUTHORITY,
    product: PRODUCT_ID,
    source_references: input.source_references || {
      verification: 'intelligence/orchestrator/capability-verification.mjs',
      policy: 'policy/authority.mjs',
    },
    freshness: {
      ttl_seconds: Number(input.freshness_ttl ?? 86400),
      stale: false,
      reasons: [],
    },
    supersedes_evidence_id: input.supersedes_evidence_id || null,
    runtime_native_evidence: input.runtime_native_evidence
      ? {
        evidence_class: EVIDENCE_CLASS_RUNTIME,
        kind: input.runtime_native_evidence.kind || null,
        run_id: input.runtime_native_evidence.run_id || null,
        note: 'Runtime-native evidence is not ForgeOS verification authority',
      }
      : null,
    lifecycle_status: input.lifecycle_status || null,
    verified: result === 'PASS',
    rationale: input.rationale || verification.reason || '',
    affected_scope: input.affected_scope || [],
    nonce,
  };
  record.integrity = computeEvidenceIntegrity(record);
  return record;
}

export function validateGovernanceEvidence(record, context = {}) {
  const reasons = [];
  if (!record || typeof record !== 'object') {
    return { ok: false, accept_satisfied: false, reasons: ['missing_record'] };
  }
  if (record.schema !== GOVERNANCE_EVIDENCE_SCHEMA && record.schema !== 'forgeos-verified-capability') {
    reasons.push('unknown_schema');
  }
  if (record.evidence_class && record.evidence_class !== EVIDENCE_CLASS_GOVERNANCE) {
    reasons.push('not_governance_evidence');
  }
  if (record.authority && record.authority !== POLICY_AUTHORITY) {
    reasons.push('authority_mismatch');
  }
  if (record.integrity) {
    const expected = computeEvidenceIntegrity(record);
    if (expected !== record.integrity) reasons.push('integrity_mismatch');
  } else if (record.schema === GOVERNANCE_EVIDENCE_SCHEMA) {
    reasons.push('integrity_missing');
  }
  if (context.expected_task_id && record.task_id !== context.expected_task_id) {
    reasons.push('task_id_mismatch');
  }
  if (context.expected_capability_id && record.capability_id !== context.expected_capability_id) {
    reasons.push('capability_id_mismatch');
  }
  if (context.expected_execution_id && record.execution_id !== context.expected_execution_id) {
    reasons.push('execution_id_mismatch');
  }
  if (context.expected_project_id && record.project_id && record.project_id !== context.expected_project_id) {
    reasons.push('project_id_mismatch');
  }
  if (context.fingerprints && record.project_fingerprint) {
    if (!fingerprintsMatch(record.project_fingerprint, context.fingerprints)) {
      reasons.push('project_fingerprint_mismatch');
    }
  }
  if (
    context.expected_strategy
    && record.verification_strategy
    && record.verification_strategy !== context.expected_strategy
  ) {
    reasons.push('verification_strategy_changed');
  }

  const now = context.now || Date.now();
  const produced = Date.parse(record.timestamps?.verified_at || record.verified_at || record.timestamps?.recorded_at || '');
  const ttlMs = Number(record.freshness?.ttl_seconds ?? record.freshness_ttl ?? 86400) * 1000;
  const staleReasons = [];
  if (Number.isFinite(produced) && ttlMs > 0 && now - produced > ttlMs) {
    staleReasons.push('ttl_expired');
  }
  if (reasons.includes('project_fingerprint_mismatch')) {
    staleReasons.push('project_state_changed');
  }
  if (reasons.includes('verification_strategy_changed')) {
    staleReasons.push('verification_strategy_changed');
  }

  if (record.verification_result === 'PASS') {
    if (record.verification_strategy === 'none') {
      reasons.push('pass_with_none_strategy');
    }
    const checks = record.checks || [];
    if (checks.length && checks.some((c) => c.result !== 'PASS')) {
      reasons.push('pass_inconsistent_with_checks');
    }
    if ((record.verification_strategy === 'presence' || record.verification_strategy === 'project_verification_commands' || record.verification_strategy === 'finding_resolution')
      && !checks.length) {
      reasons.push('pass_without_checks');
    }
  }

  const stale = staleReasons.length > 0;
  const structuralOk = !reasons.length;
  const acceptSatisfied = structuralOk
    && !stale
    && record.verification_result === 'PASS'
    && record.verified === true;

  return {
    ok: structuralOk,
    accept_satisfied: acceptSatisfied,
    stale,
    reasons: [...reasons, ...staleReasons.filter((r) => !reasons.includes(r))],
    stale_reasons: staleReasons,
  };
}

export function appendGovernanceEvidence(projectDir, record, options = {}) {
  const dir = assessmentEvidenceDir(projectDir, options.assessment_dir);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `governance-evidence-${record.evidence_id}.json`;
  const fullPath = path.join(dir, filename);
  if (fs.existsSync(fullPath)) {
    throw new Error(`governance_evidence_immutable:${record.evidence_id}`);
  }
  fs.writeFileSync(fullPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return {
    path: fullPath.replace(/\\/g, '/'),
    relative_path: path.relative(projectDir, fullPath).replace(/\\/g, '/'),
    record,
  };
}

export function listGovernanceEvidence(projectDir, options = {}) {
  const dir = assessmentEvidenceDir(projectDir, options.assessment_dir || DEFAULT_ASSESSMENT_DIR);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('governance-evidence-') && f.endsWith('.json')).sort();
  const out = [];
  for (const file of files) {
    try {
      const artifact = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      out.push({
        file,
        artifact,
        mtime_ms: fs.statSync(path.join(dir, file)).mtimeMs,
      });
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}
