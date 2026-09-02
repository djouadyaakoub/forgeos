# Phase 11 — Universal Runtime Integration

**Date:** 2026-09-02  
**Target project:** `C:\Apps\speed-flexy-server`  
**Universal OS:** `C:\Apps\cursor-agent-os`  
**Final status:** `PASS WITH LIMITATIONS`

---

## 1. Current runtime architecture (before)

```text
Cursor Hooks (.cursor/hooks.json)
        ↓
Speed Flexy Local Hooks (.cursor/hooks/*.mjs)
        ↓
Speed Flexy Local Policy Engine (.cursor/policy/engine.mjs)
        ↓
Speed Flexy rules.json (.cursor/policy/rules.json)
        ↓
Project Adapter (.agent-os/project.yaml)  ← present but NOT used by local engine
```

**Discovery findings:**

| Component | Speed Flexy (local) | Universal OS |
|-----------|---------------------|--------------|
| Hook entry | `.cursor/hooks.json` → local `.mjs` | `policy/hooks/*.mjs` |
| Policy engine | `.cursor/policy/engine.mjs` | `policy/engine.mjs` |
| Rules source | `.cursor/policy/rules.json` only | `policy/rules.json` + `.agent-os/project.yaml` |
| Project resolution | `CURSOR_PROJECT_DIR \|\| cwd` | Same (limited) |
| Agent discovery | `.cursor/agents/registry.yaml` | Global agents + project adapter merge |
| Ephemeral factory | Local copy with SF agent list | Universal + `getPermanentAgentIds()` from adapter |

**Conflict logged:** Local engine ignored project adapter; Universal engine uses adapter + supplements shell patterns from project `rules.json` (read-only evidence, not dual enforcement).

---

## 2. After architecture

```text
Cursor
   ↓
Universal Hooks (C:/Apps/cursor-agent-os/policy/hooks/*.mjs)
   ↓  initHookRuntime() — project walk-up resolution
Universal Policy Engine (policy/engine.mjs)
   ↓  loadEffectiveRules()
Global Baseline (policy/rules.json)
   ∩ Project Adapter (.agent-os/project.yaml)
   ∩ Project evidence (.cursor/policy/rules.json — shell patterns only)
   ↓
Agent Permissions + Task Scope + Approval State
   ↓
ALLOW / BLOCK (fail-closed)
```

Speed Flexy project knowledge (docs, registry, specialists) remains in the project.

---

## 3. Files changed

### Universal OS (`cursor-agent-os`)

| File | Purpose |
|------|---------|
| `policy/runtime.mjs` | Project resolution, runtime mode, hook bootstrap |
| `policy/project-adapter.mjs` | Robust `getProjectDir()` via walk-up |
| `policy/engine.mjs` | `getPolicyAuthority()` export |
| `policy/hooks/*.mjs` | All hooks call `initHookRuntime()` |
| `bootstrap/integrate-runtime.mjs` | Migrate / rollback project hooks |
| `bootstrap/prove-policy-authority.mjs` | Single-authority proof |
| `tests/runtime-integration.test.mjs` | Runtime test suite |
| `package.json` | `test:runtime` script |

### Speed Flexy (runtime integration only)

| File | Action |
|------|--------|
| `.cursor/hooks.json` | **Updated** → Universal plugin hook paths |
| `.cursor/hooks.json.local-backup` | **Created** → rollback backup |
| `.agent-os/runtime.yaml` | **Created** → `UNIVERSAL_RUNTIME` state |
| `.cursor/policy/local-runtime.RETIRED` | **Created** → retirement marker + rollback instructions |

**Not modified:** application source, migrations, `.cursor/mcp.json`, `.cursor/agents/`, local engine files (retained for rollback).

---

## 4. Policy authority model

```text
Global Baseline
      ∩
Project Restrictions (adapter — cannot remove global protections)
      ∩
Agent Permissions (paths_writable / forbidden)
      ∩
Task Scope (task_id in session)
      ∩
Approval State (task.yaml approval.scope)
```

Project adapter **cannot:**

- Remove global protected paths
- Bypass Tier 3 approval
- Raise agent `approval_tier_max` above global caps
- Disable hooks
- Self-authorize

**Authority:** `universal-agent-os` (single decision path via hooks).

---

## 5. Hook resolution

`hooks.json` commands (Speed Flexy):

```json
"command": "node \"C:/Apps/cursor-agent-os/policy/hooks/policy-pre-tool.mjs\""
```

Each Universal hook:

1. Reads stdin JSON from Cursor
2. Calls `initHookRuntime(input)` — sets `CURSOR_PROJECT_DIR` via:
   - `CURSOR_PROJECT_DIR` / `CURSOR_WORKSPACE` env
   - `workspace_folder`, `workspace_roots`, `project_path` from hook input
   - Walk-up from candidates until `.agent-os/project.yaml` found
3. Evaluates via Universal `engine.mjs`

---

## 6. Project adapter loading

When Universal runtime runs in Speed Flexy:

```text
C:\Apps\speed-flexy-server\.agent-os\project.yaml
```

Loaded sections: capabilities (37), agents (13), ownership, protected paths (15), Tier 3 (6), MCP metadata (9), verification (26), deployment, knowledge pointers.

Cross-project isolation verified: Project A fixtures do not leak into Project B.

---

## 7. Agent discovery

