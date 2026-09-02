# Deterministic Release Artifact Gate — ForgeOS

**Date:** 2026-09-02  
**HEAD (unchanged):** `741622b9232550f840d76e9053b78013cdb342d4`  
**Scope:** Deterministic ZIP generation only — no commit, remote, tag, push, or GitHub Release

---

## 1. Root Cause of Non-Determinism

Evidence from two consecutive `Compress-Archive` builds (same source, 2s apart):

| Metric | Build A | Build B |
|--------|---------|---------|
| Size | 170842 | 170842 |
| SHA-256 | different | different |
| Entry count | 131 | 131 |
| Entry order | identical | identical |
| LastWriteTime diffs | **2 entries** | |

Differing entries:

1. `forgeos-1.0.0/skills/` — empty directory created at build time → current mtime  
2. `forgeos-1.0.0/release/release-manifest.json` — written at build time → current mtime  

Most other files kept stable source mtimes (Windows `CopyFile` preserves them).  
ZIP entry order was already stable; **filesystem timestamps embedded by `Compress-Archive`** caused the SHA change.

First differing byte was at offset 10 (DOS timestamp in the first local header).

---

## 2. Implementation

| File | Change |
|------|--------|
| `scripts/release/deterministic-zip.mjs` | **New** — pure Node ZIP writer: sorted entries, fixed DOS timestamp `2026-09-02 00:00:00 UTC`, `deflateRaw` level 9 (or STORE if smaller), no extra fields, no deps |
| `scripts/release/build-release.mjs` | Replaced `Compress-Archive` / `zip` CLI with `createDeterministicZip`; sorted directory walks; keep chicken-egg (bundle manifest ships `artifacts: []`) |

No new npm dependencies. Validation rules unchanged.

---

## 3. Determinism Proof

| Build | Size | SHA-256 |
|-------|-----:|---------|
| Build A | 170569 | `6486fbde500c01d14be0dc7704d954b1b468a975063454c32d2668005046378e` |
| Build B | 170569 | `6486fbde500c01d14be0dc7704d954b1b468a975063454c32d2668005046378e` |

**`SHA_A == SHA_B` → TRUE**

| Property | Result |
|----------|--------|
| Entry count | 130 (files only; empty dir stubs removed) |
| Entry order | identical |
| LastWriteTime diffs | 0 |
| Fixed metadata | DOS time `2026-09-02 00:00:00` on all entries |

---

## 4. Validate-Release Result

`npm run validate-release` → **READY** (`blocked_count: 0`)

| Check | Status |
|-------|--------|
| version_sync | PASS |
| release_manifest | PASS |
| plugin_valid | PASS |
| schemas_valid | PASS |
| documentation | PASS |
| no_local_paths | PASS |
| no_speed_flexy_leakage | warn (pre-existing; not a blocker) |
| secret_scan | PASS |
| distribution_tests | PASS |
| distribution_security_tests | PASS |
| checksums_manifest | PASS |

---

## 5. Security

```json
{ "findings_count": 0, "clean": true }
```

---

## 6. Artifact Integrity

| Item | Result |
|------|--------|
| Final ZIP size | **170569** bytes |
| ZIP magic | `50 4B 03 04` |
| Extraction | OK |
| File count | **130** |
| Top-level | `forgeos-1.0.0/` |
| `install-from-release --dry-run` | **INTEGRITY valid** |
| Exclusions | no `.git`, `node_modules`, `tests`, `.env`, `sim-activation`, `release/dist` (false positive only: `coverage-strategy.mjs` filename) |
| Final SHA-256 | `6486fbde500c01d14be0dc7704d954b1b468a975063454c32d2668005046378e` |
| Manifest / checksums match | YES |

---

## 7. Validation Rebuild Test

```text
SHA before validate-release: 6486fbde500c01d14be0dc7704d954b1b468a975063454c32d2668005046378e
SHA after validate-release:  6486fbde500c01d14be0dc7704d954b1b468a975063454c32d2668005046378e
```

**Identical: YES**  
(`distribution-security` still invokes `build-release`; regenerated ZIP is byte-identical.)

---

## 8. Git State

| Item | Value |
|------|-------|
| HEAD | `741622b9232550f840d76e9053b78013cdb342d4` |
| Modified (tracked) | `scripts/release/build-release.mjs`, `release/forgeos-1.0.0.zip`, `release/checksums.json`, `release/release-manifest.json`, plus prior docs path fixes |
| Untracked (relevant) | `scripts/release/deterministic-zip.mjs`, release reports |
| Commit made? | **NO** |
| Remote created? | **NO** |
| Push? | **NO** |
| Tag? | **NO** |
| GitHub Release? | **NO** |

---

## 9. Remaining Blockers

**None** for deterministic release artifact generation.

Optional non-blockers:

- `no_speed_flexy_leakage` remains a **warn**
- Uncommitted working-tree changes (intentional)

---

## 10. Verdict

# **DETERMINISTIC RELEASE ARTIFACT READY**
