#!/usr/bin/env node
/**
 * Release builder — produces deterministic ZIP + manifest + checksums (no publish)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanonicalVersion } from '../../policy/version.mjs';
import { calculateSha256 } from '../security/checksum.mjs';
import { createDeterministicZip, walkFilesSorted } from './deterministic-zip.mjs';
import { deriveRcSourceManifest } from './rc-source-manifest.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const RELEASE_DIR = path.join(ROOT, 'release');
const DIST_DIR = path.join(RELEASE_DIR, 'dist');

const version = getCanonicalVersion();
const bundleName = `forgeos-${version}`;
const bundleDir = path.join(DIST_DIR, bundleName);

if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
fs.mkdirSync(bundleDir, { recursive: true });

const sourceManifest = deriveRcSourceManifest(ROOT);
for (const rel of sourceManifest.files.filter(f=>f.required_for_distribution).map(f=>f.path)) {
  const src = path.join(ROOT, rel);
  const dest = path.join(bundleDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const manifestSrc = path.join(RELEASE_DIR, 'release-manifest.json');
const manifestDest = path.join(bundleDir, 'release/release-manifest.json');
fs.mkdirSync(path.dirname(manifestDest), { recursive: true });

function writeBundleManifest(includeArtifacts = false) {
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
  const bundleManifest = JSON.parse(JSON.stringify(manifest));
  if (!includeArtifacts) {
    bundleManifest.release.artifacts = [];
  }
  // Stable JSON serialization (already sorted keys from parse/stringify of known shape)
  fs.writeFileSync(manifestDest, `${JSON.stringify(bundleManifest, null, 2)}\n`);
  return bundleManifest;
}

// Bundle ships without archive self-SHA (chicken-and-egg). Repo-level manifest updated after ZIP.
writeBundleManifest(false);

const files = walkFilesSorted(bundleDir);
const artifacts = files.map((f) => {
  const full = path.join(bundleDir, f);
  return { name: f, sha256: calculateSha256(full), path: full };
});

const archiveName = `${bundleName}.zip`;
const archivePath = path.join(RELEASE_DIR, archiveName);
const zipInfo = createDeterministicZip(bundleDir, archivePath, bundleName);

const archiveSha = calculateSha256(archivePath);
const checksums = {
  version,
  generated_at: new Date().toISOString(),
  artifacts: [
    { name: archiveName, sha256: archiveSha },
    ...artifacts.slice(0, 20).map((a) => ({ name: a.name, sha256: a.sha256 })),
  ],
};

fs.writeFileSync(path.join(RELEASE_DIR, 'checksums.json'), `${JSON.stringify(checksums, null, 2)}\n`);

const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
manifest.release.artifacts = [{ name: archiveName, sha256: archiveSha }];
fs.writeFileSync(manifestSrc, `${JSON.stringify(manifest, null, 2)}\n`);
writeBundleManifest(true);

console.log(JSON.stringify({
  action: 'build-release',
  status: 'BUILT',
  version,
  bundle_dir: bundleDir.replace(/\\/g, '/'),
  archive: archivePath.replace(/\\/g, '/'),
  checksums: path.join(RELEASE_DIR, 'checksums.json').replace(/\\/g, '/'),
  file_count: files.length,
  zip_entries: zipInfo.entry_count,
  deterministic: true,
  note: 'Does not publish to GitHub',
}, null, 2));
