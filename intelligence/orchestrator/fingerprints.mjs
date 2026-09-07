/**
 * Scoped project fingerprints for Stage 10 evidence binding.
 * Does not hash the entire tree.
 */
import fs from 'node:fs';
import { documentationState } from './documentation-verification.mjs';
import path from 'node:path';
import { fingerprintText } from '../assessment/facts.mjs';
import { capabilityBindingFingerprint } from '../capability/binding.mjs';

export function normalizeVerificationCommands(commands = []) {
  return (commands || [])
    .map((c) => {
      if (typeof c === 'string') return c.trim();
      if (c && typeof c === 'object' && c.command) return String(c.command).trim();
      return '';
    })
    .filter(Boolean);
}

export function verificationStrategyFingerprint(strategy, extra = {}) {
  return fingerprintText(
    JSON.stringify({
      strategy: strategy || 'none',
      presence: [...(extra.verification_presence || [])].map(String).sort(),
      commands: normalizeVerificationCommands(extra.verification_commands).sort(),
    })
  );
}

export function computeScopedStateFingerprint(projectDir, spec = {}) {
  const strategy = spec.verification_strategy || 'none';
  if (strategy === 'finding_resolution') return documentationState(projectDir).fingerprint;
  if (strategy === 'presence') {
    const files = (spec.verification_presence || []).map(String);
    const entries = files.map((rel) => {
      const abs = path.join(projectDir, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return { rel, exists: false, hash: null };
      }
      return {
        rel,
        exists: true,
        hash: fingerprintText(fs.readFileSync(abs, 'utf8')),
      };
    });
    return fingerprintText(JSON.stringify({ strategy, entries }));
  }
  if (strategy === 'project_verification_commands') {
    return fingerprintText(
      JSON.stringify({
        strategy,
        commands: normalizeVerificationCommands(spec.verification_commands).sort(),
      })
    );
  }
  return fingerprintText(JSON.stringify({ strategy: strategy || 'none' }));
}

export function computeEvidenceFingerprint(facts = {}, extra = {}) {
  const verification_strategy_fingerprint = extra.verification_strategy_fingerprint
    || verificationStrategyFingerprint(extra.verification_strategy, extra);
  const scoped_state_fingerprint = extra.scoped_state_fingerprint
    || (extra.project_dir
      ? computeScopedStateFingerprint(extra.project_dir, extra)
      : null);
  const capability_binding_fingerprint = extra.capability_binding_fingerprint
    || (extra.bindings ? capabilityBindingFingerprint(extra.bindings) : null);
  const parts = {
    project_intelligence_fingerprint: facts.project_intelligence_fingerprint || null,
    input_fingerprint: extra.input_fingerprint || null,
    capability_binding_fingerprint,
    verification_strategy_fingerprint,
    scoped_state_fingerprint,
  };
  return {
    ...parts,
    composite: fingerprintText(JSON.stringify(parts)),
  };
}

export function fingerprintsMatch(stored, current) {
  if (!stored?.composite || !current?.composite) return false;
  return stored.composite === current.composite;
}
