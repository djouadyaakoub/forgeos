/**
 * Project Assessment Engine — Stage 8
 *
 * WHAT needs attention. Never executes tasks or runtimes.
 */
import { getCanonicalVersion } from '../../policy/version.mjs';
import { loadCapabilityBindings, CAPABILITY_STATES, capabilityBindingFingerprint } from '../capability/binding.mjs';
import { evaluateApplicability } from './applicability.mjs';
import { collectProjectFacts } from './facts.mjs';
import { runAssessmentModule } from './modules.mjs';
import { resolveCapability } from '../capability/resolver.mjs';
import { buildProjectCanvas } from './canvas.mjs';
import { buildTaskCandidateFromAssessment, selectOperationCandidatesForAssessment } from './task-candidate.mjs';
import { pickPreferredOperationCandidate } from '../capability/operation-selection.mjs';
import { computeEvidenceFingerprint } from '../orchestrator/fingerprints.mjs';
import {
  buildAssessmentArtifact,
  writeAssessmentArtifact,
  listAssessmentArtifacts,
  latestArtifactForCapability,
  computeInputFingerprint,
  evaluateEvidenceFreshness,
  mergeVerifiedState,
  loadVerifiedRecords,
} from './evidence.mjs';
import { collectStructuralIntelligence } from '../adapters/index.mjs';
import { assessProjectKnowledge } from './knowledge.mjs';

function normalizeSeverity(value) {
  const v = String(value || 'info').toLowerCase();
  if (['critical', 'high', 'medium', 'low', 'info'].includes(v)) return v;
  return 'info';
}

function deriveState(applicability, moduleResult, binding, facts) {
  if (applicability === 'NOT_APPLICABLE') {
    return {
      state: 'NOT_APPLICABLE',
      confidence: 'HIGH',
      severity: 'info',
      rationale: 'Capability not applicable to this project context',
    };
  }
  if (applicability === 'UNKNOWN') {
    return {
      state: 'UNKNOWN',
      confidence: 'LOW',
      severity: binding.default_severity,
      rationale: 'Applicability could not be determined from project facts',
    };
  }

  const findings = moduleResult.findings || [];
  const hasNegative = moduleResult.negative_evidence === true;
  const hasPartial = moduleResult.partial_evidence === true;
  const hasPositive = moduleResult.positive_evidence === true;

  if (binding.verification_strategy === 'presence') {
    if (!facts.initialized && binding.applicability !== 'always') {
      return {
        state: 'NOT_CONFIGURED',
        confidence: 'MEDIUM',
        severity: binding.default_severity,
        rationale: 'Project intelligence not initialized for this capability',
      };
    }
  }

  if (hasNegative) {
    const sev = findings.some((f) => f.severity === 'critical') ? 'critical'
      : findings.some((f) => f.severity === 'high') ? 'high'
        : normalizeSeverity(binding.default_severity);
    return {
      state: sev === 'critical' || sev === 'high' ? 'NEEDS_IMPROVEMENT' : 'PARTIAL',
      confidence: 'MEDIUM',
      severity: sev,
      rationale: moduleResult.rationale,
    };
  }

  if (hasPartial || findings.length > 0) {
    return {
      state: 'PARTIAL',
      confidence: 'MEDIUM',
      severity: normalizeSeverity(binding.default_severity),
      rationale: moduleResult.rationale,
    };
  }

  if (hasPositive) {
    return {
      state: 'PARTIAL',
      confidence: 'MEDIUM',
      severity: 'info',
      rationale: `${moduleResult.rationale} — requires verification pass for SATISFIED`,
    };
  }

  if (!facts.initialized) {
    return {
      state: 'UNKNOWN',
      confidence: 'LOW',
      severity: binding.default_severity,
      rationale: 'Insufficient project context for assessment',
    };
  }

  return {
    state: 'UNKNOWN',
    confidence: 'LOW',
    severity: binding.default_severity,
    rationale: moduleResult.rationale || 'No evidence collected',
  };
}

