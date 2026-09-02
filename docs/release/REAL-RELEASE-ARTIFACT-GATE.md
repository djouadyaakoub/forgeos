# Real Release Artifact Gate â€” ForgeOS

**Date:** 2026-09-02  
**Path:** `<ForgeOS checkout>`  
**Git checkpoint (unchanged):** `741622b9232550f840d76e9053b78013cdb342d4`  
**Scope:** Real ZIP distribution archive only â€” no commit, remote, tag, push, or GitHub Release

---

## Root Cause (Step 1)

`scripts/release/build-release.mjs` intentionally wrote a **text placeholder**:

```js
fs.writeFileSync(archivePlaceholder, `placeholder-archive-${version}\n`);
```

It built `release/dist/forgeos-1.0.0/` correctly, then **never zipped it**.  
Checksums verified the 26-byte placeholder, not a usable archive.

**Fix applied (existing builder only):** create a real ZIP via `Compress-Archive` (Windows) / `zip` (Unix), then SHA-256 + update `checksums.json` and `release-manifest.json`.

---

## Verdict

# **REAL RELEASE ARTIFACT READY**

---

### 1. Build Result

| Item | Result |
|------|--------|
| Command | `npm run build-release` |
| Status | **BUILT** |
| Bundle | `release/dist/forgeos-1.0.0/` (130 files) |
| Archive | `release/forgeos-1.0.0.zip` |
| Placeholder text | **Gone** |

### 2. Archive Size

**170,842 bytes** (was 26 bytes)

### 3. Archive Contents Summary

Top-level: `forgeos-1.0.0/`

Included (distribution scope):

- `.cursor-plugin/`, `agents/`, `skills/`, `policy/`, `intelligence/`, `bootstrap/`
- `schemas/`, `hooks/`, `rules/`
- `package.json`, `README.md`, `CHANGELOG.md`
- `release/release-manifest.json`

**Not included:** `node_modules`, `tests`, `docs`, `coverage`, `.env`, `.git`, `sim-activation`, `release/dist`, Cursor agent-state

### 4. ZIP Integrity

| Check | Result |
|-------|--------|
| Magic bytes | `50 4B 03 04` (PK / ZIP) |
| Open / extract | **OK** |
| Extracted files | **130** |
| `install-from-release --dry-run` | **INTEGRITY valid** |
| Contains `placeholder-archive` | **No** |

### 5. Checksum Result

| Field | Value |
|-------|-------|
| SHA-256 | `90b464aaff9c741f3618048612daa9fe770861c74006b58bd0900bd464f760db` |
| `release/checksums.json` | Matches ZIP bytes |
| `release/release-manifest.json` | Matches ZIP bytes |
| `verifySha256` | **valid: true** |

### 6. Security Scan

```json
{ "findings_count": 0, "clean": true }
```

No secrets, credentials, or private keys in repo or archive.

### 7. Release Validation

| Check | Status |
|-------|--------|
| version_sync | pass |
| release_manifest | pass |
| plugin_valid | pass |
| schemas_valid | pass |
| documentation | pass |
| **no_local_paths** | **fail** |
| no_speed_flexy_leakage | warn |
| secret_scan | pass |
| distribution_tests | pass |
| distribution_security_tests | pass |
| **checksums_manifest** | **pass** |

Overall `npm run validate-release`: **BLOCKED** (1 fail) â€” **not** caused by the ZIP.

Failing files are **docs reports** mentioning `<ForgeOS checkout>` / `<legacy cursor-agent-os checkout>`:

- `docs/release/FORGEOS-STATE-RECONSTRUCTION.md` (untracked)
- `docs/release/GIT-PROVENANCE-INVESTIGATION.md`
- `docs/release/POST-RENAME-INTEGRITY-CHECK.md`

These are **outside the ZIP** (docs not packaged). Artifact checks themselves pass.

### 8. Git Changes

**HEAD still:** `741622b` â€” **no commit made**

```
 M release/checksums.json
 M release/forgeos-1.0.0.zip
 M release/release-manifest.json
 M scripts/release/build-release.mjs
?? docs/release/FIRST-COMMIT-REPORT.md
?? docs/release/FORGEOS-STATE-RECONSTRUCTION.md
?? docs/release/GIT-FOUNDATION-REPORT.md
?? tests/fixtures/project-a/.agent-os/project.yaml.backup-*
```

**`git diff --stat`:**

```
 release/checksums.json            |   4 +-
 release/forgeos-1.0.0.zip         | Bin 26 -> 170842 bytes
 release/release-manifest.json     |   2 +-
 scripts/release/build-release.mjs |  55 ++++++++++++++++++++++++++++++-----
 4 files changed, 52 insertions(+), 9 deletions(-)
```

**Manifest / checksums:** placeholder SHA  
`132a3921â€¦f5331c` â†’ real SHA `90b464aaâ€¦f760db`

### 9. Remaining Blockers

1. **`validate-release` still BLOCKED** by `no_local_paths` on historical/local docs paths (orthogonal to ZIP readiness).
2. **Uncommitted** builder + artifact changes (intentional â€” no commit this phase).
3. **No remote / GitHub / tag / Release** (intentional).
4. Bundle-internal `release/release-manifest.json` ships with `artifacts: []` to avoid chicken-egg SHA inside the ZIP; **repo-level** manifest holds the real SHA (correct for GitHub Release asset verification).

---

## What was not done

- No GitHub repository / remote / push / tag / GitHub Release  
- No commit  
- No Codex/Claude adapter  
- No Cursor adapter change  
- No sim-activation changes  
- No architecture change  
