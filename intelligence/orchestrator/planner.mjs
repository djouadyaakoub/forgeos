/**
 * Development Intelligence Planner — adaptive workflow generation
 *
 * Planner decides recommended workflow.
 * Orchestrator coordinates execution.
 * Policy Engine decides ALLOW/BLOCK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyTaskClasses, taskClassLabel, TASK_CLASSES } from './classification.mjs';
import { estimateComplexity } from './complexity.mjs';
import { assessTaskRisk } from './risk-assessment.mjs';
import {
  shouldTriggerResearch,
  shouldTriggerStructure,
  shouldTriggerArchitecture,
  shouldTriggerSecurity,
  shouldTriggerDocs,
  shouldTriggerArchaeology,
  shouldTriggerQA,
  shouldTriggerRelease,
  shouldTriggerDeployment,
} from './triggers.mjs';
import { discoverDeploymentTargets } from '../deployment/discovery.mjs';
import {
  discoverCapabilities,
  discoverAgents,
  selectBestSpecialist,
  findSpecialistsForDomains,
} from './scoring.mjs';
import { detectActionType, isReadOnlyAction } from './action-risk.mjs';
import { detectDeploymentIntent, formatDeploymentIntentExplanation } from './deployment-intent.mjs';

function loadProjectKnowledge(projectDir, knowledge = {}) {
  const result = { adrs: [], research: [], architecture: null, sufficient: false };
  if (!projectDir) return result;

  const adrPath = knowledge.adr ? path.join(projectDir, knowledge.adr) : path.join(projectDir, 'docs/adr');
  if (fs.existsSync(adrPath)) result.adrs.push(adrPath);

  const researchDir = path.join(projectDir, 'docs/agents/research');
  if (fs.existsSync(researchDir)) {
    result.research = fs.readdirSync(researchDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.json'));
  }

  const archPath = knowledge.architecture ? path.join(projectDir, knowledge.architecture) : path.join(projectDir, 'docs/architecture');
  if (fs.existsSync(archPath)) result.architecture = archPath;

  result.sufficient = result.adrs.length > 0 || result.research.length > 0 || !!result.architecture;
  return result;
}

function buildStage(name, agent, capability, reason, options = {}) {
  return {
    name,
    agent,
    capability: capability || null,
    reason,
    required: options.required !== false,
    parallelizable: options.parallelizable || false,
    depends_on: options.depends_on || [],
    handoff: {
      inputs: options.inputs || [],
      outputs: options.outputs || [`${name}_result`],
      evidence_required: options.evidence_required || [],
      blockers: [],
    },
  };
}

function selectDomainSpecialists(agents, capabilities, domains, request, context) {
  const specialists = findSpecialistsForDomains(agents, domains, capabilities);
  if (specialists.length) return specialists;

  const text = `${request.objective || ''}`.toLowerCase();
  if (/backend|queue|api|go\b/i.test(text)) {
    const backend = Object.keys(agents).find((id) => /backend|api/i.test(id));
    if (backend) return [{ id: backend, ...agents[backend] }];
  }
  if (/mobile|flutter/i.test(text)) {
    const mobile = Object.keys(agents).find((id) => /mobile|flutter/i.test(id));
    if (mobile) return [{ id: mobile, ...agents[mobile] }];
  }

  const best = selectBestSpecialist(
    Object.entries(agents).map(([id, cfg]) => ({ id, ...cfg })),
    request,
    context
  );
  return best ? [{ id: best.agent_id, score: best.score }] : [];
}

/**
 * Main planner entry point
 */