function buildRecommendedAction(binding, assessment, facts) {
  if (['SATISFIED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(assessment.state)) {
    return null;
  }
  const specialist = binding.specialist_ids?.[0] || 'orchestrator';
  return {
    capability_id: binding.id,
    description: `Address ${binding.id} gaps: ${assessment.rationale}`,
    specialist_id: specialist,
    objective: `Improve ${binding.id} for project ${facts.project_id || 'target'} according to ForgeOS capability rules`,
    scope: binding.domains || [],
    rationale: assessment.rationale,
    severity: assessment.severity,
    expected_evidence: binding.evidence_schema,
    verification_strategy: binding.verification_strategy,
  };
}

export function assessCapability(binding, projectDir, facts, options = {}) {
  const applicabilityResult = evaluateApplicability(binding, facts);
  const applicability = applicabilityResult.applicability;

  let moduleResult = {
    module: binding.assessment_module,
    findings: [],
    summary: { total: 0 },
    rationale: 'Skipped — not applicable',
  };

  if (applicability === 'APPLICABLE') {
    moduleResult = runAssessmentModule(binding, projectDir, facts);
  }

  const derived = deriveState(applicability, moduleResult, binding, facts);
  const previous = options.previous_artifacts
    ? latestArtifactForCapability(options.previous_artifacts, binding.id)
    : null;
  const freshness = evaluateEvidenceFreshness(previous?.artifact, facts, {
    input_fingerprint: options.input_fingerprint,
    binding_fingerprint: options.binding_fingerprint,
  });

  let assessment = {
    capability_id: binding.id,
    canvas_category: binding.canvas_category,
    applicability,
    state: derived.state,
    confidence: derived.confidence,
    severity: derived.severity,
    evidence: moduleResult.findings || [],
    evidence_timestamp: new Date().toISOString(),
    freshness_ttl: binding.freshness_ttl,
    stale: freshness.stale,
    stale_reasons: freshness.reasons,
    rationale: derived.rationale,
    assessment_module: binding.assessment_module,
    recommended_action: null,
    verification: {
      strategy: binding.verification_strategy,
      commands: facts.verification_commands || [],
      status: derived.state === 'SATISFIED' ? 'passed' : 'pending',
    },
  };

  if (options.verified_records?.[binding.id]) {
    assessment = mergeVerifiedState(assessment, options.verified_records[binding.id], {
      fingerprints: options.fingerprints,
      expected_strategy: options.expected_strategy || binding.verification_strategy,
      now: options.now,
    });
  }

  assessment.recommended_action = buildRecommendedAction(binding, assessment, facts);
  assessment.evidence_source = moduleResult.evidence_source || null;
  assessment.analyzer = moduleResult.analyzer || null;
  assessment.evidence_class = moduleResult.evidence_class || null;
  return assessment;
}

export function runProjectAssessment(input = {}) {
  const projectDir = input.project_dir || process.cwd();
  const baseFacts = input.facts || collectProjectFacts(projectDir, input);

  // Stage 13 — derived structural intelligence (never mutates Project Intelligence)
  const structural = input.skip_structural === true
    ? {
      structural_facts: null,
      structural_analysis_ok: false,
      deterministic_intelligence_available: false,
      evidence_class: 'insufficient',
      structural_availability: null,
    }
    : collectStructuralIntelligence(projectDir, baseFacts, {
      use_cache: input.use_structural_cache !== false,
      persist_cache: input.persist_structural_cache === true,
      changed_files: input.changed_files,
      max_files: input.max_files,
    });

  const facts = {
    ...baseFacts,
    ...structural,
    changed_files: input.changed_files || baseFacts.changed_files || [],
  };

  const bindings = input.bindings || loadCapabilityBindings(input.binding_options);
  const inputFingerprint = input.input_fingerprint || computeInputFingerprint(facts, bindings);
  const bindingFingerprint = input.binding_fingerprint || capabilityBindingFingerprint(bindings);

  const previousArtifacts = input.persist === false
    ? []
    : listAssessmentArtifacts(projectDir, input);

  const verifiedRecords = {
    ...loadVerifiedRecords(projectDir, input),
    ...(input.verified_records || {}),
  };

  const hostContext = input.host_context || {
    host_id: input.host_id || 'generic',
    capabilities: ['read', 'analyze', 'plan'],
  };

  const policyContext = input.policy_context || {};

  const capabilityAssessments = [];
  let taskSeq = 1;

  for (const binding of bindings.capabilities) {
    const verificationStrategy = ['documentation-sync','documentation-drift'].includes(binding.id)
      && verifiedRecords[binding.id]?.verification_strategy === 'finding_resolution' ? 'finding_resolution' : binding.verification_strategy;
    const fingerprints = computeEvidenceFingerprint(facts, {
      project_dir: projectDir,
      input_fingerprint: inputFingerprint,
      capability_binding_fingerprint: bindingFingerprint,
      verification_strategy: verificationStrategy,
      verification_presence: binding.id === 'documentation-sync' || binding.id === 'documentation-drift'
        ? ['AGENTS.md']
        : [],
      verification_commands: facts.verification_commands,
      bindings,
    });

    const assessment = assessCapability(binding, projectDir, facts, {
      previous_artifacts: previousArtifacts,
      input_fingerprint: inputFingerprint,
      binding_fingerprint: bindingFingerprint,
      verified_records: verifiedRecords,
      fingerprints,
      expected_strategy: verificationStrategy,
      now: input.now,
    });

    const operationSelection = selectOperationCandidatesForAssessment(binding, assessment, facts, {
      bindings,
    });
    const preferredOperation = pickPreferredOperationCandidate(operationSelection);

    const resolution = resolveCapability({
      capability_id: binding.id,
      capability_binding: binding,
      project_intelligence: facts.project_intelligence,
      host_context: hostContext,
      policy_context: policyContext,
      preference: input.preference,
      deterministic_intelligence_available: facts.deterministic_intelligence_available === true,
      facts,
      operation_id: preferredOperation?.operation_id,
      capability_operation: preferredOperation?.operation,
    });

    assessment.recommended_operation = preferredOperation
      ? {
        operation_id: preferredOperation.operation_id,
        risk: preferredOperation.risk,
        finding_ids: preferredOperation.finding_ids,
        verification_strategy: preferredOperation.verification_strategy,
        preferred_implementation: preferredOperation.operation.preferred_implementation,
      }
      : null;
    assessment.operation_candidates = (operationSelection.candidates || []).map((c) => ({
      operation_id: c.operation_id,
      risk: c.risk,
      finding_ids: c.finding_ids,
    }));

    const taskCandidate = buildTaskCandidateFromAssessment(binding, assessment, resolution, facts, {
      task_sequence: String(taskSeq++).padStart(3, '0'),
      operation_selection: operationSelection,
      operation_candidate: preferredOperation,
      bindings,
    });

    let artifactRecord = null;
    if (input.persist !== false && assessment.applicability === 'APPLICABLE') {
      const artifact = buildAssessmentArtifact({
        ...assessment,
        forgeos_version: getCanonicalVersion(),
        project_intelligence_contract_version: facts.contract_version,
        project_intelligence_fingerprint: facts.project_intelligence_fingerprint,
        capability_binding_fingerprint: bindingFingerprint,
        input_fingerprint: inputFingerprint,
      });
      artifactRecord = writeAssessmentArtifact(projectDir, artifact, input);
    }

    capabilityAssessments.push({
      binding,
      assessment,
      resolution,
      task_candidate: taskCandidate,
      artifact: artifactRecord,
    });
  }

  const canvas = buildProjectCanvas(
    capabilityAssessments.map((row) => ({
      assessment: {
        ...row.assessment,
        canvas_category: row.binding.canvas_category,
      },
      resolution: row.resolution,
      task_candidate: row.task_candidate,
    })),
    {
      project_dir: facts.project_dir,
      project_id: facts.project_id,
      assessed_at: new Date().toISOString(),
      forgeos_version: getCanonicalVersion(),
    }
  );

  return {
    phase: 'project_assessment',
    project_knowledge: input.skip_knowledge === true ? null : assessProjectKnowledge(projectDir, { max_files: input.max_files,
      interpretations: input.interpretations }),
    mode: 'assess_plan_only',
    execute: false,
    project: {
      dir: facts.project_dir,
      id: facts.project_id,
      initialized: facts.initialized,
      discovery_mode: facts.discovery_mode,
    },
    facts_summary: {
      has_source: facts.has_source,
      has_tests: facts.has_tests,
      has_docs: facts.has_docs,
      has_verification_commands: facts.has_verification_commands,
      project_type: facts.project_type,
      deterministic_intelligence_available: facts.deterministic_intelligence_available === true,
      structural_evidence_class: facts.structural_facts?.evidence_class || facts.evidence_class || null,
      structural_adapter_id: facts.structural_adapter_id || null,
    },
    structural_intelligence: {
      available: facts.deterministic_intelligence_available === true,
      adapter_id: facts.structural_adapter_id || null,
      evidence_class: facts.structural_facts?.evidence_class || 'insufficient',
      analysis_fingerprint: facts.structural_facts?.analysis_fingerprint || null,
      availability: facts.structural_availability || null,
      derived: true,
      authoritative: false,
    },
    bindings: {
      count: bindings.capabilities.length,
      source: bindings.source,
    },
    assessments: capabilityAssessments,
    canvas,
    policy_note: 'Assessment does not authorize or execute — Policy Authority remains separate',
    execution_note: 'No backend.start() invoked during assessment',
  };
}

export function validateAssessmentState(state) {
  return CAPABILITY_STATES.includes(state);
}
