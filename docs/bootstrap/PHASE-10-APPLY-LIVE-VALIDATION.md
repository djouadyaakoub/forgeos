# Phase 10 — Apply & Live Validation Report

**Date:** 2026-09-02  
**Reference project:** `C:\Apps\speed-flexy-server`  
**Universal OS:** `C:\Apps\cursor-agent-os`  
**Final status:** `PASS WITH LIMITATIONS`

---

## 1. Before state

`C:\Apps\speed-flexy-server\.agent-os\project.yaml` existed but was a **skeleton adapter**:

| Section | Before |
|---------|--------|
| `project.task_id_prefix` | `SPEEDF` (preserved) |
| `stack` | Detected correctly (go, node, flutter, java, docker) |
| `knowledge` | Basic paths only |
| `capabilities` | `[]` |
| `agents` | absent |
| `ownership` | absent |
| `policy.protected_paths` | `[]` |
| `policy.tier3_operations` | `[]` |
| `integrations.mcp` | `[]` |
| `verification.commands` | `[]` |
| `deployment` | absent |

Dry-run `proposed_adapter` (pre-apply) showed:

- **37** capabilities
- **13** agents
- **15** protected paths
- **6** project-specific Tier 3 operations
- **9** MCP integrations (metadata)
- **26** verification commands
- **3** deployment providers (fly.io, cloudflare-pages, supabase)
- **0** adapter contradictions
- **1** review note: verify `docs/STACK.md` vs Go markers

---

## 2. Applied changes

### Speed Flexy (project adapter only)

**File modified:** `C:\Apps\speed-flexy-server\.agent-os\project.yaml`

Applied via:

```powershell
node C:\Apps\cursor-agent-os\bootstrap\initialize.mjs --apply-adapter --project-dir "C:\Apps\speed-flexy-server"
```

Preserved from existing manifest:

- `project.id`, `project.name`, `project.task_id_prefix: SPEEDF`
- Stack detection and knowledge path roots

Populated from extraction:

- Full `capabilities`, `agents` (with `paths_owned` / `paths_writable` / `paths_forbidden`)
- `ownership`, `policy`, `approval.scopes`, `integrations.mcp`, `deployment`, `verification.commands`

No application code, migrations, MCP config, or `.cursor/agents/` files were modified.

### Universal OS (supporting changes — not Speed Flexy business logic)

| File | Change |
|------|--------|
| `bootstrap/initialize.mjs` | Added `--apply-adapter` flag to overwrite manifest only |
| `bootstrap/adapter-extraction.mjs` | Emit agent path ownership + shell/MCP rule patterns in YAML |
| `bootstrap/validate-applied-adapter.mjs` | Post-apply policy validation harness |
| `policy/project-adapter.mjs` | Supplement shell/MCP enforcement from project `.cursor/policy/rules.json` when YAML parser cannot round-trip nested rules |
| `policy/engine.mjs` | Defensive `rule.patterns \|\| []` guard |

---

## 3. Adapter summary (after apply)

| Metric | Value |
|--------|-------|
| Capabilities | 37 |
| Agents | 13 (orchestrator, architect, backend-api, frontend-ui, mobile, data-db, devops-release, qa-bugfix, docs-sync, security, safe-cleanup, performance, product-feature) |
| Protected paths | 15 (project-local; global `.cursor/*` baseline unchanged) |
| Tier 3 (project-specific) | 6: `destructive_sql_production`, `fly_deploy`, `ledger_manual_adjustment`, `production_debug_with_data_write`, `supabase_apply_migration_production`, `wrangler_deploy` |
| MCP metadata | 9 servers |
| Verification commands | 26 |
| Deployment | fly.io (backend), cloudflare-pages (web/app/superadmin), supabase (migrations) |
| Knowledge pointers | AGENTS.md, STACK.md, architecture, contracts, ADR, tasks, lessons, specialists, runtime_law, playbooks |

---

## 4. Tier 3 review

| Operation | In proposed adapter | Source | Escalation risk |
|-----------|---------------------|--------|-----------------|
| `fly_deploy` | Yes | `.cursor/policy/rules.json` + registry | None — approval-gated, not auto-elevated |
| `wrangler_deploy` | Yes | Same | None |
| `supabase_apply_migration_production` | Yes | Same | None |
| `destructive_sql_production` | Yes | Same | None |
| `ledger_manual_adjustment` | Yes | Same | None |
| `production_debug_with_data_write` | Yes | Same | None |

Global baseline Tier 3 ops (`git_push`, `agent_os_config_write`, etc.) remain in Universal OS — not duplicated as project-specific entries.

**Enforcement validation (no operations executed):**

- `fly deploy` without task approval → **BLOCK** ✓
- `wrangler pages deploy` with task `SF-20260901-013` approved scope → **ALLOW** ✓
- Cross-task approval lookup → **BLOCK** ✓

---

## 5. MCP review

Integrations section contains **metadata only**:

- `id`, `type`, `purpose`, `agents`, `enabled`, `source`
- No API keys, tokens, passwords, or connection secrets
- `has_env_references` flag not emitted in YAML (env refs remain in original `.cursor/mcp.json`, untouched)

