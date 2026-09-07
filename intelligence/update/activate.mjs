/**
 * Staged activation — backup → validate → activate → verify → rollback on failure
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeInstallManifest, getInstallManifestPath, resolvePluginRoot } from '../../policy/plugin-root.mjs';
import { validateReleaseManifest, verifySourceAuthenticity } from './authenticity.mjs';
import { verifySha256 } from '../../scripts/security/checksum.mjs';
import { acquireUpdateLock, releaseUpdateLock } from './lock.mjs';
import { verifyUpdate } from './manager.mjs';
import { compareSemver, parseSemver } from '../../policy/version.mjs';

const BACKUP_ROOT = path.join(os.homedir(), '.cursor', 'agent-os', 'backups');

const REQUIRED_FILES = [
  '.cursor-plugin/plugin.json',
  'policy/engine.mjs',
  'policy/hooks/policy-pre-tool.mjs',
  'package.json',
  'release/release-manifest.json',
];

function getBackupDir(version) {
  return path.join(BACKUP_ROOT, version || 'unknown');
}

export function backupCurrentInstallation(options = {}) {
  const installPath = getInstallManifestPath();
  const backupDir = options.backup_dir || getBackupDir(options.version || 'pre-update');
  fs.mkdirSync(backupDir, { recursive: true });

  let currentRoot = null;
  if (fs.existsSync(installPath)) {
    const install = JSON.parse(fs.readFileSync(installPath, 'utf8'));
    currentRoot = install.plugin_root;
    fs.copyFileSync(installPath, path.join(backupDir, 'install.json'));
  }

  const manifestBackup = { backed_up_at: new Date().toISOString(), plugin_root: currentRoot };
  fs.writeFileSync(path.join(backupDir, 'backup-meta.json'), JSON.stringify(manifestBackup, null, 2));
  return { backup_dir: backupDir, plugin_root: currentRoot };
}

export function validateStagedRelease(stagedPath, options = {}) {
  const issues = [];
  for (const rel of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(stagedPath, rel))) issues.push(`missing:${rel}`);
  }
  const manifestPath = path.join(stagedPath, 'release/release-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, blocked: true, issues: ['missing_release_manifest'] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const validation = validateReleaseManifest(manifest, options);
  if (!validation.valid) issues.push(...validation.issues);

  const auth = verifySourceAuthenticity(options.config, {
    release_manifest: manifest.release,
    plugin_id: manifest.release?.plugin_id,
    owner: manifest.release?.supply_chain?.owner,
    repository: manifest.release?.supply_chain?.repository,
  }, options);

  if (!auth.authentic) issues.push('source_not_authentic');

  if (options.expected_sha256 && options.artifact_path) {
    const checksum = verifySha256(options.artifact_path, options.expected_sha256);
    if (!checksum.valid) issues.push('checksum_mismatch');
  }

  return {
    valid: issues.length === 0,
    blocked: issues.length > 0,
    issues,
    manifest: manifest.release,
    authenticity: auth,
  };
}

/** Ordering prerequisite only: success cannot bypass authenticity or activation gates. */
export function evaluateActivationVersionOrder(current, target, options = {}) {
  try {
    parseSemver(target);
    const comparison = current == null ? null : compareSemver(target,current);
    if (comparison < 0 && !options.allow_downgrade)
      return {status:'BLOCKED',reason:'downgrade_not_allowed',current,target,blocked:true};
    return {blocked:false,comparison};
  } catch(e) {
    if(e.code !== 'INVALID_SEMVER')throw e;
    return {status:'BLOCKED',reason:'invalid_semver',current,target,blocked:true};
  }
}

export function activateRelease(stagedPath, options = {}) {
  const lock = acquireUpdateLock({ phase: 'activate' });
  if (!lock.acquired) {
    return { status: 'UPDATE_IN_PROGRESS', lock: lock.lock };
  }

  try {
    const installPath = getInstallManifestPath();
    let currentVersion = options.current_version ?? null;
    if (currentVersion == null && fs.existsSync(installPath)) {
      currentVersion = JSON.parse(fs.readFileSync(installPath, 'utf8')).version;
    }

    const targetVersion = options.version ?? JSON.parse(
      fs.readFileSync(path.join(stagedPath, 'release/release-manifest.json'), 'utf8')
    ).release.version;

    const ordering = evaluateActivationVersionOrder(currentVersion,targetVersion,options);
    if (ordering.blocked) return ordering;

    const validation = validateStagedRelease(stagedPath, options);
    if (!validation.valid) {
      return { status: 'BLOCKED', reason: 'validation_failed', issues: validation.issues, blocked: true };
    }

    const backup = backupCurrentInstallation({ version: currentVersion || 'none' });

    if (options.simulate_activation_failure) {
      return {
        status: 'FAILED',
        reason: 'simulated_activation_failure',
        backup: backup.backup_dir,
        rollback_available: true,
      };
    }

    const resolved = path.resolve(stagedPath);
    writeInstallManifest(resolved, targetVersion);

    const verification = verifyUpdate({ skipDevFallback: true });
    if (verification.update_verification.status === 'UPDATE_FAILED') {
      rollbackActivation(backup.backup_dir);
      return {
        status: 'FAILED',
        reason: 'post_activation_verification_failed',
        verification,
        rolled_back: true,
      };
    }

    return {
      status: 'ACTIVATED',
      version: targetVersion,
      plugin_root: resolved,
      backup: backup.backup_dir,
      verification,
    };
  } finally {
    releaseUpdateLock();
  }
}

export function rollbackActivation(backupDir) {
  const installBackup = path.join(backupDir, 'install.json');
  if (!fs.existsSync(installBackup)) {
    return { status: 'FAILED', reason: 'no_install_backup' };
  }
  fs.copyFileSync(installBackup, getInstallManifestPath());
  return { status: 'ROLLED_BACK', restored_from: backupDir, scope: 'global_os' };
}

export { BACKUP_ROOT, getBackupDir };
