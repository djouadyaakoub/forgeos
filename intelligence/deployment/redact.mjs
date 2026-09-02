/**
 * Secret redaction for deployment/evidence — never expose secret values
 */
const SECRET_KEY_PATTERNS = [
  /password/i, /secret/i, /token/i, /api[_-]?key/i, /credential/i,
  /auth/i, /bearer/i, /private[_-]?key/i, /access[_-]?key/i,
  /database[_-]?url/i, /connection[_-]?string/i,
];

const SECRET_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /Bearer\s+[a-zA-Z0-9._-]+/i,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
];

export function isSecretKey(key) {
  const k = String(key);
  if (/^(secrets_exposed|secret_references|secret_refs)$/i.test(k)) return false;
  if (/_exposed$|_references$/i.test(k)) return false;
  return SECRET_KEY_PATTERNS.some((p) => p.test(k));
}

export function redactValue(key, value) {
  if (value == null) return value;
  if (isSecretKey(key)) return '[REDACTED]';
  const str = String(value);
  if (SECRET_VALUE_PATTERNS.some((p) => p.test(str))) return '[REDACTED]';
  return value;
}

export function redactObject(obj, depth = 0) {
  if (depth > 8 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSecretKey(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      out[k] = redactObject(v, depth + 1);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

export function redactString(text) {
  let s = String(text);
  for (const p of SECRET_VALUE_PATTERNS) {
    s = s.replace(p, '[REDACTED]');
  }
  return s;
}

export function secretReference(key) {
  return { key, present: true, value: '[REDACTED]' };
}