Sample entries: `dart`, `supabase`, `figma`, `untitledui`, `cloudflare-*`, `stitch`.

---

## 6. Capability / agent review

- All **37 capabilities** map to registry entries in `.cursor/agents/registry.yaml` — none invented.
- All **13 agent IDs** match registry + `.cursor/agents/*.md` definitions.
- Path ownership extracted from registry `paths_owned` / `paths_writable` / `paths_forbidden`.
- Orchestrator remains read/delegate profile; specialists retain project-specific write scopes.

---

## 7. Test results (Universal OS harness)

```text
npm run test:adapter   → PASS (14/14)
npm run test:bootstrap → PASS (10/10)
npm test               → PASS (13/13)
```

Post-apply validation:

```powershell
node bootstrap/validate-applied-adapter.mjs --project-dir "C:\Apps\speed-flexy-server"
```

→ **PASS (14/14)**

---

## 8. Live Cursor results

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| **A** | Documentation routing (`docs/STACK.md`) | **PASS** | Stack from Project Knowledge: Go/Fly.io backend, Supabase Postgres, Flutter gateway, React+Vite+Untitled UI on Cloudflare Pages, Postgres queue (not Redis). Matches adapter `knowledge.stack` pointer. |
| **B** | Backend Go specialist routing | **PASS (adapter)** | Capability `go-api-handlers` → agent `backend-api`, paths `backend/**`. Routing uses capability + path + policy per registry algorithm. |
| **C** | Protected path write | **BLOCK** ✓ | `.cursor/hooks.json` denied for orchestrator |
| **D** | `fly_deploy` without approval | **BLOCK** ✓ | Tier 3 shell rule enforced |
| **E** | Task-bound approval | **PASS** ✓ | Cross-task deny; `SF-20260901-013` + `wrangler_deploy` allow |
| **F** | MCP metadata only | **PASS** | Adapter `integrations.mcp` lists purpose/agents/type — no secrets |
| **G** | Specialist ownership | **PASS** ✓ | `backend-api` → allow `backend/...`; orchestrator → deny |

**Limitation:** Tests A/B/F were validated via adapter + knowledge pointers + policy harness in this session, not as separate Orchestrator subagent invocations inside a hooked Speed Flexy Cursor workspace. Speed Flexy hooks still point to the **local** `.cursor/policy/engine.mjs` (project-native Phase 6 engine), not the Universal OS plugin engine. Full end-to-end Cursor hook routing requires pointing hooks at Universal OS or running the plugin as the active Agent OS layer.

---

## 9. Files modified

### Speed Flexy

- `C:\Apps\speed-flexy-server\.agent-os\project.yaml` (only project change for Phase 10)

### Universal OS

- `bootstrap/initialize.mjs`
- `bootstrap/adapter-extraction.mjs`
- `bootstrap/validate-applied-adapter.mjs` (new)
- `policy/project-adapter.mjs`
- `policy/engine.mjs`
- `docs/bootstrap/PHASE-10-APPLY-LIVE-VALIDATION.md` (this report)

---

## 10. Security findings

| Check | Result |
|-------|--------|
| Secret leakage in adapter YAML | **None found** |
| Tier 3 privilege escalation | **None** — agents retain registry `approval_tier_max` |
| Cross-project knowledge bleed | **None** — grep of Universal OS `policy/` and `agents/` shows no Speed Flexy business terms |
| Cross-task approval bleed | **None** — wrong task ID denied |
| Production operations executed | **None** — dry-run / policy evaluation only |

---

## 11. Remaining limitations

1. **YAML parser:** `parseSimpleYaml` cannot round-trip nested `shell_rules` / `mcp_rules` objects. Enforcement patterns are supplemented at runtime from the project's existing `.cursor/policy/rules.json` (read-only reference already present in Speed Flexy).
2. **Dual policy engines:** Speed Flexy retains its local `.cursor/policy/engine.mjs`; Universal OS uses `cursor-agent-os/policy/engine.mjs` + project adapter. Hook wiring migration is out of scope for Phase 10.
3. **Interactive Orchestrator routing:** Subagent delegation tests in live Cursor IDE were not run as isolated chat sessions; adapter + harness evidence used instead.
4. **Review note:** `docs/STACK.md` vs recursive Go marker detection — manual verification still recommended.

---

## 12. Final readiness

```text
Universal Agent OS
        ↓
Project Adapter (.agent-os/project.yaml)  ← APPLIED
        ↓
Speed Flexy Project Knowledge (docs/, AGENTS.md, registry)
        ↓
Orchestrator / Specialists (registry-driven)
        ↓
Policy / Approval / Verification         ← VALIDATED (harness)
```

**Verdict: `PASS WITH LIMITATIONS`**

The extracted adapter is applied and validated. Universal OS tests remain green. Speed Flexy was changed only in `.agent-os/project.yaml`. Global OS contains no Speed Flexy business knowledge. Tier 3 remains approval-gated with no privilege escalation.

**Recommended next step (out of Phase 10 scope):** Wire Speed Flexy `.cursor/hooks.json` to Universal OS policy hooks when ready to replace the local Phase 6 engine with the plugin runtime.
