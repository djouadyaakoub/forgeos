# ForgeOS Folder Rename Report

**Date:** 2026-09-02  
**From:** `C:\Apps\cursor-agent-os`  
**To:** `C:\Apps\ForgeOS`  
**Product:** ForgeOS (folder identity aligned with product name)

---

## 1. Rename Result

**Partial rename — canonical path is now `C:\Apps\ForgeOS`.**

| Step | Result |
|------|--------|
| Direct `Rename-Item` | **Blocked** — folder in use (Cursor workspace lock) |
| Fallback | **Robocopy `/MIR`** created full copy at `C:\Apps\ForgeOS` |
| Old folder | `C:\Apps\cursor-agent-os` **still exists** (same lock) — synced from ForgeOS; **delete manually** after closing the old workspace |

No application architecture or functionality was changed.

---

## 2. Workspace Created

**`C:\Apps\ForgeOS\ForgeOS.code-workspace`**

- Single root folder: `ForgeOS` (`.`)
- Excludes `release/dist/**` from search/watch (no personal settings)

**Open this workspace in Cursor/Codex** instead of the old path.

---

## 3. References Changed

| File | Change |
|------|--------|
| `scripts/release/validate-release.mjs` | Added `C:\Apps\ForgeOS` to forbidden local-path patterns (kept legacy pattern) |
| `bootstrap/integrate-runtime.mjs` | Absolute dev-path detection includes `ForgeOS` |
| `bootstrap/validate-applied-adapter.mjs` | Same |
| `bootstrap/prove-policy-authority.mjs` | Same |
| `tests/runtime-integration.test.mjs` | Asserts no `C:/Apps/ForgeOS` in hooks |
| `tests/plugin-portability.test.mjs` | Same |
| `docs/installation.md` | Examples use `ForgeOS` checkout path |
| `docs/release/PHASE-18-FORGEOS-REBRANDING.md` | Folder name limitation updated |
| `docs/validation/PHASE-21-SIM-ACTIVATION-FULL-E2E.md` | Resolved plugin root path updated |
| `%USERPROFILE%\.cursor\agent-os\install.json` | `plugin_root` → `C:/Apps/ForgeOS` (via test run) |

---

## 4. Legacy/Compatibility References Preserved

Intentionally **unchanged**:

- Cursor marketplace plugin ID: `cursor-agent-os` (`.cursor-plugin/plugin.json`, `policy/identity.mjs`, distribution manifests)
- `CURSOR_AGENT_OS_PLUGIN_ROOT` / `AGENT_OS_PLUGIN_ROOT` env fallbacks
- `product_ids: ['cursor-agent-os', ...]` in identity
- Historical phase docs (PHASE 11–17) with old path examples
- `release/dist/cursor-agent-os-1.0.0/` frozen release artifact
- GitHub fixture URLs / zip names with `cursor-agent-os`
- `validate-release.mjs` still scans for **both** old and new dev paths

---

## 5. Validation Results

| Check | Result |
|-------|--------|
| `git rev-parse --show-toplevel` | **N/A** — no `.git` directory in either folder |
| `git status` | **N/A** — repository not initialized on disk |
| Plugin root from `C:\Apps\ForgeOS` | `C:\Apps\ForgeOS` ✓ |
| `FORGEOS_DEV_ROOT` / install manifest | Resolves correctly ✓ |
| Unintended `C:\Apps\cursor-agent-os` in active source | **None** (only tests + release gate) |
| `npm run test:branding` | 7/7 PASS |
| `npm run test:plugin` | 7/7 PASS |
| `npm run test:runtime` | 10/10 PASS |
| `npm run test:migration` | 5/5 PASS |
| `npm run test:neutrality` | 5/5 PASS |
| Full regression suites | PASS (except `test:project-two` — sim-activation untracked files, unrelated) |
| `npm run validate-release` | **READY** |

---

## 6. Remaining Issues

1. **Delete old folder** — Close Cursor workspace on `cursor-agent-os`, then remove `C:\Apps\cursor-agent-os` manually.
2. **No Git repo** — Neither path has `.git`. If Git history lives elsewhere, re-clone or restore `.git` into `C:\Apps\ForgeOS`.
3. **`test:project-two`** — Fails because `sim-activation` has extra untracked docs (not caused by this rename).
4. **Historical docs** — PHASE 11–12 still mention `C:/Apps/cursor-agent-os` as historical examples (intentional).

---

## 7. Exact New Project Path

```
C:\Apps\ForgeOS
```

**Workspace file:**

```
C:\Apps\ForgeOS\ForgeOS.code-workspace
```

---

## Recommended Next Steps

1. File → Open Workspace → `C:\Apps\ForgeOS\ForgeOS.code-workspace`
2. After confirming everything works, delete `C:\Apps\cursor-agent-os`
3. If you use Git, ensure `.git` is present or re-init from your remote
