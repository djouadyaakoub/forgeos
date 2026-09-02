# Phase 12 — User-Scoped Plugin & Full Orchestrator E2E

**Date:** 2026-09-02  
**Universal OS:** `C:\Apps\cursor-agent-os`  
**Reference project:** `C:\Apps\speed-flexy-server`  
**Final status:** `PASS WITH LIMITATIONS`

---

## 1. Plugin architecture (audit)

### Before Phase 12

| Area | State |
|------|-------|
| Plugin manifest | `.cursor-plugin/plugin.json` — metadata only, no paths |
| Plugin root | Hard-coded `C:/Apps/cursor-agent-os` in `hooks.json` |
| Runtime resolution | `AGENT_OS_PLUGIN_ROOT` or dev checkout dirname |
| Hooks | Absolute paths to plugin `policy/hooks/*` |
| User install | None — dev repo path required |
| Project portability | **Blocked** by absolute machine paths |

### After Phase 12

| Area | State |
|------|-------|
| Plugin manifest | Extended with `agents`, `skills`, `hooks`, `rules` paths |
| Plugin root | `policy/plugin-root.mjs` — multi-source resolution |
| User install | `bootstrap/install-plugin.mjs` → `~/.cursor/agent-os/install.json` |
| Project hooks | **Portable shims** at `.cursor/hooks/agent-os/*.mjs` |
| `hooks.json` | `node .cursor/hooks/agent-os/policy-pre-tool.mjs` (no absolute path) |
| `runtime.yaml` | `plugin_id` + `hook_strategy: portable_shim` (no dev path) |

### Resolution order (`policy/plugin-root.mjs`)

1. `CURSOR_AGENT_OS_PLUGIN_ROOT`
2. `AGENT_OS_PLUGIN_ROOT` (legacy)
3. `%USERPROFILE%\.cursor\agent-os\install.json`
4. Cursor plugin cache scan (`~/.cursor/plugins/cache`)
5. `AGENT_OS_DEV_ROOT` (development)
6. Development checkout fallback

---

## 2. Installation model

```powershell
# Once per machine (user scope)
cd C:\path\to\cursor-agent-os
node bootstrap/install-plugin.mjs

# Per project
node bootstrap/integrate-runtime.mjs --project-dir "C:\path\to\project"
node bootstrap/initialize.mjs --apply-adapter --project-dir "C:\path\to\project"
```

Install manifest written:

```text
%USERPROFILE%\.cursor\agent-os\install.json
```

```json
{
  "plugin_id": "cursor-agent-os",
  "plugin_root": "C:/Apps/cursor-agent-os",
  "version": "1.0.0",
  "installed_at": "..."
}
```

Projects need only:

```text
Global Plugin  +  .agent-os/project.yaml  +  Project Knowledge
```

---

## 3. Runtime root resolution

Portable shim (`.cursor/hooks/agent-os/policy-pre-tool.mjs`):

1. Reads env vars (`CURSOR_AGENT_OS_PLUGIN_ROOT`, `AGENT_OS_PLUGIN_ROOT`)
2. Reads user install manifest
3. Optionally `AGENT_OS_DEV_ROOT`
4. Spawns real Universal hook from resolved plugin root
5. **Fail-closed** if plugin not found (exit 2, deny JSON)

---

## 4. Before/after hook paths

### Before (Phase 11)

```json
"command": "node \"C:/Apps/cursor-agent-os/policy/hooks/policy-pre-tool.mjs\""
```

### After (Phase 12)

```json
"command": "node .cursor/hooks/agent-os/policy-pre-tool.mjs"
```

`absolute_dev_path_in_hooks: false` verified by integrate-runtime.

---

## 5. Project adapter loading

Speed Flexy adapter loads via Universal engine:

- `rules._source === 'global_plus_project'`
- 37 capabilities, 13 agents, `backend-api` with `backend/**` ownership
- Knowledge pointers: `docs/STACK.md`, `AGENTS.md`, contracts, ADR, tasks

Cross-project: `tests/fixtures/sample-project` loads `api-specialist` only — no Speed Flexy leakage.

---

## 6. Full Orchestrator E2E

**Task (read-only):** Analyze backend architecture without modifying files.

### Routing trail (`bootstrap/e2e-orchestrator.mjs`)

| Step | Result |
|------|--------|
| discover_project | `INITIALIZED` |
| load_adapter | `speed-flexy-server`, 37 capabilities |
| classify | domain: `backend` |
| select_capability | `go-api-handlers`, `wss-hub`, `openapi` |
| select_specialist | **`backend-api`** |
| knowledge | `docs/STACK.md` ✓, `AGENTS.md` ✓ |
| policy_authority | `global_plus_project` |
| verification | 26 commands |

### Orchestrator final answer (from Project Knowledge + `backend/` inspection)