export function planDevelopmentIntelligenceWorkflow(request = {}, context = {}) {
  const projectDir = context.project_dir || request.project_dir;
  const projectAdapter = context.project_adapter || context.manifest?.data || context.manifest || {};
  const policy = context.policy || {};
  const registry = context.registry || { capabilities: context.capabilities || [] };
  const knowledge = context.project_knowledge || projectAdapter.knowledge || {};
  const projectKnowledge = loadProjectKnowledge(projectDir, knowledge);

  if (request._force_classes) {
    request.project_signals = { ...request.project_signals, force_classes: request._force_classes };
  }

  const classification = classifyTaskClasses(request);
  const complexity = estimateComplexity(request, { project_signals: projectAdapter.signals });
  const deploymentIntent = detectDeploymentIntent(request);
  const actionType = detectActionType(request);
  const readOnly = isReadOnlyAction(request);
  const risk = assessTaskRisk(request, context);

  const triggerContext = {
    complexity,
    task_classes: classification.task_classes,
    project_knowledge: projectKnowledge,
    project_dir: projectDir,
    deployment_intent: deploymentIntent,
    knowledge_sufficient: request.knowledge_sufficient || (
      classification.task_classes.includes(TASK_CLASSES.INVESTIGATION) && projectKnowledge.sufficient
    ),
  };

  const researchTrigger = shouldTriggerResearch(request, triggerContext);
  const structureTrigger = shouldTriggerStructure(request, triggerContext);
  const architectureTrigger = shouldTriggerArchitecture(request, triggerContext);
  const securityTrigger = shouldTriggerSecurity(request);
  const docsTrigger = shouldTriggerDocs(request, triggerContext);
  const archaeologyTrigger = shouldTriggerArchaeology(request);
  const qaTrigger = shouldTriggerQA(request, triggerContext);
  const releaseTrigger = shouldTriggerRelease(request, triggerContext);
  const deploymentDiscovery = projectDir
    ? discoverDeploymentTargets({ project_dir: projectDir, project_adapter: projectAdapter })
    : { targets: [], count: 0 };
  const deploymentTrigger = shouldTriggerDeployment(request, {
    ...triggerContext,
    deployment_targets: deploymentDiscovery,
  });

  const capabilities = discoverCapabilities(registry, projectAdapter);
  const agents = discoverAgents(policy, projectAdapter);

  const stages = [];
  const requiredCapabilities = [];
  const recommendedAgents = [];
  const skippedAgents = [];
  const skippedReasons = {};
  const decisionTrace = {
    triggers: [],
    candidates: [],
    selected: [],
    skipped: [],
    explanations: [],
  };

  function recordTrigger(name, result) {
    decisionTrace.triggers.push({ name, required: result.required, reason: result.reason });
  }

  function addStage(stage) {
    stages.push(stage);
    if (stage.agent && !recommendedAgents.includes(stage.agent)) recommendedAgents.push(stage.agent);
    if (stage.capability && !requiredCapabilities.includes(stage.capability)) requiredCapabilities.push(stage.capability);
    decisionTrace.selected.push({ stage: stage.name, agent: stage.agent, capability: stage.capability });
  }

  function skipAgent(agent, reason) {
    skippedAgents.push(agent);
    skippedReasons[agent] = reason;
    decisionTrace.skipped.push({ agent, reason });
  }

  recordTrigger('research', researchTrigger);
  recordTrigger('structure', structureTrigger);
  recordTrigger('architecture', architectureTrigger);
  recordTrigger('security', securityTrigger);
  recordTrigger('deployment', deploymentTrigger);
  decisionTrace.explanations.push(formatDeploymentIntentExplanation(deploymentIntent));

  const isSimpleExplain = /explain\b/i.test(`${request.objective || ''}`) && complexity.level === 'LOW' && readOnly;
  const isReadOnlyInvestigation =
    classification.task_classes.includes(TASK_CLASSES.INVESTIGATION) && readOnly;

  if (isReadOnlyInvestigation || isSimpleExplain) {
    skipAgent('solution-research', 'Known domain — no uncertainty');
    skipAgent('architect', readOnly ? 'Read-only investigation' : 'Low complexity investigation');
    if (!securityTrigger.required) skipAgent('security', 'No sensitive domain');
    skipAgent('release-readiness', 'Not a release task');

    const domainSpecs = selectDomainSpecialists(agents, capabilities, request.domains || ['backend'], request, {
      ...triggerContext,
      risk,
    });
    const specialist = domainSpecs[0]?.id || 'specialist';
    addStage(buildStage('specialist-execution', specialist, null, 'Domain specialist for investigation', {
      evidence_required: ['files_inspected'],
    }));

    if (deploymentTrigger.discovery_only || deploymentIntent.discovery_only) {
      addStage(buildStage('deployment-discovery', 'release-deployment', 'deployment-discovery', `Targets: ${deploymentDiscovery.count} discovered`, {
        depends_on: ['specialist-execution'],
        required: false,
      }));
    } else {
      skipAgent('release-deployment', 'No deployment intent');
    }

    if (securityTrigger.required && readOnly) {
      addStage(buildStage('security-review', 'security', 'auth-review', securityTrigger.reason, {
        depends_on: ['specialist-execution'],
        required: false,
      }));
    }

    addStage(buildStage('verification', 'qa-bugfix', 'test-coverage-strategy', 'Confirm understanding', {
      required: false,
      evidence_required: [],
    }));
  } else if (classification.task_classes.includes(TASK_CLASSES.BUG_FIX)) {
    addStage(buildStage('investigation', 'qa-bugfix', 'reproduce-bug', 'Reproduce-first debugging'));
    const domainSpecs = selectDomainSpecialists(agents, capabilities, request.domains || [], request, { risk });
    addStage(buildStage('specialist-fix', domainSpecs[0]?.id || 'specialist', null, 'Apply minimal fix', {
      depends_on: ['investigation'],
    }));
    addStage(buildStage('test-strategy', 'qa-bugfix', 'test-coverage-strategy', 'Verify test coverage', {
      depends_on: ['specialist-fix'],
    }));
    addStage(buildStage('qa-verification', 'qa-bugfix', 'reproduce-bug', 'Verify fix', {
      depends_on: ['test-strategy'],
    }));
    skipAgent('solution-research', 'Bug fix — no research needed');
    skipAgent('release-readiness', 'Not a release task');
  } else if (classification.task_classes.includes(TASK_CLASSES.REFACTOR)
    || classification.task_classes.includes(TASK_CLASSES.PROJECT_ORGANIZATION)) {
    addStage(buildStage('change-impact', 'architect', 'change-impact', 'Assess change impact', {
      evidence_required: ['files_inspected'],
    }));
    if (architectureTrigger.required) {
      addStage(buildStage('architecture-guard', 'architect', 'architecture-guard', architectureTrigger.reason, {
        depends_on: ['change-impact'],
      }));
    }
    if (structureTrigger.required || classification.task_classes.includes(TASK_CLASSES.PROJECT_ORGANIZATION)) {
      if (archaeologyTrigger.required) {
        addStage(buildStage('project-archaeology', 'project-archaeology', 'project-archaeology', archaeologyTrigger.reason, {
          parallelizable: true,
        }));
      }
      addStage(buildStage('structure-audit', 'codebase-organization', 'structure-audit', 'Structure health check', {
        depends_on: ['change-impact'],
      }));
      addStage(buildStage('structure-plan', 'codebase-organization', 'codebase-organization', 'Produce Structure Plan', {
        depends_on: ['structure-audit'],
        evidence_required: ['decision'],
      }));
    }
    addStage(buildStage('safe-refactor', 'codebase-organization', 'safe-refactor', 'Behavior-preserving refactor', {
      depends_on: structureTrigger.required ? ['structure-plan'] : ['change-impact'],
    }));
    addStage(buildStage('tests', 'qa-bugfix', 'test-coverage-strategy', 'Run tests', {
      depends_on: ['safe-refactor'],
      evidence_required: ['commands_run'],
    }));
    if (structureTrigger.required) {
      addStage(buildStage('structure-verification', 'codebase-organization', 'structure-audit', 'Verify structure', {
        depends_on: ['tests'],
      }));
    }
    skipAgent('solution-research', 'Refactor — project knowledge preferred');
    skipAgent('release-readiness', 'Not a release task');
  } else if (classification.task_classes.includes(TASK_CLASSES.RESEARCH)
    || (classification.task_classes.includes(TASK_CLASSES.FEATURE) && researchTrigger.required)) {
    if (researchTrigger.required) {
      addStage(buildStage('research', 'solution-research', 'solution-research', researchTrigger.reason, {
        evidence_required: ['sources_consulted', 'decision'],
        parallelizable: false,
      }));
    } else {
      skipAgent('solution-research', researchTrigger.reason);
    }
    if (architectureTrigger.required) {
      addStage(buildStage('architecture-review', 'architect', 'cross-cutting-design', architectureTrigger.reason, {
        depends_on: researchTrigger.required ? ['research'] : [],
        parallelizable: !researchTrigger.required,
      }));
    }
    if (!classification.task_classes.includes(TASK_CLASSES.RESEARCH)) {
      addStage(buildStage('change-impact', 'architect', 'change-impact', 'Assess implementation impact', {
        depends_on: architectureTrigger.required ? ['architecture-review'] : (researchTrigger.required ? ['research'] : []),
      }));
      const domains = request.domains?.length ? request.domains : ['backend', 'mobile'];
      const specs = selectDomainSpecialists(agents, capabilities, domains, request, { risk });
      let prevStage = 'change-impact';
      const implStages = [];
      for (const spec of specs.slice(0, 3)) {
        const stageName = `implementation-${spec.id}`;
        addStage(buildStage(stageName, spec.id, null, `Domain implementation: ${spec.id}`, {
          depends_on: [prevStage],
          parallelizable: specs.length > 1,
        }));
        implStages.push(stageName);
      }
      if (implStages.length > 1) {
        addStage(buildStage('integration-verification', 'qa-bugfix', 'test-coverage-strategy', 'Cross-component integration', {
          depends_on: implStages,
        }));
      }
    }
    skipAgent('release-readiness', 'Not a release task unless requested');
  } else if (classification.task_classes.includes(TASK_CLASSES.RELEASE) || deploymentTrigger.execution) {
    addStage(buildStage('change-impact', 'architect', 'change-impact', 'Assess deployable impact', {
      evidence_required: ['files_inspected'],
    }));
    addStage(buildStage('tests', 'qa-bugfix', 'test-coverage-strategy', 'Pre-release tests', {
      depends_on: ['change-impact'],
      evidence_required: ['commands_run'],
    }));
    if (securityTrigger.required) {
      addStage(buildStage('security-review', 'security', 'auth-review', securityTrigger.reason, {
        depends_on: ['tests'],
      }));
    }
    if (deploymentTrigger.environment_audit_required) {
      addStage(buildStage('environment-audit', 'environment-config', 'environment-audit', 'Production environment gate', {
        depends_on: securityTrigger.required ? ['security-review'] : ['tests'],
      }));
    }
    const readinessDeps = [];
    if (deploymentTrigger.environment_audit_required) readinessDeps.push('environment-audit');
    else if (securityTrigger.required) readinessDeps.push('security-review');
    else readinessDeps.push('tests');
    addStage(buildStage('release-readiness', 'release-readiness', 'release-readiness', 'Release assessment — required before deployment', {
      depends_on: readinessDeps,
      evidence_required: ['decision'],
    }));
    addStage(buildStage('deployment-discovery', 'release-deployment', 'deployment-discovery', `Targets: ${deploymentDiscovery.count} discovered`, {
      depends_on: ['release-readiness'],
    }));
    addStage(buildStage('deployment-plan', 'release-deployment', 'deployment-plan', 'Create Deployment Plan', {
      depends_on: ['deployment-discovery'],
      evidence_required: ['decision'],
    }));
    addStage(buildStage('deployment-build', 'release-deployment', 'deployment-build', 'Build artifacts', {
      depends_on: ['deployment-plan'],
      evidence_required: ['commands_run'],
    }));
    addStage(buildStage('deployment-approval', 'orchestrator', null, 'Tier 3 approval required for deploy', {
      depends_on: ['deployment-build'],
      required: deploymentTrigger.environment === 'production',
    }));
    addStage(buildStage('deployment-execute', 'release-deployment', 'deployment-execute', 'Execute approved deployment', {
      depends_on: ['deployment-approval', 'deployment-build'],
      evidence_required: ['decision'],
    }));
    addStage(buildStage('deployment-verify', 'release-deployment', 'deployment-verify', 'Health + smoke tests', {
      depends_on: ['deployment-execute'],
      evidence_required: ['commands_run'],
    }));
    addStage(buildStage('post-deploy-monitoring', 'release-deployment', 'post-deploy-monitoring', 'Bounded observation window', {
      depends_on: ['deployment-verify'],
      required: false,
    }));
    if (docsTrigger.required) {
      addStage(buildStage('docs-sync', 'docs-sync', 'documentation-sync', docsTrigger.reason, {
        depends_on: ['deployment-verify'],
      }));
      addStage(buildStage('release-notes', 'release-deployment', 'release-notes', 'Evidence-based release notes', {
        depends_on: ['docs-sync'],
      }));
    } else {
      addStage(buildStage('release-notes', 'release-deployment', 'release-notes', 'Evidence-based release notes', {
        depends_on: ['deployment-verify'],
      }));
    }
    skipAgent('solution-research', 'Release/deploy task');
  } else {
    if (researchTrigger.required) {
      addStage(buildStage('research', 'solution-research', 'solution-research', researchTrigger.reason, {
        evidence_required: ['sources_consulted'],
      }));
    } else {
      skipAgent('solution-research', researchTrigger.reason);
    }

    if (architectureTrigger.required) {
      addStage(buildStage('architecture-review', 'architect', 'cross-cutting-design', architectureTrigger.reason, {
        depends_on: researchTrigger.required ? ['research'] : [],
      }));
    } else {
      skipAgent('architect', architectureTrigger.reason || 'No architecture triggers');
    }

    const impactDeps = [];
    if (researchTrigger.required) impactDeps.push('research');
    if (architectureTrigger.required) impactDeps.push('architecture-review');
    if (complexity.level !== 'LOW' || classification.task_classes.includes(TASK_CLASSES.DATABASE)) {
      addStage(buildStage('change-impact', 'architect', 'change-impact', 'Impact analysis', {
        depends_on: impactDeps,
      }));
      impactDeps.push('change-impact');
    }

    const domainSpecs = selectDomainSpecialists(agents, capabilities, request.domains || [], request, { risk });
    const specialist = domainSpecs[0]?.id || 'specialist';
    addStage(buildStage('implementation', specialist, null, 'Domain specialist execution', {
      depends_on: impactDeps.length ? impactDeps : [],
      evidence_required: ['files_inspected'],
    }));

    if (qaTrigger.required) {
      addStage(buildStage('qa-verification', 'qa-bugfix', 'test-coverage-strategy', qaTrigger.reason, {
        depends_on: ['implementation'],
        evidence_required: ['commands_run'],
      }));
    } else {
      skipAgent('qa-bugfix', qaTrigger.reason);
    }

    skipAgent('release-readiness', 'Not a release task');
  }

  if (securityTrigger.required && !stages.some((s) => s.agent === 'security')) {
    const deps = stages.filter((s) => s.name.includes('implementation') || s.name === 'qa-verification').map((s) => s.name);
    addStage(buildStage('security-review', 'security', 'auth-review', securityTrigger.reason, {
      depends_on: deps.length ? deps : [],
      required: true,
    }));
  } else if (!securityTrigger.required) {
    skipAgent('security', securityTrigger.reason);
  }

  if (docsTrigger.required && !stages.some((s) => s.agent === 'docs-sync')) {
    const lastImpl = [...stages].reverse().find((s) =>
      s.name.includes('implementation') || s.name.includes('qa') || s.name === 'security-review'
    );
    addStage(buildStage('docs-sync', 'docs-sync', 'documentation-sync', docsTrigger.reason, {
      depends_on: lastImpl ? [lastImpl.name] : [],
      required: false,
    }));
  } else if (!docsTrigger.required) {
    skipAgent('docs-sync', docsTrigger.reason);
  }

  if (releaseTrigger.required && !stages.some((s) => s.agent === 'release-readiness')) {
    addStage(buildStage('release-readiness', 'release-readiness', 'release-readiness', releaseTrigger.reason, {
      depends_on: stages.length ? [stages[stages.length - 1].name] : [],
    }));
  }

  const verificationCommands = projectAdapter.verification?.commands?.map((c) => c.command || c.name) || ['build', 'test'];

  const developmentWorkflow = {
    task_class: taskClassLabel(classification.task_classes),
    complexity: complexity.level,
    risk: risk.level,
    objectives: [request.objective || request.description || ''].filter(Boolean),
    required_capabilities: requiredCapabilities,
    recommended_agents: recommendedAgents,
    stages,
    verification: {
      required: qaTrigger.required || complexity.level !== 'LOW',
      commands: verificationCommands,
    },
    security_review: {
      required: securityTrigger.required,
      reason: securityTrigger.reason,
      policy_authority: 'policy_engine',
    },
    architecture_review: {
      required: architectureTrigger.required,
      reason: architectureTrigger.reason,
    },
    research: {
      required: researchTrigger.required,
      reason: researchTrigger.reason,
    },
    documentation_sync: {
      required: docsTrigger.required,
      reason: docsTrigger.reason,
    },
    structure_review: {
      required: structureTrigger.required || classification.task_classes.includes(TASK_CLASSES.PROJECT_ORGANIZATION),
      reason: structureTrigger.reason,
    },
    deployment: {
      required: deploymentTrigger.execution,
      discovery_only: deploymentTrigger.discovery_only,
      reason: deploymentTrigger.reason,
      environment: deploymentTrigger.environment,
      targets_discovered: deploymentDiscovery.count,
      intent: deploymentIntent,
    },
    decision_trace: decisionTrace,
    action_type: actionType,
    subject_risk: risk.subject_risk,
    action_risk: risk.action_risk,
    skipped_agents: skippedAgents,
    skipped_reasons: skippedReasons,
    approval: {
      required: risk.requires_approval,
      scopes: risk.approval_scopes,
    },
    cost_awareness: {
      prefer_minimal_workflow: true,
      security_over_cost: true,
      correctness_over_cost: true,
    },
  };

  const workflowAgents = stages.map((s) => s.agent).filter(Boolean);
  const legacyTaskType = mapLegacyTaskType(classification, complexity, researchTrigger);

  return {
    development_workflow: developmentWorkflow,
    task_type: legacyTaskType,
    workflow: workflowAgents,
    capabilities: requiredCapabilities,
    security_review_required: securityTrigger.required,
    knowledge_update: complexity.level !== 'LOW',
    structure_plan_required: structureTrigger.required,
    research_before_implement: researchTrigger.required,
    classification,
    complexity,
    risk,
    action_type: actionType,
    subject_risk: risk.subject_risk,
    action_risk: risk.action_risk,
    deployment_intent: deploymentIntent,
    decision_trace: decisionTrace,
    user_summary: formatWorkflowSummary(developmentWorkflow),
  };
}

