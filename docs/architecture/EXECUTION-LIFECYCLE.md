# Execution Lifecycle

Architecture 2.0 Stage 5 — governed delegated execution.

## 1. Lifecycle

```text
PLANNED
  → POLICY_CHECKED
  → ROUTED
  → STARTING / RUNNING
  → VERIFYING
  → EVIDENCE_COLLECTED
  → COMPLETED
```

Failure statuses (distinct):

```text
POLICY_DENIED
ROUTING_FAILED
START_FAILED
EXECUTION_FAILED
VERIFICATION_FAILED
EVIDENCE_FAILED
CANCELLED
INVALID_REQUEST
```

Module: `runtime/execution.mjs` (`executeGoverned`, `cancelGoverned`).

## 2. Policy gate

ForgeOS Policy Authority is evaluated **before** routing and **before** `backend.start()`.

```text
Policy DENY → POLICY_DENIED → start() never called
```

## 3. Router boundary

Execution always goes through Stage 4 `route()`.

```text
Policy → Router → Backend
```

No hard-coded backend selection inside the lifecycle.

## 4. Runtime Backend boundary

Only the lifecycle calls `backend.start(runRequest)`.

The Router remains selection-only.

## 5. RunHandle

Uses Stage 3 `createRunHandle` (`run_id`, `task_id`, `backend_id`, `status`).

## 6. Execution states

See lifecycle statuses above. Records retain policy, route, handle, runtime evidence, governance evidence, and verification assessment.

## 7. Cancellation

`cancelGoverned({ task_id, run_handle, registry })` enforces task isolation.

Local Executor runs synchronously — in-flight cancel is **safely unsupported** (documented).

## 8. Verification

Runtime reports command exit codes.

ForgeOS `createVerificationAssessment` decides whether requirements are satisfied.

```text
Execution SUCCESS + Verification FAILED → VERIFICATION_FAILED (not COMPLETED)
```

## 9. Evidence

| Kind | Owner |
|------|-------|
| `runtime_native_evidence` | Backend |
| `forgeos_governance_evidence` | ForgeOS lifecycle |

Transcripts / LLM sessions are **not** stored in ForgeOS.

## 10. Task isolation

Cross-task cancel / evidence / completion reuse is rejected (`TASK_MISMATCH`).

## 11. Failure semantics

Do not collapse all failures to a single `FAILED` — use distinct lifecycle statuses.

## 12. Adapter isolation

Core depends on `RuntimeBackend` contract only.

First adapter: `runtime/adapters/local-executor.mjs`  
(see `RUNTIME-ADAPTER-LOCAL-EXECUTOR.md`).

## 13. Security invariants

1. DENY ⇒ no start  
2. Router required  
3. Protected paths remain blocked  
4. Runtime cannot claim `authority: forgeos`  
5. Hard-forbidden paths refused by Local Executor even if misconfigured allow-list  

## 14. E2E flow

```text
Temp project
 → Project Intelligence
 → Policy Authority (Write)
 → Runtime Router
 → Local Executor start (real FS write)
 → verification command (real process)
 → evidence + ForgeOS assessment
 → COMPLETED
```

## 15. Limitations

- One reference backend (Local Executor); no Cline/OpenHands/Codex/Claude yet  
- Sync execution only  
- Cancel during in-flight work unsupported  
- Orchestrator planner does not yet auto-invoke `executeGoverned` in production workflows  

## 16. Future multi-runtime

Additional adapters register into Runtime Registry; Router selection expands without changing Policy Authority.