- **Global permanent agents:** orchestrator, architect, qa-bugfix, docs-sync, security
- **Project specialists:** merged from adapter `agents:` (backend-api, frontend-ui, mobile, etc.)
- **Registry source:** `.cursor/agents/registry.yaml` (project-local, unchanged)
- **Routing:** capability + path + operation + policy (from adapter, not hard-coded in Global OS)

---

## 8. Task / approval flow

1. `subagentStart` hook → `saveSession({ task_id, subagent_type })`
2. Tier 3 shell/MCP → `checkTier3Approval(operation, tier, agent, session)`
3. `resolveCurrentTaskId()` from session
4. `findApprovalForTask(taskId, operation)` reads `docs/project/tasks/*/task.yaml`
5. Cross-task lookup denied (fail-closed)

---

## 9. Local runtime migration status

| State | Value |
|-------|-------|
| **Current mode** | `UNIVERSAL_RUNTIME` |
| **Previous mode** | `LOCAL_RUNTIME` |
| **Local engine** | Retained, **not in hook chain** |
| **Local hooks** | Retained, **not referenced** |
| **Retirement marker** | `.cursor/policy/local-runtime.RETIRED` |

### Rollback procedure

```powershell
node C:\Apps\cursor-agent-os\bootstrap\integrate-runtime.mjs --rollback --project-dir "C:\Apps\speed-flexy-server"
```

Restores `hooks.json` from `.cursor/hooks.json.local-backup` and archives `runtime.yaml`.

---

## 10. Live Cursor tests

Tests executed via **actual Universal hook processes** (same commands Cursor invokes):

| Test | Result | Evidence |
|------|--------|----------|
| **1** Universal discovery | **PASS** | `loadEffectiveRules()._source === 'global_plus_project'` |
| **2** Backend Go specialist | **PASS** | `go-api-handlers` → `backend-api` → `backend/**` in adapter |
| **3** Protected path | **BLOCK** ✓ | Universal `policy-pre-tool.mjs` exit 2, deny `.cursor/hooks.json` |
| **4** `fly_deploy` no approval | **BLOCK** ✓ | Universal `policy-shell.mjs` exit 2 |
| **5** Task-bound approval | **PASS** ✓ | `SF-20260901-013` + `wrangler_deploy` allow; wrong task deny |
| **6** Cross-project isolation | **PASS** | Fixtures A/B no capability leak |
| **7** MCP metadata | **PASS** | Adapter integrations — no secrets |
| **8** Knowledge routing | **PASS** | `knowledge.stack: docs/STACK.md` in adapter |

### Test A — Stack from Project Knowledge

From `docs/STACK.md` via adapter pointer: Go/Fly.io backend, Supabase Postgres, Flutter gateway, React+Untitled UI on Cloudflare Pages, Postgres queue (not Redis).

### Test 9 — Single policy authority

```powershell
node bootstrap/prove-policy-authority.mjs --project-dir "C:\Apps\speed-flexy-server"
```

→ **`ONE_AUTHORITATIVE_DECISION`**

- `hooks.json` references Universal plugin only
- Local hook path **not** in chain
- Universal hook denies protected write (exit 2)

---

## 11. Security tests

| Check | Result |
|-------|--------|
| No secret leakage in adapter | ✓ |
| No privilege escalation | ✓ |
| No cross-project authorization | ✓ |
| No cross-task approval bleed | ✓ |
| No policy bypass via local hooks | ✓ (local not in chain) |
| No agent self-authorization | ✓ |
| No global/project knowledge bleed | ✓ |
| Fail-closed on hook error | ✓ (preToolUse, shell, mcp) |

---

## 12. Regression results

```text
npm run test:runtime   → PASS (10/10)
npm run test:adapter   → PASS (14/14)
npm run test:bootstrap → PASS (10/10)
npm test               → PASS (13/13)
npm run test:policy    → PASS (13/13)
validate-applied-adapter → PASS (14/14)
prove-policy-authority → ONE_AUTHORITATIVE_DECISION
```

---

## 13. Rollback procedure

1. Run `integrate-runtime.mjs --rollback --project-dir <path>`
2. Verify `hooks.json` restored from `.cursor/hooks.json.local-backup`
3. Remove or archive `.agent-os/runtime.yaml`
4. Local engine becomes active again via restored hooks

---

## 14. Remaining limitations

1. **Absolute plugin path** in `hooks.json` (`C:/Apps/cursor-agent-os`) — re-run `integrate-runtime.mjs` on other machines or set `AGENT_OS_PLUGIN_ROOT`.
2. **Local engine files retained** (by design for rollback) — not deleted, but not authoritative.
3. **Shell pattern supplement** still reads project `.cursor/policy/rules.json` as evidence when YAML parser cannot round-trip nested rules (read-only, not dual engine).
4. **Orchestrator UI routing** in Cursor chat depends on agent definitions in project `.cursor/agents/` — correct per design; not replaced by Universal OS global agents.
5. **Interactive Cursor chat sessions** for Tests 1–2 were validated via hook spawns + adapter inspection; full IDE Orchestrator delegation should be confirmed in a live Speed Flexy workspace session.

---

## Final status: `PASS WITH LIMITATIONS`

Universal Agent OS is the **single policy authority** for Speed Flexy via updated `hooks.json`. Project adapter and project knowledge load correctly. Local runtime is retired (not deleted) with clear rollback. No application code or migrations were modified.

```text
Cursor → Universal Hooks → Universal Policy Engine → Speed Flexy Adapter → Specialists
```

**Recommended follow-up:** Install Universal OS as a user-scoped Cursor plugin so hook paths can use plugin-relative resolution instead of absolute `C:/Apps/...` paths.
