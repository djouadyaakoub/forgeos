# Autonomous Orchestrator — Control-Plane Closure

Architecture 2.0 Stage 6.

## 1. Purpose

Close the production control-plane path:

```text
Intent
  → Project Intelligence
  → Planner / Coordinator
  → Policy Authority
  → Runtime Router
  → executeGoverned()
  → RuntimeBackend.start()
  → Verification
  → Governance Evidence
  → Task Result
```

ForgeOS remains a **control plane**, not an agent runtime.

## 2. Entry points

| Function | Module | Behavior |
|----------|--------|----------|
| `coordinateDevelopmentWorkflow` | `intelligence/orchestrator/coordinator.mjs` | Plan only (backward compatible) |
| `coordinateGovernedExecution` | `intelligence/orchestrator/governed.mjs` | Plan + optional `executeGoverned` |
| `executeGoverned` | `runtime/execution.mjs` | **Only** production path that may call `backend.start` |

Rules:

- Planner, Coordinator, Host adapters, and Agent prompts **must not** call `backend.start()` directly.
- `coordinateGovernedExecution` requires `execute: true` or `dry_run: true` to invoke the lifecycle.
- Without those flags, behavior remains plan-only.

## 3. Task execution identity

Every governed run carries:

```text
task_id
execution_id          (deterministic; see buildExecutionIdentity)
objective
project_id / project_dir
project_intelligence  (loaded reference)
policy_decision
allowed_paths / forbidden_paths / approval_scopes
verification_commands
evidence_requirements
backend_id (route result)
run_id (runtime-native after start)
```

Runtime session IDs (e.g. OpenHands conversation id) are **runtime-native** and referenced from ForgeOS evidence — they do not replace `task_id`.

## 4. Duplicate execution protection

Module: `runtime/execution.mjs` — `EXECUTION_GUARD` + `buildExecutionIdentity`.

```text
same execution_id while active     → ALREADY_ACTIVE  (no backend.start)
same execution_id after completion → ALREADY_COMPLETED (no backend.start)
```

Does **not** silently skip evidence. Explicit lifecycle status is returned.

## 5. Idempotency

Proven in Stage 6 tests:

| Scenario | Result |
|----------|--------|
| Planner/coordinator once with execute | one `backend.start` |
| Same `execution_id` twice | one `backend.start`; second `ALREADY_COMPLETED` |
| Dry-run | zero `backend.start` |

**Limitation:** Guard is process-local (in-memory). Cross-process / durable task-store idempotency is deferred — document rather than invent unsafe shared state in Stage 6.

## 6. Dry-run

`dry_run: true` runs:

```text
Project Intelligence → Policy → Routing → preview
```

and **never** calls `backend.start()` or mutates the filesystem.

Preview fields include:

- `policy_decision`
- `route_decision`
- `selected_backend`
- `run_request_preview` / execution constraints
- `verification_plan`
- `expected_evidence`

Status: `DRY_RUN`.

## 7. Failure semantics

Lifecycle statuses remain distinct (non-exhaustive):

```text
POLICY_DENIED
ROUTING_FAILED
START_FAILED
EXECUTION_FAILED
VERIFICATION_FAILED
EVIDENCE_FAILED
CANCELLED
INVALID_REQUEST
DRY_RUN
ALREADY_ACTIVE
ALREADY_COMPLETED
COMPLETED
```

`coordinateGovernedExecution` copies governed status into `execution.workflow_execution.governed_*` fields — it does not invent a second success notion.

## 8. Policy / runtime / verification / evidence boundaries

```text
Policy Authority     → sole ALLOW/DENY
Runtime Router       → eligibility only (no start, no ranking, no fallback)
RuntimeBackend       → execution under constraints
Verification         → ForgeOS createVerificationAssessment
Governance evidence  → forgeos_governance_evidence
Runtime evidence     → runtime_native_evidence
```

Runtime success ≠ verification success ≠ governance completion.

## 9. Related modules

- `intelligence/orchestrator/governed.mjs`
- `runtime/execution.mjs`
- `runtime/router.mjs`
- `runtime/backend-interface.mjs`
- `docs/architecture/OPENHANDS-RUNTIME-ADAPTER.md`
