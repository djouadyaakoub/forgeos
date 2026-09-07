# OpenHands Runtime — Optional Integration (Stages 15–17)

ForgeOS control-plane architecture for the **optional** OpenHands RuntimeBackend.

**Stage 17 classification:** `optional_runtime` (legacy registry token `oss_backed` is an alias).

OpenHands is **not** ForgeOS Core, Policy Authority, Project Intelligence, Capability Registry, Planner, Verification Authority, Canvas Authority, or the primary execution UX.

Host-native (Cursor) is primary. Local Executor is programmatic reference. OpenHands is optional only.

## 1. Position in the architecture

```text
Capability Resolver
  → implementation_kind = OPTIONAL_RUNTIME
  → implementation_type = optional_runtime | oss_backed (legacy)
  → implementation_id = openhands (when preferred)
  → Optional Programmatic Backend Selector (Runtime Router)
  → OpenHands RuntimeBackend
  → executeGoverned() only
  → ForgeOS verification + governance evidence
  → Canvas rescan
```

OpenHands LIVE_PASS is **not** a Core architecture completion gate.

Cursor remains `host_native` / interactive (`executable: false`). No automatic substitution OpenHands ↔ Cursor ↔ Local Executor.

## 2. Adapter

```text
runtime/adapters/openhands/
  index.mjs              RuntimeBackend (health, canHandle, start, cancel, collectEvidence)
  environment-gate.mjs   LIVE gate: HEALTH → READY → PROVIDER
  live-proof.mjs         Minimal governed E2E (BLOCKED when gate not READY)
  stage16-live-gate.mjs  Stage 16 live validation classifier (no fake LIVE_PASS)
  mapping.mjs            RunRequest ↔ Agent Server body
  client.mjs / http-sync Probe / HTTP sync + secret redaction
  mock-agent-server*     Protocol mock for unit tests
```

Adapter version: `0.3.0-stage15`.

Registration is **opt-in**. Core does not auto-register OpenHands. OpenHands is **not** a ForgeOS package dependency.

## 3. Verified capabilities (declared)

| Capability | Declared |
|------------|----------|
| autonomous | true (adapter surface) |
| interactive | false |
| parallel | false |
| pr_delivery | false |
| hooks_callback | false |
| cost_telemetry | false |
| remote_cancel_pause | HTTP only (pause API) |

Documentation-only OpenHands features are **not** declared.

## 4. Live environment gate

```text
HEALTH
  → READY
  → PROVIDER CONFIGURED
  → MINIMAL EXECUTION
  → EXPECTED PROJECT EFFECT
  → FORGEOS VERIFICATION
```

`/health` alone is insufficient. `/ready` alone is insufficient.

If provider/LLM configuration is missing:

```text
STATUS: BLOCKED
REASON: provider_not_configured
```

Environment variables (never committed):

| Variable | Role |
|----------|------|
| `OPENHANDS_AGENT_SERVER_URL` | Agent Server base URL |
| `OPENHANDS_SESSION_API_KEY` | Optional session key |
| `OPENHANDS_MODEL` | Optional model hint |
| `OPENHANDS_LLM_API_KEY` | Required for Stage 15 live provider gate |

Production callers may set `require_live_provider: true` on the backend. Stage 6/7 mock HTTP tests leave this off so protocol tests remain valid.

## 5. canHandle

Evaluates task, project intelligence, policy context, operation `implementation_types`, and runtime capabilities.

Returns `{ match, reasons }`. Does **not** authorize, execute, or start OpenHands.

## 6. Policy & workspace boundary

```text
Task → Explicit Approval → Policy Authority → Resolver → Router → OpenHands
```

- DENY cannot be overridden by approval or OpenHands.
- Protected paths remain protected; zero HTTP POSTs on DENY.
- Adapter maps `project_dir` → `workspace.working_dir`; ForgeOS Policy still enforces allowed/forbidden paths **before** `start()`.
- OpenHands cannot expand scope, create approvals, or modify ForgeOS Policy.

## 7. Evidence & verification

| Source | Kind | Authority |
|--------|------|-----------|
| OpenHands | `runtime_native_evidence` | Runtime session only |
| ForgeOS | `forgeos_governance_evidence` | Verification / Canvas |

OpenHands `finished` / `success` is **not** ForgeOS `PASS`. Only ForgeOS verification PASS with fresh governance evidence can affect Canvas SATISFIED.

## 8. Cancellation

HTTP: `POST /api/conversations/{id}/pause` when supported. Cancellation is never interpreted as success (`CANCELLED` ≠ `COMPLETED`).

## 9. Packaging

OpenHands Agent Server is an **external optional runtime**. ForgeOS distribution remains usable without it. Do not bundle the server into the default ForgeOS package.

## 10. CLI

Unchanged: `forgeos plan`, `forgeos run`, `forgeos run --execute --approve-task <id>`, `forgeos task`. No `forgeos openhands` command.

## 11. Related

- `docs/architecture/OPENHANDS-RUNTIME-ADAPTER.md` (Stages 6–7 base)
- `docs/reports/STAGE-15-OPENHANDS-RUNTIME-REPORT.md`
- `docs/reports/STAGE-16-OPENHANDS-LIVE-E2E-REPORT.md`
- `docs/release/ARCHITECTURE-2.0-STAGE-15-STATUS.md`
- `docs/release/ARCHITECTURE-2.0-STAGE-16-STATUS.md`

## 12. Stage 16 live validation (fact)

Stage 16 is a **validation gate**, not a new architecture stage.

On 2026-09-03 in this environment:

```text
OPENHANDS_AGENT_SERVER_URL = not_configured
OPENHANDS_LLM_API_KEY      = not_configured
OPENHANDS_MODEL            = not_configured
LIVE GATE                  = BLOCKED
classification             = LIVE_BLOCKED_ENVIRONMENT
reason                     = agent_server_url_unset
Live E2E                   = NOT_RUN
```

No credentials were invented. Live PASS requires a real Agent Server + provider + governed mutation + ForgeOS verification PASS + governance evidence + Canvas rescan. Until then, Stage 16 remains explicitly BLOCKED.
