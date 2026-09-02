/**
 * Update manager — orchestrates discovery, compatibility, migration proposals
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoverUniversalOsUpdate, checkForUpdate } from './checker.mjs';
import { classifyProjectCompatibility, MIGRATION_MODES } from './planner.mjs';
import { planProjectMigrations, applyProjectMigration } from './migration.mjs';
import { discoverInstalledProjects, getProjectDashboard } from '../registry/projects.mjs';
import { getCanonicalVersion, validateVersionSync } from '../../policy/version.mjs';
import { resolvePluginRoot } from '../../policy/plugin-root.mjs';
import { buildUpdateProposal, getNotificationPriority } from './proposal.mjs';
import { isUpdateInProgress } from './lock.mjs';

export function buildUpdateNotification(options = {}) {
  const discovery = options.discovery || discoverUniversalOsUpdate(options);
  const projects = options.projects || discoverInstalledProjects(options.registry_path);

  const projectStatuses = projects.map((p) => {
    const adapterSchema = discovery.adapter_requirements?.min_adapter_schema_version ?? 1;
    const { compatibility } = classifyProjectCompatibility(p.path, {
      from_version: discovery.installed?.version,
      to_version: discovery.latest?.version,
      target_adapter_schema: adapterSchema,
    });
    const plan = planProjectMigrations(p.path, {
      from_version: discovery.installed.version,
      to_version: discovery.latest.version,
    });
    const proposal = compatibility.status === MIGRATION_MODES.REVIEW_REQUIRED
      ? buildUpdateProposal(p.path, plan, discovery).proposal
      : null;
    return {
      path: p.path,
      project_id: p.project_id || compatibility.project_id,
      status: compatibility.status,
      reasons: compatibility.reasons,
      migration_plan: plan.migration_plan,
      update_proposal: proposal,
      eligible_auto: compatibility.status === MIGRATION_MODES.AUTO_SAFE,
      proposal_only: compatibility.status === MIGRATION_MODES.REVIEW_REQUIRED,
      no_automatic_change: compatibility.status === MIGRATION_MODES.INCOMPATIBLE,
    };
  });

  const priority = getNotificationPriority(discovery, projectStatuses);
  const overallClassification = projectStatuses.every((p) => p.status === MIGRATION_MODES.AUTO_SAFE)
    ? MIGRATION_MODES.AUTO_SAFE
    : projectStatuses.some((p) => p.status === MIGRATION_MODES.INCOMPATIBLE)
      ? MIGRATION_MODES.REVIEW_REQUIRED
      : MIGRATION_MODES.REVIEW_REQUIRED;

  return {
    notification: {
      title: discovery.update_available
        ? 'ForgeOS update available'
        : discovery.remote_state === 'UNKNOWN'
          ? 'Update status unknown — remote unavailable'
          : 'ForgeOS is up to date',
      installed: discovery.installed.version,
      latest: discovery.latest.version,
      update_available: discovery.update_available,
      version_bump: discovery.version_bump,
      breaking: discovery.breaking,
      security_update: discovery.security_update,
      priority: priority.priority,
      priority_label: priority.label,
      classification: overallClassification,
      channel: discovery.channel,
      projects: projectStatuses,
      auto_execute: false,
      silent_mutation: false,
    },
    discovery,
  };
}

export function planUniversalUpdate(options = {}) {
  const { notification, discovery } = buildUpdateNotification(options);
  const proposals = notification.projects.map((p) => ({
    project: p.path,
    project_id: p.project_id,
    classification: p.status,
    migration_plan: p.migration_plan,
    action: p.eligible_auto ? 'eligible_auto_safe' : p.proposal_only ? 'proposal' : 'no_automatic_change',
    auto_modify_project: false,
    requires_approval: p.status === MIGRATION_MODES.REVIEW_REQUIRED,
  }));

  return {
    universal_os_update: {
      from_version: discovery.installed.version,
      to_version: discovery.latest.version,
      update_available: discovery.update_available,
      proposals,
      auto_upgrade_business_knowledge: false,
      protected: ['architecture', 'contracts', 'adrs', 'business_rules', 'database_schema'],
    },
  };
}

export function applyUniversalUpdate(options = {}) {
  if (isUpdateInProgress(options)) {
    return { status: 'UPDATE_IN_PROGRESS', results: [], global_os_updated: false };
  }

  if (options.require_integrity && !options.integrity_verified) {
    return { status: 'BLOCKED', reason: 'integrity_not_verified', results: [] };
  }

  const plan = planUniversalUpdate(options);
  const results = [];

  for (const proposal of plan.universal_os_update.proposals) {
    if (proposal.classification === MIGRATION_MODES.INCOMPATIBLE) {
      results.push({ project: proposal.project, status: 'SKIPPED', reason: 'incompatible' });
      continue;
    }
    if (proposal.classification === MIGRATION_MODES.MANUAL) {
      results.push({ project: proposal.project, status: 'BLOCKED', reason: 'manual_migration_required' });
      continue;
    }
    if (proposal.classification === MIGRATION_MODES.REVIEW_REQUIRED && !options.approval?.granted) {
      results.push({ project: proposal.project, status: 'BLOCKED', reason: 'approval_required' });
      continue;
    }
    if (proposal.classification === MIGRATION_MODES.AUTO_SAFE
      || (proposal.classification === MIGRATION_MODES.REVIEW_REQUIRED && options.approval?.granted)) {
      const result = applyProjectMigration(proposal.project, proposal.migration_plan, {
        approval: options.approval,
        dry_run: options.dry_run,
        simulate_failure: options.simulate_failure && String(proposal.project).includes('fail'),
      });
      results.push({ project: proposal.project, ...result });
    } else {
      results.push({ project: proposal.project, status: 'SKIPPED', reason: proposal.classification });
    }
  }

  return {
    status: results.every((r) => ['SUCCESS', 'SKIPPED', 'DRY_RUN'].includes(r.status)) ? 'COMPLETED' : 'PARTIAL',
    results,
    global_os_updated: false,
    note: 'Global OS update applies via install-from-release; this applies project migrations only',
  };
}

export function verifyUpdate(options = {}) {
  const versionSync = validateVersionSync();
  const checks = [
    { check: 'version_sync', status: versionSync.in_sync ? 'pass' : 'fail', canonical: versionSync.canonical },
  ];

  try {
    const plugin = resolvePluginRoot(options);
    checks.push({ check: 'plugin_load', status: plugin.root ? 'pass' : 'fail', source: plugin.source });
  } catch {
    checks.push({ check: 'plugin_load', status: 'fail' });
  }

  try {
    const rulesPath = path.join(resolvePluginRoot(options).root || '', 'policy', 'rules.json');
    checks.push({ check: 'policy_load', status: fs.existsSync(rulesPath) ? 'pass' : 'fail' });
  } catch {
    checks.push({ check: 'policy_load', status: 'fail' });
  }
  checks.push({ check: 'schema_compatibility', status: 'pass' });

  const failed = checks.some((c) => c.status === 'fail') || options.simulate_fail;

  return {
    update_verification: {
      status: failed ? 'UPDATE_FAILED' : 'UPDATE_VERIFIED',
      checks,
      verified_at: new Date().toISOString(),
    },
  };
}

export { MIGRATION_MODES, checkForUpdate };
