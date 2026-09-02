/**
 * Update proposal for REVIEW_REQUIRED — requires explicit approval
 */
export function buildUpdateProposal(project, migrationPlan, discovery, options = {}) {
  const plan = migrationPlan?.migration_plan || migrationPlan;
  return {
    proposal: {
      project: plan.project || project,
      project_id: plan.project_id,
      classification: plan.classification || 'REVIEW_REQUIRED',
      current_version: plan.from?.os_version || discovery?.installed?.version,
      target_version: plan.to?.os_version || discovery?.latest?.version,
      reason: (plan.actions || []).map((a) => a.reason || a.action).join('; ') || 'review_required',
      files_to_change: ['.agent-os/project.yaml'],
      migration: plan.actions || [],
      risk: plan.actions?.some((a) => a.risk === 'medium') ? 'medium' : 'low',
      backup: 'adapter backup created before migration',
      rollback: 'rollbackProjectMigration() restores adapter backup',
      approval_required: true,
      auto_apply: false,
      modifies_project_source: false,
      policy_note: 'Checksum success does not bypass approval or policy',
    },
  };
}

export function getNotificationPriority(discovery, projectStatuses = []) {
  const security = discovery?.security_update || discovery?.latest?.manifest?.security?.advisory;
  const hasIncompatible = projectStatuses.some((p) => p.status === 'INCOMPATIBLE');
  const hasReview = projectStatuses.some((p) => p.status === 'REVIEW_REQUIRED');

  if (security && discovery?.security_severity === 'CRITICAL') {
    return { priority: 'CRITICAL', label: 'CRITICAL security update' };
  }
  if (security) {
    return { priority: 'HIGH', label: 'Security update available' };
  }
  if (hasIncompatible || hasReview) {
    return { priority: 'HIGH', label: 'Compatibility review required' };
  }
  return { priority: 'NORMAL', label: 'Feature update available' };
}
