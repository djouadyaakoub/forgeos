/**
 * Implementation classification — Stage 17 Alignment
 *
 * Canonical kinds (product semantics):
 *   HOST_NATIVE      — existing IDE/host (Cursor interactive handoff)
 *   FORGEOS_NATIVE   — ForgeOS deterministic modules in same workspace
 *   OSS_DERIVED      — OSS provenance/methodology executed in ForgeOS/host (NOT launcher)
 *   OPTIONAL_RUNTIME — optional RuntimeBackend (e.g. OpenHands) via Runtime Router
 *
 * Legacy alias:
 *   oss_backed → OPTIONAL_RUNTIME (external programmatic backend; not OSS-derived)
 */
export const IMPLEMENTATION_KINDS = Object.freeze({
  HOST_NATIVE: 'HOST_NATIVE',
  FORGEOS_NATIVE: 'FORGEOS_NATIVE',
  OSS_DERIVED: 'OSS_DERIVED',
  OPTIONAL_RUNTIME: 'OPTIONAL_RUNTIME',
});

/** Types accepted in registry / operations (includes legacy alias). */
export const IMPLEMENTATION_TYPES = Object.freeze([
  'host_native',
  'forgeos_native',
  'oss_derived',
  'optional_runtime',
  'oss_backed', // LEGACY alias for optional_runtime — do not use for new OSS-derived caps
]);

export const LEGACY_OPTIONAL_RUNTIME_ALIAS = 'oss_backed';

export function canonicalizeImplementationType(type) {
  const t = String(type || '');
  if (t === 'oss_backed') return 'optional_runtime';
  return t;
}

export function implementationTypeToKind(type) {
  const c = canonicalizeImplementationType(type);
  if (c === 'host_native') return IMPLEMENTATION_KINDS.HOST_NATIVE;
  if (c === 'forgeos_native') return IMPLEMENTATION_KINDS.FORGEOS_NATIVE;
  if (c === 'oss_derived') return IMPLEMENTATION_KINDS.OSS_DERIVED;
  if (c === 'optional_runtime') return IMPLEMENTATION_KINDS.OPTIONAL_RUNTIME;
  return null;
}

/**
 * Whether this implementation type launches/selects an external RuntimeBackend.
 * OSS-derived must return false.
 */
export function launchesExternalRuntime(type) {
  return canonicalizeImplementationType(type) === 'optional_runtime';
}

export function isValidImplementationType(type) {
  return IMPLEMENTATION_TYPES.includes(String(type || ''));
}

/** Preference order for resolution (host-native first product rule). */
export const IMPLEMENTATION_PREFERENCE_ORDER = Object.freeze([
  'host_native',
  'forgeos_native',
  'oss_derived',
  'optional_runtime',
]);
