/**
 * Project migration — backup, apply, validate, rollback
 */
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATION_MODES } from '../compatibility/adapter.mjs';
import { classifyProjectCompatibility } from './planner.mjs';
import { getInstallManifestPath } from '../../policy/plugin-root.mjs';

const PROTECTED_FROM_AUTO = [
  'architecture', 'contracts', 'adrs', 'business_rules', 'database_schema',
  'application_source', 'migrations', 'production_config',
];

const AUTO_SAFE_ACTIONS = new Set([
  'update_adapter_schema',
  'update_version_metadata',
  'add_optional_field',
  'update_compatibility_metadata',
]);

export function planProjectMigrations(projectDir, options = {}) {
  const { compatibility, compat } = classifyProjectCompatibility(projectDir, options);
  const actions = [];

  if (compatibility.status === MIGRATION_MODES.AUTO_SAFE) {
    if (compat.migration_required) {
      actions.push({
        action: 'update_adapter_schema',
        risk: 'low',
        field: 'agent_os.adapter_schema_version',
        from: compatibility.current_adapter_schema,
        to: compatibility.target_adapter_schema,
      });
    }
    actions.push({
      action: 'update_version_metadata',
      risk: 'low',
      field: 'agent_os.installed_version',
      to: compatibility.target_os_version,
    });
  } else if (compatibility.status === MIGRATION_MODES.REVIEW_REQUIRED) {
    actions.push({
      action: 'review_adapter_migration',
      risk: 'medium',
      reason: compatibility.reasons.join('; '),
      requires_approval: true,
    });
  }

  return {
    migration_plan: {
      project: projectDir.replace(/\\/g, '/'),
      project_id: compatibility.project_id,
      from: {
        os_version: compatibility.current_os_version,
        adapter_schema: compatibility.current_adapter_schema,
      },
      to: {
        os_version: compatibility.target_os_version,
        adapter_schema: compatibility.target_adapter_schema,
      },
      actions,
      classification: compatibility.status,
      protected_from_auto: PROTECTED_FROM_AUTO,
      auto_modify_application_code: false,
    },
  };
}

function backupAdapter(projectDir) {
  const adapterPath = path.join(projectDir, '.agent-os/project.yaml');
  if (!fs.existsSync(adapterPath)) return null;
  const backupPath = `${adapterPath}.backup-${Date.now()}`;
  fs.copyFileSync(adapterPath, backupPath);
  return backupPath;
}

export function applyProjectMigration(projectDir, migrationPlan, options = {}) {
  const plan = migrationPlan?.migration_plan || migrationPlan;
  const classification = plan?.classification;

  if (classification === MIGRATION_MODES.INCOMPATIBLE) {
    return { status: 'BLOCKED', reason: 'incompatible', mutated: false };
  }
  if (classification === MIGRATION_MODES.MANUAL) {
    return { status: 'BLOCKED', reason: 'manual_migration_required', mutated: false };
  }
  if (classification === MIGRATION_MODES.REVIEW_REQUIRED && !options.approval?.granted) {
    return { status: 'BLOCKED', reason: 'approval_required', mutated: false };
  }

  for (const action of plan.actions || []) {
    if (!AUTO_SAFE_ACTIONS.has(action.action) && classification !== MIGRATION_MODES.REVIEW_REQUIRED) {
      return { status: 'BLOCKED', reason: `action_not_auto_safe:${action.action}`, mutated: false };
    }
    if (PROTECTED_FROM_AUTO.some((p) => action.field?.includes(p))) {
      return { status: 'BLOCKED', reason: 'protected_field', mutated: false };
    }
  }

  if (options.simulate_failure) {
    return { status: 'FAILED', reason: 'simulated_failure', mutated: false, backup: backupAdapter(projectDir) };
  }

  const backup = backupAdapter(projectDir);
  const adapterPath = path.join(projectDir, '.agent-os/project.yaml');

  if (!fs.existsSync(adapterPath)) {
    return { status: 'SKIPPED', reason: 'no_adapter', mutated: false };
  }

  let content = fs.readFileSync(adapterPath, 'utf8');
  const mutations = [];

  for (const action of plan.actions || []) {
    if (action.action === 'update_adapter_schema') {
      if (!content.includes('adapter_schema_version')) {
        content = content.replace(
          /(agent_os:\s*\n)/,
          `$1  adapter_schema_version: ${action.to}\n`
        );
        mutations.push('added adapter_schema_version');
      }
    }
    if (action.action === 'update_version_metadata') {
      if (!content.includes('installed_version')) {
        content = content.replace(
          /(agent_os:\s*\n(?:\s+.+\n)*?)(\s+version:)/,
          `$1  installed_version: "${action.to}"\n$2`
        );
        if (!content.includes('installed_version')) {
          mutations.push('metadata_version_note_only');
        } else {
          mutations.push('added installed_version');
        }
      }
    }
  }

  if (options.dry_run) {
    return { status: 'DRY_RUN', mutations, backup, mutated: false };
  }

  try {
    fs.writeFileSync(adapterPath, content, 'utf8');
    return {
      status: 'SUCCESS',
      mutations,
      backup,
      mutated: mutations.length > 0,
      rollback_available: !!backup,
    };
  } catch (err) {
    if (backup) rollbackProjectMigration(projectDir, backup);
    return { status: 'FAILED', reason: err.message, backup, mutated: false };
  }
}

export function rollbackProjectMigration(projectDir, backupPath) {
  const adapterPath = path.join(projectDir, '.agent-os/project.yaml');
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { status: 'FAILED', reason: 'no_backup' };
  }
  fs.copyFileSync(backupPath, adapterPath);
  return { status: 'ROLLED_BACK', restored_from: backupPath };
}

export function rollbackUniversalUpdate(installBackupPath, installManifestPath) {
  const dest = installManifestPath || getInstallManifestPath();
  if (!installBackupPath || !fs.existsSync(installBackupPath)) {
    return { status: 'FAILED', reason: 'no_install_backup' };
  }
  fs.copyFileSync(installBackupPath, dest);
  return { status: 'ROLLED_BACK', restored_from: installBackupPath, scope: 'global_os' };
}
