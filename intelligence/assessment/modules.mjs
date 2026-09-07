/**
 * Assessment module registry — ForgeOS-native read-only analyzers.
 * No runtime execution. No backend.start().
 * Stage 13: may consume derived StructuralFacts as evidence only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { structureAudit } from '../structure/analyzer.mjs';
import { detectDocumentationDrift } from '../documentation/drift.mjs';
import { architectureGuard } from '../architecture/guardian.mjs';
import { auditDependencies } from '../dependency/auditor.mjs';
import { analyzeTestStrategy } from '../testing/coverage-strategy.mjs';
import { assessReleaseReadiness } from '../release/readiness.mjs';
import { discoverDeploymentTargets } from '../deployment/discovery.mjs';
import { discoverEnvironments } from '../environment/discovery.mjs';
import { analyzeDeadCode } from '../dead-code/detector.mjs';
import { analyzeDuplication } from '../duplication/analyzer.mjs';
import { analyzeChangeImpact } from '../change-impact/analyzer.mjs';
import { deriveImpactSet } from '../adapters/structural-facts.mjs';
import { buildDependencyGraph, findCycles } from '../graph/index.mjs';

function finding(type, message, severity = 'medium', extra = {}) {
  return { type, message, severity, ...extra };
}

function summarizeFindings(findings = []) {
  const high = findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low = findings.filter((f) => f.severity === 'low' || f.severity === 'info').length;
  return { total: findings.length, high, medium, low };
}

function evidenceMeta(facts, deterministicFindings = []) {
  const sf = facts.structural_facts;
  if (sf?.evidence_class === 'deterministic' && (deterministicFindings.length > 0 || sf.status === 'ok')) {
    return {
      evidence_source: 'deterministic_structural',
      analyzer: sf.analyzer?.id || facts.structural_adapter_id || 'forgeos-structural',
      evidence_class: 'deterministic',
    };
  }
  if (sf?.evidence_class === 'heuristic') {
    return {
      evidence_source: 'heuristic_structural',
      analyzer: sf.analyzer?.id || null,
      evidence_class: 'heuristic',
    };
  }
  return {
    evidence_source: 'heuristic',
    analyzer: null,
    evidence_class: facts.has_source ? 'heuristic' : 'insufficient',
  };
}

function assessStructure(projectDir, facts, binding) {
  const audit = structureAudit(projectDir, facts.project_intelligence || {});
  const issues = audit?.structure_issues || audit?.issues || [];
  const findings = issues.map((i) =>
    finding(i.type || 'structure_issue', i.reason || i.message || 'Structure issue', i.severity || 'medium', {
      path: i.path || null,
      evidence_class: 'heuristic',
    })
  );

  const sf = facts.structural_facts;
  const structuralFindings = (sf?.findings || []).filter((f) =>
    [
      'misplaced_source_root',
      'mixed_language_directory',
      'high_structural_coupling',
      'unreferenced_export_file_candidate',
    ].includes(f.type)
  );
  for (const f of structuralFindings) {
    findings.push(finding(f.type, f.message, f.severity || 'medium', {
      path: f.path || null,
      confidence: f.confidence || null,
      fingerprint: f.fingerprint || null,
      evidence_class: sf.evidence_class || 'deterministic',
      candidate: f.candidate === true,
    }));
  }

  const meta = evidenceMeta(facts, structuralFindings);
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical')
    || findings.filter((f) => f.severity === 'medium').length >= 2;
  const partial = findings.length > 0 && !negative;
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: !findings.length && facts.has_source,
    partial_evidence: partial,
    ...meta,
    rationale: findings.length
      ? `${findings.length} structure issue(s) detected (${meta.evidence_class} evidence)`
      : facts.has_source
        ? `No structure issues detected (${meta.evidence_class} scan)`
        : 'No source tree to analyze — insufficient evidence',
  };
}

function assessDocumentation(projectDir, facts, binding) {
  const knowledge = facts.project_intelligence?.knowledge || {};
  const drift = detectDocumentationDrift(projectDir, knowledge);
  const findings = (drift.drift_items || []).map((d) =>
    finding(d.type || 'documentation_drift', d.issue || d.path || 'Documentation drift', d.severity || 'medium', {
      path: d.path || null,
    })
  );
  if (!facts.has_readme) {
    findings.push(finding('missing_readme', 'README.md not found', 'medium'));
  }
  if (!facts.has_agents_md && facts.initialized) {
    findings.push(finding('missing_agents_md', 'AGENTS.md not found for initialized project', 'low'));
  }
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  const partial = findings.length > 0 && !negative;
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_docs,
    partial_evidence: partial,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: findings.length
      ? `${findings.length} documentation gap(s) detected`
      : facts.has_docs
        ? 'Core documentation present'
        : 'Documentation presence could not be confirmed',
  };
}

function assessArchitecture(projectDir, facts, binding) {
  const guard = architectureGuard(projectDir, {
    knowledge: facts.project_intelligence?.knowledge || {},
  });
  const violations = guard?.violations || [];
  const findings = violations.map((v) =>
    finding('architecture_violation', v.rule || v.message || 'Architecture violation', v.severity || 'high', {
      file: v.file || null,
    })
  );
  if (!facts.has_architecture && facts.initialized) {
    findings.push(finding('missing_architecture_docs', 'Architecture documentation not detected', 'medium'));
  }
  const sf = facts.structural_facts;
  for (const f of (sf?.findings || []).filter((x) => x.type === 'high_structural_coupling')) {
    findings.push(finding(f.type, f.message, 'medium', {
      path: f.path,
      evidence_class: sf.evidence_class,
      fingerprint: f.fingerprint,
    }));
  }
  const meta = evidenceMeta(facts, findings.filter((f) => f.evidence_class === 'deterministic'));
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_architecture,
    partial_evidence: findings.length > 0 && !negative,
    ...meta,
    rationale: findings.length
      ? `${findings.length} architecture concern(s) detected`
      : facts.has_architecture
        ? 'Architecture documentation present; no violations in scan'
        : 'Architecture posture unknown',
  };
}

function assessDependencies(projectDir, facts, binding) {
  if (!facts.has_package_json && !fs.existsSync(path.join(projectDir, 'go.mod'))) {
    return {
      module: binding.assessment_module,
      findings: [],
      summary: summarizeFindings([]),
      negative_evidence: false,
      positive_evidence: false,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      rationale: 'No dependency manifest detected — insufficient evidence',
    };
  }
  let audit = { issues: [] };
  try {
    audit = auditDependencies(projectDir) || { issues: [] };
  } catch {
    audit = { issues: [] };
  }
  const issues = audit.issues || audit.findings || [];
  const findings = issues.map((i) =>
    finding(i.type || 'dependency_issue', i.message || i.reason || 'Dependency issue', i.severity || 'medium')
  );
  const sf = facts.structural_facts;
  const graph = facts.dependency_graph || (sf ? buildDependencyGraph(sf) : null);
  const external = (graph?.external_dependencies || []).length;
  if (sf?.status === 'ok') {
    findings.push(finding(
      'structural_external_imports',
      `${external} external import edge(s) observed in structural graph`,
      'info',
      { evidence_class: sf.evidence_class, count: external }
    ));
  }
  if (graph && (graph.unresolved_edges || []).length) {
    findings.push(finding(
      'unresolved_internal_import',
      `${graph.unresolved_edges.length} unresolved relative import(s) in structural graph`,
      'low',
      {
        evidence_class: sf?.evidence_class || 'deterministic',
        count: graph.unresolved_edges.length,
        note: 'Specifier present; target file not in inventory — not fabricated',
      }
    ));
  }
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  const meta = evidenceMeta(facts);
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.filter((f) => f.severity !== 'info').length === 0,
    partial_evidence: findings.filter((f) => f.severity !== 'info').length > 0 && !negative,
    ...meta,
    rationale: findings.filter((f) => f.severity !== 'info').length
      ? `${findings.length} dependency concern(s) detected`
      : 'No dependency issues detected in audit',
  };
}

function assessDeadCode(projectDir, facts, binding) {
  const heuristic = analyzeDeadCode(projectDir);
  const findings = (heuristic.candidates || []).map((c) =>
    finding('dead_code_candidate', `${c.candidate}: ${c.evidence}`, 'low', {
      path: c.candidate,
      confidence: c.confidence,
      candidate: true,
      evidence_class: 'heuristic',
      note: 'Unreferenced/heuristic candidate — not safe to delete automatically',
    })
  );

  const sf = facts.structural_facts;
  for (const f of (sf?.findings || []).filter((x) => x.type === 'unreferenced_export_file_candidate')) {
    findings.push(finding(f.type, f.message, 'low', {
      path: f.path,
      confidence: f.confidence || 'LOW',
      candidate: true,
      fingerprint: f.fingerprint,
      evidence_class: sf.evidence_class || 'deterministic',
      note: 'Unreferenced does not mean safe to delete',
    }));
  }

  const meta = evidenceMeta(facts, findings.filter((f) => f.evidence_class === 'deterministic'));
  if (!facts.has_source) {
    return {
      module: binding.assessment_module,
      findings: [],
      summary: summarizeFindings([]),
      negative_evidence: false,
      positive_evidence: false,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      rationale: 'Insufficient evidence — no source tree',
    };
  }

  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: false,
    positive_evidence: findings.length === 0,
    partial_evidence: findings.length > 0,
    ...meta,
    rationale: findings.length
      ? `${findings.length} dead-code candidate(s) — review only, no auto-delete`
      : `No dead-code candidates from ${meta.evidence_class} evidence`,
  };
}

function assessDuplication(projectDir, facts, binding) {
  const dup = analyzeDuplication(projectDir);
  const findings = [];
  for (const d of dup.exact_duplicates || []) {
    findings.push(finding('exact_duplicate', `Exact duplicate files: ${d.paths.join(', ')}`, 'high', {
      paths: d.paths,
      hash: d.hash,
      evidence_class: 'deterministic',
      confidence: 'HIGH',
      fingerprint: d.hash,
      scope: d.paths.join(','),
    }));
  }
  for (const d of dup.duplicate_filenames || []) {
    findings.push(finding('duplicate_filename', `Duplicate filename ${d.name}`, 'medium', {
      paths: d.paths,
      evidence_class: 'heuristic',
      confidence: 'MEDIUM',
    }));
  }
  const sf = facts.structural_facts;
  for (const f of (sf?.findings || []).filter((x) => x.type === 'duplicate_declaration_name_candidate')) {
    findings.push(finding(f.type, f.message, 'low', {
      path: f.path,
      fingerprint: f.fingerprint,
      confidence: f.confidence,
      evidence_class: sf.evidence_class,
      candidate: true,
      scope: f.scope,
    }));
  }
  const meta = evidenceMeta(facts, findings.filter((f) => f.evidence_class === 'deterministic'));
  const negative = findings.some((f) => f.severity === 'high');
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_source,
    partial_evidence: findings.length > 0 && !negative,
    ...meta,
    rationale: findings.length
      ? `${findings.length} duplication candidate(s) detected`
      : facts.has_source
        ? 'No duplication candidates detected'
        : 'Insufficient evidence',
  };
}

function assessChangeImpact(projectDir, facts, binding) {
  const changed = facts.changed_files || [];
  const sf = facts.structural_facts;
  if (!facts.has_source) {
    return {
      module: binding.assessment_module,
      findings: [],
      summary: summarizeFindings([]),
      negative_evidence: false,
      positive_evidence: false,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      rationale: 'Insufficient evidence for change-impact',
    };
  }

  const findings = [];
  if (!changed.length) {
    findings.push(finding(
      'change_impact_no_target',
      'No changed_files provided — impact set not computed (insufficient targeted evidence)',
      'info',
      { evidence_class: 'insufficient' }
    ));
    return {
      module: binding.assessment_module,
      findings,
      summary: summarizeFindings(findings),
      negative_evidence: false,
      positive_evidence: false,
      partial_evidence: true,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      analyzer: sf?.analyzer?.id || null,
      rationale: 'Change-impact requires an explicit changed file set — not manufactured',
    };
  }

  const impact = sf
    ? deriveImpactSet(sf, changed)
    : { dependents: [], impact_set: [...changed].sort(), evidence_class: 'insufficient' };

  const primary = changed[0];
  const heuristic = analyzeChangeImpact(primary, projectDir, {
    dependents: impact.dependents,
    ownership: facts.project_intelligence?.ownership || [],
  });

  findings.push(finding(
    'change_impact_set',
    `Impact set size ${impact.impact_set.length} (direct=${(impact.direct_dependents || []).length}, transitive=${(impact.transitive_dependents || []).length}) for ${changed.length} changed file(s)`,
    impact.dependents.length >= 5 ? 'medium' : 'info',
    {
      impact_set: impact.impact_set,
      dependents: impact.dependents,
      direct_dependents: impact.direct_dependents || [],
      transitive_dependents: impact.transitive_dependents || [],
      impact_direction: impact.impact_direction || 'files_affected_by_changing_targets',
      evidence_class: impact.evidence_class,
      confidence: sf?.evidence_class === 'deterministic' ? 'MEDIUM' : 'LOW',
      note: 'Intelligence only — structural importers, not a policy decision',
    }
  ));

  if (heuristic.requires_security_review) {
    findings.push(finding('change_impact_security_signal', `Security-sensitive path signal: ${primary}`, 'medium', {
      path: primary,
      evidence_class: 'heuristic',
    }));
  }

  const meta = evidenceMeta(facts, sf?.evidence_class === 'deterministic' ? findings : []);
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: false,
    positive_evidence: false,
    partial_evidence: true,
    ...meta,
    rationale: `Change-impact intelligence derived (${meta.evidence_class}); not authorization`,
  };
}

function assessTesting(projectDir, facts, binding) {
  const strategy = analyzeTestStrategy(projectDir, []);
  const findings = [];
  if (!facts.has_tests) {
    findings.push(finding('missing_tests', 'No test files detected', 'medium'));
  }
  if (facts.has_tests && !facts.has_verification_commands) {
    findings.push(finding('missing_verification_commands', 'Tests present but verification.commands not configured', 'low'));
  }
  if (strategy?.recommendations?.length) {
    const missing = strategy.recommendations.filter((r) => r.current_coverage === 'none_detected');
    if (missing.length) {
      findings.push(finding('test_gap', `${missing.length} changed path(s) without detected tests`, 'medium'));
    }
  }
  const negative = findings.some((f) => f.severity === 'high');
  const partial = findings.length > 0 && !negative;
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_tests && facts.has_verification_commands,
    partial_evidence: partial,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: findings.length
      ? `${findings.length} testing gap(s) detected`
      : facts.has_tests
        ? 'Tests and verification configuration detected'
        : 'Testing posture unknown or absent',
  };
}

function assessRelease(projectDir, facts, binding) {
  const readiness = assessReleaseReadiness(projectDir, {
    docs_drift: !facts.has_stack_doc,
    tests_passed: null,
    build_passed: null,
  });
  const blockers = readiness.release_readiness?.blockers || [];
  const warnings = readiness.release_readiness?.warnings || [];
  const findings = [
    ...blockers.map((b) => finding('release_blocker', b, 'high')),
    ...warnings.map((w) => finding('release_warning', w, 'medium')),
  ];
  if (!facts.has_verification_commands) {
    findings.push(finding('missing_verification', 'verification.commands not configured', 'medium'));
  }
  const negative = blockers.length > 0;
  const partial = warnings.length > 0 || (!facts.has_verification_commands && facts.initialized);
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_verification_commands,
    partial_evidence: partial && !negative,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: negative
      ? 'Release readiness blockers detected'
      : partial
        ? 'Release readiness gaps detected'
        : facts.has_verification_commands
          ? 'Release verification configuration present'
          : 'Release readiness not fully configured',
  };
}

function assessDeployment(projectDir, facts, binding) {
  const targets = discoverDeploymentTargets(projectDir, facts.project_intelligence || {});
  const findings = [];
  if (!facts.has_deployment && !(targets?.targets?.length)) {
    findings.push(finding('missing_deployment_profile', 'No deployment profile or targets detected', 'medium'));
  }
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && (facts.has_deployment || targets?.targets?.length),
    partial_evidence: findings.length > 0 && !negative,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: findings.length
      ? 'Deployment configuration incomplete'
      : facts.has_deployment || targets?.targets?.length
        ? 'Deployment configuration detected'
        : 'Deployment applicability only — configuration not assessed',
  };
}

function assessEnvironment(projectDir, facts, binding) {
  const envs = discoverEnvironments(projectDir, facts.project_intelligence || {});
  const findings = [];
  if (!envs?.environments?.length && facts.initialized) {
    findings.push(finding('missing_environment_discovery', 'No environments discovered', 'low'));
  }
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: false,
    positive_evidence: envs?.environments?.length > 0,
    partial_evidence: findings.length > 0,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: envs?.environments?.length
      ? `${envs.environments.length} environment(s) discovered`
      : 'Environment configuration not fully detected',
  };
}

function assessSecurity(projectDir, facts, binding) {
  const findings = [];
  if (facts.initialized && !facts.has_protected_paths) {
    findings.push(finding('missing_protected_paths', 'No project protected_paths declared', 'low'));
  }
  const envExample = ['.env.example', '.env.sample', 'env.example'];
  const hasEnvExample = envExample.some((f) => fs.existsSync(path.join(projectDir, f)));
  if (facts.has_package_json && !hasEnvExample) {
    findings.push(finding('missing_env_example', 'No .env.example detected for configured project', 'low'));
  }
  const negative = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: negative,
    positive_evidence: findings.length === 0 && facts.has_protected_paths,
    partial_evidence: findings.length > 0 && !negative,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: findings.length
      ? `${findings.length} security configuration gap(s) detected`
      : 'No security configuration gaps detected in heuristic scan',
  };
}

function assessGeneric(projectDir, facts, binding) {
  const findings = [];
  if (!facts.initialized) {
    return {
      module: binding.assessment_module,
      findings,
      summary: summarizeFindings(findings),
      negative_evidence: false,
      positive_evidence: false,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      rationale: 'Project not initialized — capability not assessable beyond applicability',
    };
  }
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: false,
    positive_evidence: true,
    evidence_source: 'heuristic',
    evidence_class: 'heuristic',
    rationale: 'No negative signals in generic assessment',
  };
}

function assessGraph(projectDir, facts, binding) {
  const sf = facts.structural_facts;
  if (!facts.has_source) {
    return {
      module: binding.assessment_module,
      findings: [],
      summary: summarizeFindings([]),
      negative_evidence: false,
      positive_evidence: false,
      evidence_class: 'insufficient',
      evidence_source: 'insufficient',
      rationale: 'Insufficient evidence for dependency graph',
    };
  }

  const graph = facts.dependency_graph || (sf ? buildDependencyGraph(sf) : null);
  const findings = [];
  if (graph) {
    findings.push(finding(
      'dependency_graph_summary',
      `Dependency graph nodes=${graph.node_count} internal_edges=${graph.edge_count} unresolved=${(graph.unresolved_edges || []).length}`,
      'info',
      {
        node_count: graph.node_count,
        edge_count: graph.edge_count,
        graph_fingerprint: graph.graph_fingerprint,
        source_analysis_fingerprint: graph.source_analysis_fingerprint,
        evidence_class: graph.source_evidence_class || sf?.evidence_class,
        note: 'Derived graph intelligence — not verification PASS, not Canvas SATISFIED, not dead-code',
      }
    ));
    for (const c of findCycles(graph)) {
      findings.push(finding(
        'circular_import',
        `Circular import among ${c.nodes.join(' → ')}`,
        'medium',
        {
          nodes: c.nodes,
          evidence_class: graph.source_evidence_class || 'deterministic',
          note: 'Structural cycle only — not authorization and not dead-code',
        }
      ));
    }
  }

  const meta = evidenceMeta(facts, graph?.source_evidence_class === 'deterministic' ? findings : []);
  return {
    module: binding.assessment_module,
    findings,
    summary: summarizeFindings(findings),
    negative_evidence: false,
    positive_evidence: false,
    partial_evidence: findings.some((f) => f.type === 'circular_import'),
    ...meta,
    rationale: graph
      ? `Graph derived (${graph.node_count} nodes); not a policy or verification authority`
      : 'No graph derived',
  };
}

const MODULE_HANDLERS = Object.freeze({
  'forgeos.assessment.structure': assessStructure,
  'forgeos.assessment.documentation': assessDocumentation,
  'forgeos.assessment.architecture': assessArchitecture,
  'forgeos.assessment.dependencies': assessDependencies,
  'forgeos.assessment.dead_code': assessDeadCode,
  'forgeos.assessment.duplication': assessDuplication,
  'forgeos.assessment.change_impact': assessChangeImpact,
  'forgeos.assessment.graph': assessGraph,
  'forgeos.assessment.testing': assessTesting,
  'forgeos.assessment.release': assessRelease,
  'forgeos.assessment.deployment': assessDeployment,
  'forgeos.assessment.environment': assessEnvironment,
  'forgeos.assessment.security': assessSecurity,
  'forgeos.assessment.generic': assessGeneric,
});

export function runAssessmentModule(binding, projectDir, facts) {
  const handler = MODULE_HANDLERS[binding.assessment_module] || assessGeneric;
  return handler(projectDir, facts, binding);
}

export function listAssessmentModules() {
  return Object.keys(MODULE_HANDLERS);
}
