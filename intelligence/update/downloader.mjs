/**
 * Release download — verify source, checksum, stage to temp (no direct overwrite)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifySourceAuthenticity, validateReleaseManifest } from './authenticity.mjs';
import { verifySha256 } from '../../scripts/security/checksum.mjs';
import { verifyReleaseSignature } from './signature.mjs';

export async function downloadReleaseAsset(release, options = {}) {
  const auth = verifySourceAuthenticity(options.config, release, options);
  if (!auth.authentic) {
    return { status: 'BLOCKED', reason: 'source_not_authentic', issues: auth.issues, blocked: true };
  }

  const manifestCheck = validateReleaseManifest(
    { release: release.release_manifest },
    { expected_version: options.expected_version }
  );
  if (!manifestCheck.valid) {
    return { status: 'BLOCKED', reason: 'invalid_manifest', issues: manifestCheck.issues, blocked: true };
  }

  const stagingDir = options.staging_dir || fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-stage-'));
  const asset = options.asset || (release.assets || []).find((a) =>
    /\.zip$/i.test(a.name) || a.name?.includes('cursor-agent-os')
  );

  let localPath = options.local_source;
  if (!localPath && asset?.local_path) {
    localPath = asset.local_path;
  }
  if (!localPath && options.fixture_bundle) {
    localPath = options.fixture_bundle;
  }

  if (!localPath) {
    if (options.simulate_download) {
      return { status: 'BLOCKED', reason: 'no_local_or_remote_asset', blocked: true };
    }
    if (asset?.url && options.fetch) {
      try {
        const res = await options.fetch(asset.url);
        if (!res.ok) return { status: 'BLOCKED', reason: 'download_failed', blocked: true };
        const buf = Buffer.from(await res.arrayBuffer());
        localPath = path.join(stagingDir, asset.name || 'release.zip');
        fs.writeFileSync(localPath, buf);
      } catch {
        return { status: 'BLOCKED', reason: 'download_failed', blocked: true };
      }
    } else {
      return { status: 'BLOCKED', reason: 'no_asset_source', blocked: true };
    }
  } else {
    const dest = path.join(stagingDir, path.basename(localPath));
    if (path.resolve(localPath) !== path.resolve(dest)) {
      fs.copyFileSync(localPath, dest);
    }
    localPath = dest;
  }

  const expectedSha = release.release_manifest?.artifacts?.find((a) =>
    a.name === path.basename(localPath) || a.name === asset?.name
  )?.sha256 || options.expected_sha256;

  if (expectedSha) {
    const checksum = verifySha256(localPath, expectedSha);
    if (!checksum.valid) {
      return {
        status: 'BLOCKED',
        reason: 'checksum_mismatch',
        blocked: true,
        checksum,
        staging_dir: stagingDir,
      };
    }
  } else if (options.require_checksum) {
    return { status: 'BLOCKED', reason: 'checksum_required', blocked: true };
  }

  const signature = verifyReleaseSignature(
    { release: release.release_manifest },
    { artifact_path: localPath, skip_file_check: !expectedSha }
  );

  return {
    status: 'STAGED',
    staging_dir: stagingDir,
    artifact_path: localPath,
    authenticity: auth,
    manifest: manifestCheck,
    checksum_verified: Boolean(expectedSha),
    signature,
    blocked: false,
  };
}

export function cleanupStaging(stagingDir) {
  if (stagingDir && fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}
