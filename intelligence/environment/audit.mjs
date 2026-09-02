/**
 * Environment audit — shape validation without reading secret values
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoverEnvironments } from './discovery.mjs';
import { isSecretKey, redactObject } from '../deployment/redact.mjs';
import { diffEnvironments } from './diff.mjs';

export function auditEnvironment(projectDir, adapter = {}, targetEnv = 'production') {
  const discovered = discoverEnvironments(projectDir, adapter);
  const envConfig = adapter.environment?.environments?.find((e) => (e.name || e.id) === targetEnv)
    || discovered.environments.find((e) => e.name === targetEnv);

  const issues = [];
  const secretRefs = [];

  const requiredKeys = envConfig?.required_keys || adapter.environment?.required_keys?.[targetEnv] || [];
  const presentKeys = new Set();

  for (const file of envConfig?.config_files || []) {
    const full = path.join(projectDir, file);
    if (!fs.existsSync(full)) {
      issues.push({ type: 'missing_config_file', file, severity: 'high' });
      continue;
    }
    try {
      const content = fs.readFileSync(full, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        presentKeys.add(key);
        if (isSecretKey(key)) {
          secretRefs.push({ key, present: true, value: '[REDACTED]' });
        }
      }
    } catch {
      issues.push({ type: 'unreadable_config', file, severity: 'medium' });
    }
  }

  for (const key of requiredKeys) {
    if (!presentKeys.has(key)) {
      issues.push({ type: 'missing_required_key', key, severity: 'high' });
    }
  }

  const staging = discovered.environments.find((e) => e.name === 'staging');
  const production = discovered.environments.find((e) => e.name === 'production');
  let drift = null;
  if (staging && production && targetEnv === 'production') {
    drift = diffEnvironments(staging, production);
    for (const missing of drift.missing_in_production || []) {
      if (!missing.includes('FEATURE')) {
        issues.push({ type: 'config_drift', key: missing, severity: 'medium' });
      }
    }
  }

  const status = issues.some((i) => i.severity === 'high') ? 'BLOCKED'
    : issues.length ? 'WARNINGS' : 'READY';

  return redactObject({
    capability: 'environment-audit',
    environment: targetEnv,
    status,
    issues,
    secret_references: secretRefs,
    keys_present: [...presentKeys].map((k) => isSecretKey(k) ? `${k}=[REDACTED]` : k),
    drift,
    secrets_exposed: false,
    assessed_at: new Date().toISOString(),
  });
}
