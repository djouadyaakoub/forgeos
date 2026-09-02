# Post-Rename Integrity Check â€” ForgeOS

**Date:** 2026-09-02
**Canonical path:** `<ForgeOS checkout>`
**Previous path:** `<legacy cursor-agent-os checkout>`
**Scope:** Read-only verification â€” no code changes, no git init, no delete, no commit/push/release.

---

## Verdict: **NOT READY**

---

## 1. Ø§ÙƒØªÙ…Ø§Ù„ Ø§Ù„Ù†Ø³Ø®Ø© (`ForgeOS` vs `cursor-agent-os`)

| Ø§Ù„Ù…Ù‚ÙŠØ§Ø³ | Ø§Ù„Ù†ØªÙŠØ¬Ø© |
|---------|---------|
| Ø§Ù„Ù…Ù„ÙØ§Øª | **565** ÙÙŠ ÙƒÙ„ Ù…Ø¬Ù„Ø¯ |
| Ø§Ù„Ù…Ø¬Ù„Ø¯Ø§Øª | **207** ÙÙŠ ÙƒÙ„ Ù…Ø¬Ù„Ø¯ |
| Ù…Ù„ÙØ§Øª Ù…ÙˆØ¬ÙˆØ¯Ø© ÙÙŠ Ø£Ø­Ø¯ Ø§Ù„Ù…Ø¬Ù„Ø¯ÙŠÙ† ÙÙ‚Ø· | **0** |
| Ø§Ø®ØªÙ„Ø§Ù Ù…Ø­ØªÙˆÙ‰ (SHA256) | **1 Ù…Ù„Ù ÙÙ‚Ø·**: `release\checksums.json` |

Ø§Ù„ÙØ±Ù‚ Ø§Ù„ÙˆØ­ÙŠØ¯ ÙÙŠ `checksums.json` Ù‡Ùˆ Ø­Ù‚Ù„ `generated_at` ÙÙ‚Ø· (ØªÙˆÙ‚ÙŠØª Ù…Ø®ØªÙ„Ù Ø¨Ø³Ø¨Ø¨ ØªØ´ØºÙŠÙ„ `validate-release` Ù…Ù† `ForgeOS` Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„ÙØ­Øµ). Ø¨Ø§Ù‚ÙŠ Ø§Ù„Ù€ artifacts Ù…ØªØ·Ø§Ø¨Ù‚Ø©.

**Ø§Ù„Ø®Ù„Ø§ØµØ©:** `<ForgeOS checkout>` Ù†Ø³Ø®Ø© ÙƒØ§Ù…Ù„Ø© ÙˆÙ…ØªØ·Ø§Ø¨Ù‚Ø© Ø¹Ù…Ù„ÙŠÙ‹Ø§ Ù…Ø¹ Ø§Ù„Ù…Ø¬Ù„Ø¯ Ø§Ù„Ù‚Ø¯ÙŠÙ…. Ø§Ù„Ù‡ÙŠÙƒÙ„ Ø§Ù„Ø¹Ù„ÙˆÙŠ Ù…ØªØ·Ø§Ø¨Ù‚ (`.cursor`, `.cursor-plugin`, `adapters`, `bootstrap`, `policy`, `runtime`, `release`, `tests`, â€¦).

---

## 2. Git â€” **Blocker**

| Ø§Ù„Ù…ÙˆÙ‚Ø¹ | `.git` Ù…ÙˆØ¬ÙˆØ¯ØŸ |
|--------|---------------|
| `<ForgeOS checkout>` | **Ù„Ø§** |
| `<legacy cursor-agent-os checkout>` | **Ù„Ø§** |
| `C:\Apps` (parent) | **Ù„Ø§** |

**Ù…Ù† `<ForgeOS checkout>`:**

```
git rev-parse --show-toplevel
â†’ fatal: not a git repository (or any of the parent directories): .git

git status
â†’ fatal: not a git repository (or any of the parent directories): .git
```