function mapLegacyTaskType(classification, complexity, researchTrigger) {
  const classes = classification.task_classes;
  if (classes.includes(TASK_CLASSES.RELEASE)) return 'release';
  if (classes.includes(TASK_CLASSES.REFACTOR) || classes.includes(TASK_CLASSES.PROJECT_ORGANIZATION)) return 'refactor';
  if (classes.includes(TASK_CLASSES.RESEARCH)) return 'research';
  if (researchTrigger.required && complexity.level !== 'LOW') return 'complex_feature';
  if (classes.includes(TASK_CLASSES.INVESTIGATION)) return 'simple_feature';
  if (complexity.level === 'HIGH' || complexity.level === 'CRITICAL') return 'complex_feature';
  return 'simple_feature';
}

export function formatWorkflowSummary(workflow) {
  const lines = [
    `Task classified as: ${workflow.task_class}`,
    `Complexity: ${workflow.complexity} | Risk: ${workflow.risk}`,
    '',
    'Planned:',
    ...workflow.stages.map((s) => `  - ${s.name} (${s.agent})${s.required ? '' : ' [optional]'}`),
  ];
  if (workflow.skipped_agents?.length) {
    lines.push('', 'Skipped:', ...workflow.skipped_agents.map((a) => `  - ${a}: ${workflow.skipped_reasons?.[a] || ''}`));
  }
  const reasons = [
    workflow.research.required ? `Research: ${workflow.research.reason}` : null,
    workflow.architecture_review.required ? `Architecture: ${workflow.architecture_review.reason}` : null,
    workflow.security_review.required ? `Security: ${workflow.security_review.reason}` : null,
    workflow.structure_review.required ? `Structure: ${workflow.structure_review.reason}` : null,
  ].filter(Boolean);
  if (reasons.length) {
    lines.push('', 'Reason:', ...reasons.map((r) => `  ${r}`));
  }
  return lines.join('\n');
}
