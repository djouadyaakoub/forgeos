/**
 * SHA256 integrity verification for release artifacts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function calculateSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

export function verifySha256(filePath, expected) {
  if (!expected) {
    return { valid: false, reason: 'no_expected_checksum', blocked: true };
  }
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: 'file_not_found', blocked: true };
  }
  const actual = calculateSha256(filePath);
  const valid = actual.toLowerCase() === String(expected).toLowerCase();
  return {
    valid,
    blocked: !valid,
    actual,
    expected: String(expected).toLowerCase(),
    reason: valid ? 'match' : 'checksum_mismatch',
  };
}

export function verifyChecksumManifest(files, manifest) {
  const results = [];
  let allValid = true;
  for (const entry of manifest?.artifacts || manifest?.files || []) {
    const filePath = entry.path || entry.name;
    const result = verifySha256(filePath, entry.sha256);
    results.push({ file: entry.name || path.basename(filePath), ...result });
    if (!result.valid) allValid = false;
  }
  return { valid: allValid, blocked: !allValid, results };
}
