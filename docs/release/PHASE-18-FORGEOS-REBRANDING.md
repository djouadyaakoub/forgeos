# Phase 18 — ForgeOS Rebranding & Editor-Agnostic Core

**Status: PASS WITH LIMITATIONS**  
**Date:** 2026-09-02  
**Version:** 1.0.0

> **Historical note:** `cursor-agent-os` is the historical predecessor name of **ForgeOS**. Phase 1–17 reports retain the old name as historical documentation.

---

## 1. Before architecture

```text
cursor-agent-os (product = Cursor Agent OS)
├── policy/, intelligence/, agents/ (mixed core + Cursor assumptions)
├── .cursor-plugin/ (plugin identity = product identity)
├── CURSOR_AGENT_OS_PLUGIN_ROOT
└── agent_os: in project.yaml
```

**Problem:** Product identity coupled to Cursor; Core read Cursor env vars and used Cursor-centric naming.

---

## 2. After architecture

```text
ForgeOS (Universal Development Intelligence Platform)
├── Core
│   ├── policy/, intelligence/, agents/, runtime/
│   ├── schemas/, bootstrap/, knowledge/
│   └── policy/identity.mjs (canonical naming)
│
├── Runtime Interface
│   ├── runtime/interface.mjs (events, agents, tools)
│   └── runtime/host-registry.mjs
│
├── Adapters
│   ├── adapters/cursor/ (plugin, hooks bridge)
│   └── adapters/cli/ (boundary only)
│
└── Project Adapter
    └── .agent-os/project.yaml (path unchanged)
        forgeos: / agent_os: (both supported)
```

```text
ForgeOS Core ≠ Cursor
Cursor → ForgeOS Adapter → Runtime → Core
```

---

## 3. Rename map

| Before | After | Notes |
|--------|-------|-------|
| `cursor-agent-os` (package) | `forgeos` | `package.json` |
| Universal Cursor Agent OS | ForgeOS | Product name |
| `CURSOR_AGENT_OS_PLUGIN_ROOT` | `FORGEOS_ROOT` | Legacy env still read |
| `AGENT_OS_PLUGIN_ROOT` | `FORGEOS_ROOT` | Legacy fallback |
| `agent-os update status` | `forgeos update status` | CLI string |
| `plugin_id: cursor-agent-os` (distribution) | `plugin_id: forgeos` | Release manifest |
| `universal-agent-os` (policy authority) | `forgeos` | `POLICY_AUTHORITY` |
| `agent_os:` (project block) | `forgeos:` | Both supported |
| GitHub `repository: cursor-agent-os` | `repository: forgeos` | distribution.yaml |

**Unchanged (Cursor adapter boundary):**

| Item | Value |
|------|-------|
| Cursor plugin manifest `name` | `cursor-agent-os` |
| `.cursor-plugin/plugin.json` | Marketplace compatibility |
| `CURSOR_PROJECT_DIR` | Cursor IDE contract |
| `.agent-os/project.yaml` path | Backward compatibility |
| `~/.cursor/agent-os/install.json` | Legacy install path (also `forge-os/`) |

---

## 4. Core / adapter boundaries

| Layer | Path | Rule |
|-------|------|------|
| Core | `policy/`, `intelligence/`, `runtime/`, `agents/` | No imports from `adapters/cursor/` |
| Cursor Adapter | `adapters/cursor/` | May depend on Core |
| CLI boundary | `adapters/cli/boundary.mjs` | Conceptual only |
| Generic host | `tests/fixtures/generic-host/` | Proves neutrality |

Enforced by `tests/architecture/editor-neutral.test.mjs` and `scripts/validate-branding.mjs`.

---

## 5. Runtime abstraction

**Schemas:**
- `schemas/host-adapter.yaml`
- `schemas/runtime-event.yaml`

**Modules:**
- `runtime/interface.mjs` — `createRuntimeEvent()`, agent invocation types, tool provider
- `runtime/host-registry.mjs` — `cursor`, `cli`, `generic` hosts

**Flow:**

```text
Host payload → Host Adapter → ForgeOS Runtime Event → Policy → Orchestrator
```

---

## 6. Cursor adapter

`adapters/cursor/`:

| File | Role |
|------|------|
| `manifest.json` | Adapter metadata, `plugin_id: cursor-agent-os` |
| `integration.mjs` | `normalizeCursorHookPayload()` → runtime event |

`.cursor-plugin/plugin.json`:
- `displayName`: **ForgeOS for Cursor**
- `name`: `cursor-agent-os` (marketplace ID)
- `forgeos.product_id`: `forgeos`

---

## 7. Project adapter migration

**Read-time compat:** `normalizeProjectManifest()` maps `agent_os:` → `forgeos:`

**Migration tool:** `bootstrap/migrate-to-forgeos.mjs`

```text
detect legacy → plan → backup → migrate → validate → rollback
```

**Example:**

```yaml
forgeos:
  version: ">=1.0 <2.0"
  adapter_schema_version: 1
  compatibility:
    legacy_identifiers: [agent_os]
```

`.agent-os/` directory path **unchanged** for backward compatibility.

---

## 8. Environment variable migration