**Ø§Ù„Ø³Ø¨Ø¨:** Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…Ø¬Ù„Ø¯ `.git` ÙˆÙ„Ø§ gitfile ÙˆÙ„Ø§ worktree metadata ÙÙŠ Ø£ÙŠ Ù…Ù† Ø§Ù„Ù…Ø³Ø§Ø±ÙŠÙ†. ÙŠÙˆØ¬Ø¯ `.gitignore` Ùˆ `.gitattributes` Ùˆ `.github/` Ù„ÙƒÙ† **Ø¨Ø¯ÙˆÙ† repository ÙØ¹Ù„ÙŠ Ø¹Ù„Ù‰ Ø§Ù„Ù‚Ø±Øµ**.

**Ù…Ø¹ÙŠØ§Ø± Ø§Ù„Ù‚Ø±Ø§Ø±:** ØºÙŠØ§Ø¨ Git metadata ÙÙŠ `ForgeOS` = blocker. Ù„Ù… ÙŠÙØ¬Ø±ÙŽ `git init` ÙˆÙ„Ø§ re-clone ÙˆÙ„Ø§ Ø£ÙŠ Ø¥ØµÙ„Ø§Ø­ ØªÙ„Ù‚Ø§Ø¦ÙŠ.

---

## 3. `ForgeOS.code-workspace`

**ØµØ§Ù„Ø­** â€” JSON ÙŠÙ parse Ø¨Ù†Ø¬Ø§Ø­:

- Root ÙˆØ§Ø­Ø¯: `"name": "ForgeOS"`, `"path": "."`
- Excludes Ù„Ù€ `release/dist/**` Ùˆ `node_modules/**`

**Ù…Ø³Ø§Ø± Ø§Ù„Ù…Ù„Ù:**

```
<ForgeOS checkout>\ForgeOS.code-workspace
```

---

## 4. Ø§Ù„ØªÙƒÙˆÙŠÙ† ÙˆØ§Ù„Ù…Ø±Ø§Ø¬Ø¹

| Ø§Ù„Ø¹Ù†ØµØ± | Ø§Ù„Ø­Ø§Ù„Ø© |
|--------|--------|
| `FORGEOS_DEV_ROOT` | ÙŠÙÙ‚Ø±Ø£ Ù…Ù† env Ø¹Ø¨Ø± `policy/identity.mjs` â€” Ù„Ø§ hardcode Ù„Ù…Ø³Ø§Ø± Ù‚Ø¯ÙŠÙ… |
| Install manifest | `%USERPROFILE%\.cursor\agent-os\install.json` â†’ `"plugin_root": "<ForgeOS checkout>"` âœ“ |
| Plugin root resolution | `<ForgeOS checkout>` (source: `user_install_manifest`) âœ“ |
| Runtime / policy / distribution | `product_id: forgeos`, `repository: forgeos`, `plugin_id: cursor-agent-os` (legacy adapter ID â€” Ù…Ù‚ØµÙˆØ¯) âœ“ |
| Cursor adapter | `adapters/cursor/manifest.json` â†’ `product: forgeos`, `plugin_id: cursor-agent-os` âœ“ |

### Ù…Ø±Ø§Ø¬Ø¹ `<legacy cursor-agent-os checkout>`

**Ù…Ø±Ø§Ø¬Ø¹ ØºÙŠØ± Ù…Ù‚ØµÙˆØ¯Ø© ÙÙŠ active source:** **Ù„Ø§ ÙŠÙˆØ¬Ø¯**

Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø© Ù…Ù‚ØµÙˆØ¯Ø© Ø£Ùˆ Ù…Ø³Ù…ÙˆØ­Ø©:

- `cursor-agent-os` ÙƒÙ€ legacy/plugin ID
- compatibility environment variables
- frozen historical release artifacts (`release/dist/cursor-agent-os-1.0.0/`)
- historical documentation (PHASE 11â€“17)
- tests ÙƒÙ€ guard assertions (`tests/runtime-integration.test.mjs`, `tests/plugin-portability.test.mjs`)
- `scripts/release/validate-release.mjs` ÙƒÙ€ forbidden pattern scanner

---

## 5. Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª

| Test | Result |
|------|--------|
| `npm run test:branding` | 7/7 PASS |
| `npm run test:plugin` | 7/7 PASS |
| `npm run test:runtime` | 10/10 PASS |
| `npm run test:migration` | 5/5 PASS |
| `npm run test:neutrality` | 5/5 PASS |
| `npm run validate-release` | **READY** (0 blocked, 1 warn: speed-flexy ÙÙŠ docs/historical) |

---

## 6. Ù„Ù…Ø§Ø°Ø§ NOT READYØŸ

1. **Git metadata Ù…ÙÙ‚ÙˆØ¯Ø© Ù…Ù† `<ForgeOS checkout>`** â€” blocker ØµØ±ÙŠØ­. Ù„Ø§ ÙŠÙ…ÙƒÙ† `git status` ÙˆÙ„Ø§ `git rev-parse` ÙˆÙ„Ø§ Ø£ÙŠ Ø¹Ù…Ù„ÙŠØ§Øª git Ù…Ù† Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„Ø¬Ø¯ÙŠØ¯.
2. Ø§Ù„Ù…Ø¬Ù„Ø¯ Ø§Ù„Ù‚Ø¯ÙŠÙ… **Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Git Ø£ÙŠØ¶Ù‹Ø§** â€” Ø­Ø°ÙÙ‡ Ù„Ù† ÙŠÙÙ‚Ø¯ `.git` Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ `ForgeOS`ØŒ Ù„ÙƒÙ† **Ø§Ù„Ù…Ø´Ø±ÙˆØ¹ ÙƒÙƒÙ„ Ù„ÙŠØ³ git-backed Ù…Ø­Ù„ÙŠÙ‹Ø§** Ø­ØªÙ‰ Ø¨Ø¹Ø¯ Ø§Ù„Ø­Ø°Ù.
3. `release\checksums.json` ÙŠØ®ØªÙ„Ù timestamp Ø¨ÙŠÙ† Ø§Ù„Ù…Ø¬Ù„Ø¯ÙŠÙ† (ØªØ§ÙÙ‡ØŒ Ù„ÙŠØ³ blocker Ù„Ù„Ø­Ø°Ù).

---

## 7. Ù‚Ø¨Ù„ Ø£Ù† ØªØµØ¨Ø­ READY TO DELETE OLD FOLDER

1. **Ø§Ø³ØªØ¹Ø¯ `.git`** â€” re-clone Ù…Ù† remoteØŒ Ø£Ùˆ Ø§Ù†Ø³Ø® `.git` Ù…Ù† Ù…ØµØ¯Ø± Ù…ÙˆØ«ÙˆÙ‚ØŒ Ø£Ùˆ `git init` + remote (ÙŠØ¯ÙˆÙŠÙ‹Ø§).
2. ØªØ­Ù‚Ù‚ Ø£Ù† `git rev-parse --show-toplevel` ÙŠÙØ±Ø¬Ø¹ `<ForgeOS checkout>`.
3. Ø£ØºÙ„Ù‚ workspace Ø¹Ù„Ù‰ `cursor-agent-os` Ø«Ù… Ø§Ø­Ø°Ù `<legacy cursor-agent-os checkout>` ÙŠØ¯ÙˆÙŠÙ‹Ø§.

---

## 8. Ù…Ø§ Ù„Ù… ÙŠÙÙ†ÙÙ‘ÙŽØ° (Ø­Ø³Ø¨ Ø§Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª)

- Ù„Ù… ÙŠÙØ­Ø°Ù `<legacy cursor-agent-os checkout>`
- Ù„Ù… ÙŠÙØ¹Ø¯Ù‘ÙŽÙ„ Ø£ÙŠ Ù…Ù„Ù (Ø¨Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ø¥Ù†Ø´Ø§Ø¡ Ù‡Ø°Ø§ Ø§Ù„ØªÙ‚Ø±ÙŠØ±)
- Ù„Ù… ÙŠÙÙ†Ø´Ø£ commit Ø£Ùˆ push Ø£Ùˆ release
- Ù„Ù… ÙŠÙØ¬Ø±ÙŽ `git init` ÙˆÙ„Ø§ re-clone ÙˆÙ„Ø§ Ø£ÙŠ Ø¥ØµÙ„Ø§Ø­ git ØªÙ„Ù‚Ø§Ø¦ÙŠ
