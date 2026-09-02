#!/usr/bin/env node
/**
 * Migrate legacy project adapter agent_os → forgeos
 *
 * Usage:
 *   node bootstrap/migrate-to-forgeos.mjs --project-dir <path> [--dry-run] [--apply] [--rollback <backup>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectManifest, MANIFEST_PATH } from '../policy/project-adapter.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const rollbackIdx = args.indexOf('--rollback');
const rollbackPath = rollbackIdx >= 0 ? path.resolve(args[rollbackIdx + 1]) : null;
const projectIdx = args.indexOf('--project-dir');
const projectDir = projectIdx >= 0 ? path.resolve(args[projectIdx + 1]) : process.cwd();

function backupAdapter(projectDir) {
  const adapterPath = path.join(projectDir, MANIFEST_PATH);
  if (!fs.existsSync(adapterPath)) return null;
  const backup = `${adapterPath}.forgeos-backup-${Date.now()}`;
  fs.copyFileSync(adapterPath, backup);
  return backup;
}

function rollback(projectDir, backupPath) {
  const adapterPath = path.join(projectDir, MANIFEST_PATH);
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { status: 'FAILED', reason: 'no_backup' };
  }
  fs.copyFileSync(backupPath, adapterPath);
  return { status: 'ROLLED_BACK', restored_from: backupPath };
}

function planMigration(projectDir) {
  const { data: manifest, source } = loadProjectManifest(projectDir);
  if (!manifest) {
    return { status: 'SKIPPED', reason: 'no_adapter', project: projectDir };
  }
  const hasLegacy = Boolean(manifest.agent_os && !manifest.forgeos);
  const hasForge = Boolean(manifest.forgeos);
  if (!hasLegacy && hasForge) {
    return { status: 'ALREADY_MIGRATED', project: projectDir };
  }
  if (!hasLegacy) {
    return { status: 'SKIPPED', reason: 'no_legacy_agent_os_block', project: projectDir };
  }

  const plan = {
    project: projectDir.replace(/\\/g, '/'),
    source,
    from: { block: 'agent_os', version: manifest.agent_os?.version },
    to: { block: 'forgeos', version: manifest.agent_os?.version },
    actions: [
      { action: 'add_forgeos_block', risk: 'low' },
      { action: 'preserve_agent_os_block', risk: 'low', note: 'backward compatibility retained' },
      { action: 'add_compatibility_metadata', risk: 'low' },
    ],
    classification: 'AUTO_SAFE',
    backup_required: true,
  };
  return { status: 'PLANNED', migration_plan: plan };
}

function applyMigration(projectDir) {
  const planResult = planMigration(projectDir);
  if (planResult.status !== 'PLANNED') return planResult;

  const adapterPath = path.join(projectDir, MANIFEST_PATH);
  let content = fs.readFileSync(adapterPath, 'utf8');
  const backup = backupAdapter(projectDir);

  if (!content.includes('forgeos:')) {
    const agentBlock = content.match(/agent_os:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (agentBlock) {
      const forgeBlock = agentBlock[0].replace('agent_os:', 'forgeos:');
      content = `${content.trimEnd()}\n\n# ForgeOS adapter (migrated from agent_os)\n${forgeBlock}\n`;
    }
    if (!content.includes('compatibility:')) {
      content = content.replace(
        /(forgeos:[\s\S]*?)(\n[a-z_]+:|$)/,
        `$1  compatibility:\n    legacy_identifiers:\n      - agent_os\n    migration_required: false\n$2`
      );
    }
  }

  if (dryRun) {
    return { status: 'DRY_RUN', backup, mutated: false, plan: planResult.migration_plan };
  }

  if (!apply) {
    return { status: 'PROPOSAL', plan: planResult.migration_plan, note: 'Pass --apply to execute' };
  }

  try {
    fs.writeFileSync(adapterPath, content, 'utf8');
    const { data: after } = loadProjectManifest(projectDir);
    const valid = Boolean(after?.forgeos);
    return {
      status: valid ? 'SUCCESS' : 'FAILED',
      backup,
      mutated: valid,
      rollback_available: Boolean(backup),
    };
  } catch (err) {
    if (backup) rollback(projectDir, backup);
    return { status: 'FAILED', reason: err.message, backup };
  }
}

if (rollbackPath) {
  console.log(JSON.stringify(rollback(projectDir, rollbackPath), null, 2));
  process.exit(0);
}

const result = apply ? applyMigration(projectDir) : planMigration(projectDir);
console.log(JSON.stringify({ action: 'migrate-to-forgeos', ...result }, null, 2));
process.exit(result.status === 'FAILED' ? 1 : 0);