| Component | Finding |
|-----------|---------|
| **Primary backend** | Go 1.22 monolith at `backend/` |
| **Entrypoint** | `backend/cmd/server/main.go` |
| **HTTP framework** | Fiber v2 (`github.com/gofiber/fiber/v2`) |
| **API layer** | `internal/api` — `api.New(...)` registers REST + platform routes |
| **WSS hub** | `internal/wss` — WebSocket via `gofiber/websocket` |
| **Persistence** | PostgreSQL via `pgx/v5` (`internal/store`) — Supabase in production |
| **Queue** | `internal/queue` — Postgres-backed (not Redis) |
| **Ledger** | `internal/ledger` — centimes hold/capture |
| **Workers** | `internal/worker` — queue consumer |
| **Auth** | `internal/auth` — Supabase JWT + device tokens |
| **Deployment** | Fly.io — `backend/fly.toml`, app `speed-flexy-server-all`, region `cdg` |
| **Verification** | `cd backend && go build ./...`, `cd backend && go test ./...` |

**No files modified.**

---

## 7. Specialist E2E (backend-api)

**Task:** Inspect `backend/` — framework, entrypoint, routing, verification.

| Check | Result |
|-------|--------|
| capability | `go-api-handlers` |
| specialist | `backend-api` |
| path ownership | `backend/**` |
| mode | read/explore only |
| verification commands | from adapter: `go build`, `go test` |

Evidence: `main.go` wires `api.New`, `wss.New`, `queue.New`, `ledger.New`, `worker` — matches adapter capabilities `go-api-handlers`, `wss-hub`, `postgres-queue-worker`, `ledger-integration`.

---

## 8. Policy E2E (portable shims — Cursor hook path)

Executed via Speed Flexy `.cursor/hooks/agent-os/*` (same commands Cursor invokes):

| Test | Command / action | Result |
|------|------------------|--------|
| **A** | Write `.cursor/hooks.json` | **BLOCK** (exit 2) — Universal policy |
| **B** | `fly deploy` (no session) | **BLOCK** — `missing task identity (fail closed)` |
| **C allow** | `wrangler pages deploy` + task `SF-20260901-013` | **ALLOW** (harness) |
| **C deny** | Same op, wrong task | **BLOCK** |

`prove-policy-authority.mjs` → **`ONE_AUTHORITATIVE_DECISION`**

---

## 9. Project isolation

| Check | Result |
|-------|--------|
| Global plugin has no Speed Flexy terms | ✓ (grep `agents/`, `policy/rules.json`) |
| Sample project no `backend-api` | ✓ |
| Sample project no `fly_deploy` | ✓ |
| Speed Flexy no sample `api-specialist` bleed | ✓ |

---

## 10. Fresh-machine simulation

Test: clear `AGENT_OS_DEV_ROOT`, rely on `install.json` only.

```text
npm run test:plugin → PASS (7/7)
  - Runtime works when dev path env cleared
  - Portable shim delegates via install manifest
```

Simulates: dev checkout path unavailable → user install manifest → runtime works.

---

## 11. Test results

```text
npm run test:plugin    → PASS (7/7)
npm run test:runtime   → PASS (10/10)
npm run test:adapter   → PASS (14/14)
npm run test:bootstrap → PASS (10/10)
npm test               → PASS (13/13)
npm run test:policy    → PASS (13/13)
prove-policy-authority → ONE_AUTHORITATIVE_DECISION
e2e-orchestrator       → backend-api routing OK
```

---

## 12. Security results

| Check | Result |
|-------|--------|
| No secret leakage in adapter/plugin | ✓ |
| No hard-coded credentials | ✓ |
| No Speed Flexy knowledge in global plugin | ✓ |
| No cross-project adapter access | ✓ |
| No cross-task approval bleed | ✓ |
| No privilege escalation | ✓ |
| No local hook bypass (hooks use portable shim) | ✓ |
| No policy split-brain | ✓ (`ONE_AUTHORITATIVE_DECISION`) |
| Fail-closed on missing plugin | ✓ (shim exit 2) |

---

## 13. Rollback

Unchanged from Phase 11:

```powershell
node bootstrap/integrate-runtime.mjs --rollback --project-dir "C:\Apps\speed-flexy-server"
```

Restores `.cursor/hooks.json.local-backup`. Local policy files preserved.

---

## 14. Remaining limitations

1. **`install-plugin.mjs` is a manual one-time step** — not yet a Cursor Marketplace publish flow.
2. **Specialist subagent handoff** in Cursor UI (separate Task thread) was evidenced by routing script + in-session analysis; a recorded multi-agent Cursor chat transcript was not captured.
3. **Simple YAML parser** loses nested capability `agent` fields in e2e script — routing falls back to effective rules merge (works correctly).
4. **Plugin cache discovery** depends on standard Cursor layout; exotic installs may need explicit `CURSOR_AGENT_OS_PLUGIN_ROOT`.
5. **Local engine files** still present in Speed Flexy for rollback — not deleted (by design).

---

## Final status: `PASS WITH LIMITATIONS`

Phase 12 achieves:

- ✅ No `C:/Apps/cursor-agent-os` in project `hooks.json`
- ✅ User-scoped install manifest + portable shims
- ✅ Universal policy as single authority
- ✅ Project isolation (sample-project fixture)
- ✅ Fresh-machine simulation via install manifest
- ✅ Full orchestrator routing + backend specialist analysis (read-only)
- ✅ Policy E2E via actual portable hook processes

Universal Agent OS is now a **reusable user-scoped development operating layer** — install once, integrate per project via adapter + knowledge only.
