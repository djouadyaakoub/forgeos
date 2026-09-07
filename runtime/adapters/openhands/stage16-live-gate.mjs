/**
 * Stage 16 — OpenHands Live E2E validation gate
 *
 * Validation only. Does not invent endpoints, keys, or fake live PASS.
 * Failure classifications:
 *   LIVE_PASS | LIVE_BLOCKED_ENVIRONMENT | LIVE_RUNTIME_FAILURE |
 *   LIVE_VERIFICATION_FAILURE | LIVE_POLICY_FAILURE | LIVE_PACKAGING_FAILURE
 */
import {
  assessOpenHandsEnvironment,
  isOpenHandsProviderConfigured,
  isOpenHandsServerConfigured,
} from './environment-gate.mjs';
import { runOpenHandsLiveProof } from './live-proof.mjs';
import { resolveCapabilityOperation } from '../../../intelligence/capability/resolver.mjs';
import { getOperation } from '../../../intelligence/capability/operations.mjs';

export const LIVE_CLASSIFICATIONS = Object.freeze([
  'LIVE_PASS',
  'LIVE_BLOCKED_ENVIRONMENT',
  'LIVE_RUNTIME_FAILURE',
  'LIVE_VERIFICATION_FAILURE',
  'LIVE_POLICY_FAILURE',
  'LIVE_PACKAGING_FAILURE',
]);

function envConfiguredReport() {
  return {
    OPENHANDS_AGENT_SERVER_URL: isOpenHandsServerConfigured({}) ? 'configured' : 'not_configured',
    OPENHANDS_LLM_API_KEY: isOpenHandsProviderConfigured({}) ? 'configured' : 'not_configured',
    OPENHANDS_MODEL:
      typeof process.env.OPENHANDS_MODEL === 'string' && process.env.OPENHANDS_MODEL.trim()
        ? 'configured'
        : 'not_configured',
    OPENHANDS_SESSION_API_KEY:
      (typeof process.env.OPENHANDS_SESSION_API_KEY === 'string'
        && process.env.OPENHANDS_SESSION_API_KEY.trim())
      || (typeof process.env.OH_SESSION_API_KEYS_0 === 'string'
        && process.env.OH_SESSION_API_KEYS_0.trim())
        ? 'configured'
        : 'not_configured',
  };
}

function resolveOpenHandsPath() {
  const operation = getOperation('create-missing-project-docs');
  const resolution = resolveCapabilityOperation({
    operation_id: 'create-missing-project-docs',
    preference: 'oss_backed',
    runtime_backend_id: 'openhands',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });
  return {
    capability_id: operation?.capability_id || null,
    operation_id: operation?.id || null,
    implementation_type: resolution.implementation_type || null,
    implementation_id: resolution.implementation_id || null,
    resolved: resolution.resolved === true,
    execution_boundary: resolution.execution_boundary,
  };
}

/**
 * Run Stage 16 live validation gate.
 * Never fabricates LIVE_PASS when environment is not ready.
 */
export async function runStage16LiveGate(input = {}) {
  const startedAt = new Date().toISOString();
  const envVars = envConfiguredReport();
  const environment = assessOpenHandsEnvironment(input);
  const resolution = resolveOpenHandsPath();

  const base = {
    schema: 'forgeos-openhands-stage16-live-gate',
    schema_version: 1,
    stage: 16,
    started_at: startedAt,
    env_vars: envVars,
    environment: {
      status: environment.status,
      reason: environment.reason,
      live_capable: environment.live_capable,
      openhands_version: environment.openhands_version,
      health: environment.health,
      ready: environment.ready,
      server_info: environment.server_info,
      provider_configured: environment.provider_configured,
      gate_chain: environment.gate_chain,
      installation: environment.installation,
      bundled_in_forgeos: environment.bundled_in_forgeos,
    },
    resolution,
    classification: 'LIVE_BLOCKED_ENVIRONMENT',
    live_e2e: 'NOT_RUN',
    real_execution: 'NOT_RUN',
    real_project_effect: 'NOT_RUN',
    forgeos_verification: 'NOT_RUN',
    governance_evidence: 'NOT_RUN',
    canvas_rescan: 'NOT_RUN',
    negative_policy: 'NOT_RUN',
    note: null,
  };

  if (environment.status !== 'READY' || !environment.live_capable) {
    return {
      ...base,
      completed_at: new Date().toISOString(),
      ok: false,
      stage16: 'BLOCKED',
      classification: 'LIVE_BLOCKED_ENVIRONMENT',
      live_e2e: 'NOT_RUN',
      reason: environment.reason || 'live_environment_blocked',
      note: 'Live execution not attempted — do not invent credentials or fake LIVE_PASS',
    };
  }

  // Environment READY — attempt real governed live proof (no mocks)
  const proof = await runOpenHandsLiveProof({
    ...input,
    require_live_provider: true,
  });

  const completedAt = new Date().toISOString();
  if (proof.ok && proof.live_e2e === 'PASS') {
    return {
      ...base,
      completed_at: completedAt,
      ok: true,
      stage16: 'PASS',
      classification: 'LIVE_PASS',
      live_e2e: 'PASS',
      real_execution: 'PASS',
      real_project_effect: proof.project_effect ? 'PASS' : 'FAIL',
      forgeos_verification: proof.verification_status === 'PASS' ? 'PASS' : 'FAIL',
      governance_evidence: proof.evidence_id ? 'PASS' : 'FAIL',
      canvas_rescan: proof.canvas_transition ? 'PASS' : 'NOT_RUN',
      reason: null,
      proof: {
        task_id: proof.task_id,
        capability_id: proof.capability_id,
        operation_id: proof.operation_id,
        implementation_type: proof.implementation,
        implementation_id: proof.implementation_id,
        execution_status: proof.execution_status,
        verification_status: proof.verification_status,
        evidence_id: proof.evidence_id,
        proof_path: proof.proof_path,
      },
      note: 'Real OpenHands execution completed through ForgeOS governed lifecycle',
    };
  }

  let classification = 'LIVE_RUNTIME_FAILURE';
  if (proof.reason?.startsWith('verification_')) classification = 'LIVE_VERIFICATION_FAILURE';
  if (proof.reason?.includes('policy')) classification = 'LIVE_POLICY_FAILURE';

  return {
    ...base,
    completed_at: completedAt,
    ok: false,
    stage16: 'BLOCKED',
    classification,
    live_e2e: proof.live_e2e || 'BLOCKED',
    real_execution: proof.execution_status === 'COMPLETED' ? 'PASS' : 'BLOCKED',
    real_project_effect: proof.project_effect ? 'PASS' : 'FAIL',
    forgeos_verification: proof.verification_status || 'FAIL',
    governance_evidence: proof.evidence_id ? 'PASS' : 'FAIL',
    canvas_rescan: 'NOT_RUN',
    reason: proof.reason || 'live_proof_failed',
    proof: {
      task_id: proof.task_id || null,
      verification_status: proof.verification_status || null,
      execution_status: proof.execution_status || null,
      evidence_id: proof.evidence_id || null,
    },
    note: 'Live attempt did not meet LIVE_PASS criteria; runtime success ≠ verification PASS',
  };
}