| New | Legacy (still supported) |
|-----|--------------------------|
| `FORGEOS_ROOT` | `CURSOR_AGENT_OS_PLUGIN_ROOT`, `AGENT_OS_PLUGIN_ROOT` |
| `FORGEOS_DEV_ROOT` | `AGENT_OS_DEV_ROOT` |
| `FORGEOS_TEST_DIR` | `AGENT_OS_TEST_DIR` |

**Never renamed (Cursor IDE):** `CURSOR_PROJECT_DIR`, `CURSOR_WORKSPACE`

---

## 9. Documentation migration

| Document | Status |
|----------|--------|
| `README.md` | Rewritten — ForgeOS-first |
| `docs/architecture/EDITOR-NEUTRALITY.md` | New |
| Phase 1–17 reports | Historical (old name retained) |

---

## 10. GitHub identity preparation

`policy/distribution.yaml`:

```yaml
distribution:
  source:
    repository: forgeos
    plugin_id: forgeos
adapters:
  cursor:
    plugin_id: cursor-agent-os
```

`owner:` left empty for future configuration.

---

## 11. Neutrality tests

| Test | Result |
|------|--------|
| `npm run test:neutrality` | 5/5 PASS |
| Core does not import `adapters/cursor` | ✓ |
| Generic host runs orchestrator | ✓ |
| Cursor adapter normalizes events | ✓ |

---

## 12. Migration tests

| Test | Result |
|------|--------|
| `npm run test:migration` | 5/5 PASS |
| `agent_os` → `forgeos` normalize | ✓ |
| migrate-to-forgeos plan | ✓ |
| apply + rollback | ✓ |

---

## 13. Branding tests

| Test | Result |
|------|--------|
| `npm run test:branding` | 7/7 PASS |
| `npm run validate-branding` | PASS |

---

## 14. Security

| Check | Status |
|-------|--------|
| No secrets in repo | ✓ |
| No hard-coded dev paths in Core | ✓ |
| No Speed Flexy leakage | ✓ |
| No Core → Cursor adapter dependency | ✓ |
| Cursor adapter privilege escalation | N/A |

---

## 15. Regression

| Suite | Result |
|-------|--------|
| `npm test` | 13/13 |
| `npm run test:policy` | 13/13 |
| `npm run test:bootstrap` | 10/10 |
| `npm run test:adapter` | 14/14 |
| `npm run test:runtime` | 10/10 |
| `npm run test:plugin` | 7/7 |
| `npm run test:intelligence` | 38/38 |
| `npm run test:orchestration` | 35/35 |
| `npm run test:deployment` | 36/36 |
| `npm run test:distribution` | 25/25 |
| `npm run test:security` | 25/25 |
| `npm run test:neutrality` | 5/5 |
| `npm run test:migration` | 5/5 |
| `npm run test:branding` | 7/7 |

---

## 16. Remaining Cursor coupling

| Item | Classification | Plan |
|------|----------------|------|
| `.cursor-plugin/` at repo root | CURSOR_ADAPTER | Future: move under `adapters/cursor/plugin/` |
| Hook shims `.cursor/hooks/agent-os/` | CURSOR_ADAPTER | Add `forge-os/` alias |
| `~/.cursor/` install paths | CURSOR_ADAPTER | Dual `forge-os/` + `agent-os/` |
| Bootstrap headers (some files) | LEGACY | Incremental cleanup |
| Phase 1–17 docs | HISTORICAL | Intentionally retained |
| Workspace folder name `ForgeOS` | DEV_ONLY | Not a runtime dependency |

---

## 17. Limitations

1. **No mass file restructure** — abstraction layer used instead of moving all files to `core/` to reduce risk
2. **VS Code / JetBrains** — architecture boundary only, no implementation
3. **CLI** — conceptual commands defined, not full CLI
4. **Repository folder** — `ForgeOS` on disk (dev checkout); product identity is `forgeos` in metadata
5. **Cursor plugin ID** — remains `cursor-agent-os` for marketplace compatibility

---

## 18. Success criteria

| Criterion | Status |
|-----------|--------|
| Product identity is ForgeOS | ✓ |
| Core is editor-neutral | ✓ |
| Cursor is an adapter | ✓ |
| Core does not depend on Cursor adapter | ✓ |
| Cursor integration still works | ✓ |
| Project adapter migration defined | ✓ |
| Legacy identifiers controlled | ✓ |
| No Speed Flexy leakage | ✓ |
| No secrets | ✓ |
| No hard-coded dev path in Core | ✓ |
| Generic host fixture works | ✓ |
| Cursor host regression works | ✓ |
| Previous tests green | ✓ |

---

## 19. E2E scenarios

### Generic Host

```text
Generic Host → ForgeOS Runtime → Orchestrator → Specialist
```

**Result:** PASS (no Cursor required)

### Cursor Host

```text
Cursor → Cursor Adapter → ForgeOS Runtime → Orchestrator → Specialist
```

**Result:** PASS (plugin, runtime, policy tests green)

---

**Phase 18 = PASS WITH LIMITATIONS**

Architecture neutralization complete. Multi-editor implementation deferred to future phases.

No GitHub push, release, or tag created. Speed Flexy not modified.
