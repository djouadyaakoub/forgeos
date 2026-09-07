# OpenHands Runtime Adapter

Architecture 2.0 Stages 6–7.

## 1. Integration surface

Preferred surface: **OpenHands Agent Server** (HTTP), backed by the Software Agent SDK.

Documented endpoints (research snapshot 2026-09-03, official docs):

| Method | Path | Auth | Use |
|--------|------|------|-----|
| GET | `/health` | no | Liveness |
| GET | `/alive` | no | Liveness |
| GET | `/ready` | no | Readiness |
| GET | `/server_info` | no | Version / tools |
| POST | `/api/conversations` | optional `X-Session-API-Key` | Start conversation |
| GET | `/api/conversations/{id}` | optional key | Inspect / poll |
| POST | `/api/conversations/{id}/pause` | optional key | Remote cancel (Stage 7) |
| DELETE | `/api/conversations/{id}` | optional key | Delete (not used by default) |
| GET | `/api/conversations/{id}/events` | optional key | Event refresh |

ForgeOS **does not** copy OpenHands source and **does not** add OpenHands as a Core dependency.

## 2. Adapter layout

```text
runtime/adapters/openhands/
  index.mjs                 createOpenHandsBackend (RuntimeBackend)
  mapping.mjs               RunRequest ↔ conversation body + field map
  client.mjs                Agent Server HTTP client (sync + async)
  http-sync.mjs             Sync HTTP via child process + secret redaction
  probe-transport.mjs       Offline contract probe (Stage 6)
  mock-agent-server.mjs     Protocol mock (tests)
  mock-agent-server-cli.mjs Out-of-process mock entry
  mock-process.mjs          Test helper to spawn mock
```

Registration is **opt-in**. Core does not auto-register OpenHands.

## 3. Configuration

| Variable | Purpose |
|----------|---------|
| `OPENHANDS_AGENT_SERVER_URL` | Agent Server base URL |
| `OPENHANDS_SESSION_API_KEY` | Optional `X-Session-API-Key` |
| `OH_SESSION_API_KEYS_0` | Alternate session key env |
| `OPENHANDS_MODEL` / `OPENHANDS_LLM_API_KEY` | Optional LLM fields in mapped body |

Secrets are never stored in Project Intelligence, governance evidence, or logs. Errors/evidence are redacted via `redactSecrets`.

## 4. Transports

| Transport | When | Production? |
|-----------|------|-------------|
| `probe` | Offline / Stage 6 golden tests | No |
| `http` | `baseUrl` or `OPENHANDS_AGENT_SERVER_URL` | Yes (Stage 7) |

Sync `health()` / `start()` for HTTP use a child-process fetch bridge so the existing synchronous `RuntimeBackend` contract and `executeGoverned` lifecycle remain unchanged.

## 5. Health (Stage 7)

HTTP health does **not** report `healthy` merely because a URL is configured.

```text
configured URL
  → GET /health
  → GET /ready (preferred)
  → GET /server_info (version; warning if missing)
  → healthy | unhealthy | unavailable
```

`healthAsync()` delegates to the same sync probe (stable with the sync RuntimeBackend contract).

## 6. Start (Stage 7)

```text
executeGoverned
  → Policy Authority
  → Runtime Router
  → assertRunStartAllowed
  → HTTP health must be healthy
  → map RunRequest → StartConversationRequest
  → POST /api/conversations
  → poll GET /api/conversations/{id} until terminal (or timeout)
  → RunHandle + runtime_native_evidence
```

ForgeOS `task_id` ≠ OpenHands conversation id (runtime-native).

## 7. Cancellation

When HTTP transport is active, cancel attempts **POST `/api/conversations/{id}/pause`** (documented pause API).

Probe transport: local handle only.

DELETE is not the default cancel path (destructive).

## 8. Compatibility

| Field | Value |
|-------|-------|
| Adapter version | `0.3.0-stage15` (see also `OPENHANDS-RUNTIME.md`) |
| Documented OpenAPI | `0.1.0` |
| Unknown version behavior | Allow if health OK; record `versionWarning` |

## 9. Evidence & verification

Unchanged ForgeOS law:

- OpenHands status → `runtime_native_evidence`
- ForgeOS → `forgeos_governance_evidence` + `createVerificationAssessment`
- OpenHands finished ≠ ForgeOS COMPLETED

## 10. Platform matrix

| Platform | Status |
|----------|--------|
| Windows (HTTP sync + mock process) | PASS (Stage 7 tests) |
| Windows + live OpenHands | UNKNOWN (no `OPENHANDS_AGENT_SERVER_URL`) |
| Windows + Docker workspace | UNKNOWN |
| Linux / macOS live | UNKNOWN (not tested in this environment) |

## 11. Live Agent Server

```text
Live Agent Server integration: UNKNOWN
Reason: OPENHANDS_AGENT_SERVER_URL unavailable in the Stage 7 execution environment
```

HTTP production path is proven against an out-of-process **protocol mock**, not a claim of live OpenHands product verification.

## 12. Related

- `docs/architecture/AUTONOMOUS-ORCHESTRATOR.md`
- `docs/release/ARCHITECTURE-2.0-STAGE-7-STATUS.md`
