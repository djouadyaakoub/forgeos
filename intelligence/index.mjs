/**
 * Development Intelligence Layer — central exports
 */
export { RISK_LEVELS, classifyStructureRisk, maxRiskLevel, canAutoExecute } from './risk.mjs';

export {
  walkProject,
  analyzeStructure,
  structureAudit,
  resolveOwnership,
} from './structure/analyzer.mjs';

export {
  validateStructurePlan,
  createStructurePlan,
  planToYaml,
} from './structure/plan.mjs';

export {
  validateResearchResult,
  createResearchResult,
  readResearchCache,
  writeResearchCache,
  planResearchWorkflow,
  getResearchCachePath,
} from './research/workflow.mjs';

export { auditDependencies } from './dependency/auditor.mjs';
export { analyzeDeadCode } from './dead-code/detector.mjs';
export { analyzeDuplication } from './duplication/analyzer.mjs';
export { architectureGuard, checkImportViolation } from './architecture/guardian.mjs';
export { analyzeChangeImpact } from './change-impact/analyzer.mjs';
export { investigate as investigateArchaeology } from './archaeology/investigator.mjs';
export { detectDocumentationDrift } from './documentation/drift.mjs';
export { analyzeTestStrategy } from './testing/coverage-strategy.mjs';
export { planSafeRefactor } from './refactor/safe-refactor.mjs';
export { planPerformanceInvestigation } from './performance/investigator.mjs';
export { classifyKnowledge, curateKnowledge } from './knowledge/curator.mjs';
export { assessReleaseReadiness } from './release/readiness.mjs';

export {
  classifyTaskType,
  requiresSecurityReview,
  planDevelopmentIntelligenceWorkflow,
  formatWorkflowSummary,
  routeToAgent,
  TASK_TYPES,
  TASK_CLASSES,
  classifyTaskClasses,
  estimateComplexity,
  assessTaskRisk,
} from './orchestrator/routing.mjs';

export {
  coordinateDevelopmentWorkflow,
} from './orchestrator/coordinator.mjs';

export {
  replanWorkflow,
  createExecutionRecord,
  recordStageEvidence,
  finalizeWorkflow,
  computeWorkflowEfficiency,
  handleRiskEscalation,
  handleAgentFailure,
} from './orchestrator/execution.mjs';

export { requiresApprovalInvalidation } from './orchestrator/risk-assessment.mjs';
export {
  shouldTriggerResearch,
  shouldTriggerStructure,
  shouldTriggerArchitecture,
  shouldTriggerSecurity,
  shouldTriggerDocs,
} from './orchestrator/triggers.mjs';
export { discoverCapabilities, scoreSpecialist, selectBestSpecialist } from './orchestrator/scoring.mjs';

export {
  checkCompatibility,
  planUniversalOsUpdate,
  MIGRATION_MODES,
  CURRENT_OS_VERSION,
  CURRENT_ADAPTER_SCHEMA,
} from './compatibility/adapter.mjs';

export {
  readRegistry,
  writeRegistryEntry,
  listAffectedProjects,
  getRegistryPath,
  registerProject,
  unregisterProject,
  discoverInstalledProjects,
} from './registry/projects.mjs';

export const INTELLIGENCE_CAPABILITIES = [
  'structure-audit',
  'dependency-audit',
  'dead-code-analysis',
  'duplication-analysis',
  'architecture-guard',
  'change-impact',
  'documentation-drift',
  'test-coverage-strategy',
  'safe-refactor',
  'performance-investigation',
  'knowledge-curation',
  'project-archaeology',
  'solution-research',
  'release-readiness',
  'deployment-discovery',
  'deployment-plan',
  'deployment-build',
  'deployment-execute',
  'deployment-verify',
  'health-check',
  'smoke-test',
  'rollback-plan',
  'rollback-execute',
  'environment-discovery',
  'environment-audit',
  'environment-diff',
  'release-notes',
  'artifact-verification',
  'post-deploy-monitoring',
];

export { discoverDeploymentTargets } from './deployment/discovery.mjs';
export { createDeploymentProfile, validateDeploymentProfile, profilesFromAdapter } from './deployment/profile.mjs';
export { createDeploymentPlan, validateDeploymentPlan, inferDeployableComponents, deploymentDiff } from './deployment/plan.mjs';
export { planBuild, executeBuild } from './deployment/build.mjs';
export { verifyArtifacts } from './deployment/artifact.mjs';
export { executeDeployment, checkDeploymentApproval, formatDryRunReport } from './deployment/executor.mjs';
export { executePostDeployVerification, planHealthChecks } from './deployment/verify.mjs';
export { createRollbackPlan, executeRollback, isRollbackEligible } from './deployment/rollback.mjs';
export { classifyDeploymentFailure, shouldRetry, diagnoseFailure, getRetryPolicy } from './deployment/failure.mjs';
export { generateReleaseNotes } from './deployment/release-notes.mjs';
export { planPostDeployMonitoring, executePostDeployMonitoring } from './deployment/monitoring.mjs';
export { runDeploymentWorkflow } from './deployment/workflow.mjs';
export { redactObject, redactString, isSecretKey } from './deployment/redact.mjs';
export { discoverEnvironments } from './environment/discovery.mjs';
export { auditEnvironment } from './environment/audit.mjs';
export { diffEnvironments, diffEnvironmentShapes } from './environment/diff.mjs';

export { shouldTriggerDeployment } from './orchestrator/triggers.mjs';

export { discoverUniversalOsUpdate, getInstalledVersionSync, readReleaseManifest } from './update/checker.mjs';
export { classifyProjectCompatibility } from './update/planner.mjs';
export {
  planProjectMigrations,
  applyProjectMigration,
  rollbackProjectMigration,
  rollbackUniversalUpdate,
} from './update/migration.mjs';
export {
  buildUpdateNotification,
  planUniversalUpdate,
  applyUniversalUpdate,
  verifyUpdate,
} from './update/manager.mjs';
export { getUpdateStatus, getUpdateStatusAsync } from './update/status.mjs';
export { loadDistributionConfig, isGithubConfigured } from '../policy/distribution.mjs';
export { discoverLatestGithubRelease } from './update/github.mjs';
export { verifySourceAuthenticity, validateReleaseManifest } from './update/authenticity.mjs';
export { verifyReleaseSignature } from './update/signature.mjs';
export { downloadReleaseAsset } from './update/downloader.mjs';
export { activateRelease, rollbackActivation, backupCurrentInstallation, validateStagedRelease } from './update/activate.mjs';
export { acquireUpdateLock, releaseUpdateLock, isUpdateInProgress } from './update/lock.mjs';
export { readUpdateCache, shouldRefreshCache, updateCacheEntry } from './update/cache.mjs';
export { buildUpdateProposal, getNotificationPriority } from './update/proposal.mjs';
export { checkForUpdate } from './update/checker.mjs';
export { getProjectDashboard } from './registry/projects.mjs';
