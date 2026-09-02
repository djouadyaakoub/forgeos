/**
 * Update concurrency lock — prevents parallel updates
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOCK_PATH = path.join(os.homedir(), '.cursor', 'agent-os', 'update.lock');
const STALE_MS = 30 * 60 * 1000;

export function getLockPath() {
  return LOCK_PATH;
}

function readLock(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function isUpdateInProgress(options = {}) {
  const lockPath = options.lock_path || LOCK_PATH;
  const existing = readLock(lockPath);
  if (!existing) return false;
  const age = Date.now() - new Date(existing.started_at).getTime();
  return age < STALE_MS;
}

export function acquireUpdateLock(options = {}) {
  const lockPath = options.lock_path || LOCK_PATH;
  const existing = readLock(lockPath);
  if (existing) {
    const age = Date.now() - new Date(existing.started_at).getTime();
    if (age < STALE_MS) {
      return { acquired: false, status: 'UPDATE_IN_PROGRESS', lock: existing };
    }
  }
  const lock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    phase: options.phase || 'update',
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
  return { acquired: true, lock };
}

export function releaseUpdateLock(options = {}) {
  const lockPath = options.lock_path || LOCK_PATH;
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
  return { released: true };
}
