# Release Validation Gate — Fix `no_local_paths`

**Date:** 2026-09-02  
**Path:** ForgeOS project checkout  
**Scope:** Eliminate `no_local_paths` validation failure only — no GitHub, remote, push, tag, or commit

---

## Cause

`scanLocalPaths()` in `scripts/release/validate-release.mjs` scans `docs/` for absolute machine paths, and **skips** only paths matching:

```text
docs/**/(PHASE-|REPORT|EXTRACTION)
```

These reports failed because they contain absolute developer-machine checkout paths (ForgeOS and legacy cursor-agent-os) **and** do not match that skip pattern:

| File | Why scanned |
|------|-------------|
| `FORGEOS-STATE-RECONSTRUCTION.md` | no `REPORT` / `PHASE-` / `EXTRACTION` |
| `GIT-PROVENANCE-INVESTIGATION.md` | same |
| `POST-RENAME-INTEGRITY-CHECK.md` | same |
| `REAL-RELEASE-ARTIFACT-GATE.md` | same |

Files like `FORGEOS-FOLDER-RENAME-REPORT.md` still hold absolute paths but are already exempt by the existing `REPORT` convention — **the validation rule was not weakened**.

---

## Fix

Replaced machine-specific absolute paths with neutral placeholders:

- absolute ForgeOS checkout path → `<ForgeOS checkout>`
- absolute legacy cursor-agent-os checkout path → `<legacy cursor-agent-os checkout>`

Only in the four reports above. No change to Core, adapters, builder logic for this gate, or the skip regex.

---

## Result

```text
npm run validate-release → status: READY
blocked_count: 0
no_local_paths: pass
checksums_manifest: pass
secret_scan: pass
```

One remaining **warn** only: `no_speed_flexy_leakage` (pre-existing; not a blocker).

---

## Artifact note

`validate-release` runs `distribution-security` tests, which call `build-release` and **regenerate** the ZIP. `Compress-Archive` is non-deterministic, so the SHA can change while size stays ~170842 and checksums still match the on-disk ZIP. That is a side effect of validation, not of the docs path fix.

---

## Git

No commit / remote / push / tag / GitHub Release.

Tracked edits for this gate: the two historical reports under `docs/release/` (plus untracked reports updated the same way).

---

## Verdict

**`npm run validate-release` → READY** (`no_local_paths`: pass)
