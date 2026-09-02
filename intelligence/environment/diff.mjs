/**
 * Environment diff — configuration shape comparison, no secret values
 */
import { isSecretKey } from '../deployment/redact.mjs';

export function diffEnvironments(envA = {}, envB = {}) {
  const keysA = new Set(envA.required_keys || []);
  const keysB = new Set(envB.required_keys || []);

  const allKeys = new Set([...keysA, ...keysB, ...(envA.config_keys || []), ...(envB.config_keys || [])]);

  const comparison = [];
  const missingInB = [];
  const missingInA = [];

  for (const key of allKeys) {
    const inA = keysA.has(key) || envA.present_keys?.includes(key);
    const inB = keysB.has(key) || envB.present_keys?.includes(key);
    comparison.push({
      key: isSecretKey(key) ? `${key} → [REDACTED]` : key,
      development: inA ? 'present' : 'missing',
      production: inB ? 'present' : 'missing',
    });
    if (inA && !inB) missingInB.push(key);
    if (inB && !inA) missingInA.push(key);
  }

  return {
    capability: 'environment-diff',
    comparison,
    missing_in_production: missingInB,
    missing_in_development: missingInA,
    secret_values_exposed: false,
  };
}

export function diffEnvironmentShapes(environments = {}) {
  const dev = environments.development || {};
  const staging = environments.staging || {};
  const prod = environments.production || {};

  return {
    development_vs_staging: diffEnvironments(dev, staging),
    staging_vs_production: diffEnvironments(staging, prod),
    development_vs_production: diffEnvironments(dev, prod),
  };
}
