/**
 * OpenHands Stage 15 live proof — minimal governed E2E
 *
 * Runs ONLY when environment live gate is READY.
 * Otherwise returns BLOCKED with exact reason (never fakes PASS).
 *
 * Uses coordinateGovernedExecution → executeGoverned only.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createOpenHandsBackend } from './index.mjs';
import { assessOpenHandsEnvironment } from './environment-gate.mjs';
import { createRuntimeRegistry } from '../../registry.mjs';
import { clearLifecycleStore } from '../../execution.mjs';
import { clearOpenHandsRuns } from './index.mjs';
import { getOperation } from '../../../intelligence/capability/operations.mjs';
import { resolveCapabilityOperation } from '../../../intelligence/capability/resolver.mjs';
import { coordinateGovernedExecution } from '../../../intelligence/orchestrator/governed.mjs';
import { assessCapabilityVerification } from '../../../intelligence/orchestrator/capability-verification.mjs';
import { createGovernanceEvidence } from '../../../intelligence/orchestrator/governance-evidence.mjs';

const PROOF_DOC = 'docs/project/openhands-stage15-proof.md';

function makeProofProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-oh-live-'));
  fs.mkdirSync(path.join(dir, '.agent-os'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'project'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agent-os', 'project.yaml'),
    `contract:
  version: 1
project:
  id: openhands-stage15-proof
  name: OpenHands Stage15 Proof
  type: application
  task_id_prefix: OH15
capabilities: []
agents: {}
ownership: []
verification:
  commands: []
policy:
  protected_paths: []
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# OpenHands Stage15 Proof\n');
  return dir;
}

/**
 * Attempt live OpenHands proof. Never fabricates success.
 */
export async function runOpenHandsLiveProof(input = {}) {
  const environment = assessOpenHandsEnvironment(input);
  if (environment.status !== 'READY' || !environment.live_capable) {
    return {
      ok: false,
      live_e2e: 'NOT_RUN',
      status: 'BLOCKED',
      reason: environment.reason || 'live_environment_blocked',
      environment: {
        status: environment.status,
        reason: environment.reason,
        openhands_version: environment.openhands_version,
        provider_configured: environment.provider_configured,
        agent_server_url_configured: environment.agent_server_url_configured,
        health: environment.health,
        ready: environment.ready,
        gate_chain: environment.gate_chain,
      },
      note: 'Live E2E not executed — do not label live integration PASS',
    };
  }

  clearLifecycleStore();
  clearOpenHandsRuns();

  const projectDir = input.project_dir || makeProofProject();
  const operation = getOperation('create-missing-project-docs')
    || getOperation('propose-module-reorganization');
  const resolution = resolveCapabilityOperation({
    operation_id: operation.id,
    preference: 'oss_backed',
    runtime_backend_id: 'openhands',
    host_context: { host_id: 'cli', capabilities: ['read'] },
  });

  const backend = createOpenHandsBackend({
    transport: 'http',
    baseUrl: input.baseUrl || process.env.OPENHANDS_AGENT_SERVER_URL,
    require_live_provider: true,
    provider_configured: true,
    llm_api_key: input.llm_api_key || process.env.OPENHANDS_LLM_API_KEY,
    model: input.model || process.env.OPENHANDS_MODEL,
    pollTimeoutMs: input.pollTimeoutMs || 120000,
  });

  const registry = createRuntimeRegistry();
  registry.register(backend);

  const taskId = input.task_id || 'OH15-create-missing-project-docs';
  const capabilityId = operation.capability_id;

  const result = coordinateGovernedExecution({
    project_dir: projectDir,
    task_id: taskId,
    capability_id: capabilityId,
    objective: `Create file ${PROOF_DOC} containing exactly: ForgeOS Stage 15 OpenHands live proof. Do not modify other paths.`,
    execute: true,
    execution_id: input.execution_id || `oh15-live-${Date.now()}`,
    operation: {
      type: 'write_file',
      path: PROOF_DOC,
      content: 'ForgeOS Stage 15 OpenHands live proof\n',
    },
    allowed_paths: ['docs/**', PROOF_DOC],
    agent_id: 'docs-sync',
    runtime_registry: registry,
    backend_id: 'openhands',
  });

  const governed = result.governed || result;
  const verification = assessCapabilityVerification({
    governed,
    candidate: {
      task_id: taskId,
      capability_id: capabilityId,
      verification_strategy: 'presence',
      verification_presence: [PROOF_DOC],
    },
    project_dir: projectDir,
  });

  const evidence = createGovernanceEvidence({
    task_id: taskId,
    capability_id: capabilityId,
    execution_id: governed.execution_id,
    verification,
    lifecycle_status: governed.status,
    rationale: verification.reason,
    source_references: {
      verification: 'intelligence/orchestrator/capability-verification.mjs',
      runtime: 'runtime/adapters/openhands',
      policy: 'policy/authority.mjs',
    },
  });

  const fileExists = fs.existsSync(path.join(projectDir, PROOF_DOC));
  const pass = verification.result === 'PASS'
    && fileExists
    && governed.status === 'COMPLETED';

  return {
    ok: pass,
    live_e2e: pass ? 'PASS' : 'BLOCKED',
    status: pass ? 'READY' : 'BLOCKED',
    reason: pass
      ? null
      : (verification.result !== 'PASS'
        ? `verification_${verification.result}`
        : `execution_status_${governed.status}`),
    environment: {
      status: environment.status,
      openhands_version: environment.openhands_version,
      provider_configured: true,
    },
    task_id: taskId,
    capability_id: capabilityId,
    operation_id: operation.id,
    implementation: resolution.implementation_type,
    implementation_id: resolution.implementation_id,
    execution_status: governed.status,
    verification_status: verification.result,
    evidence_id: evidence.evidence_id,
    project_effect: fileExists,
    proof_path: PROOF_DOC,
    runtime_evidence_kind: governed.runtime_evidence?.kind || null,
    governance_evidence_kind: governed.governance_evidence?.kind || null,
    note: 'OpenHands runtime success is not ForgeOS verification authority; no automatic fallback',
  };
}
