# Runtime Backend Interface

Architecture 2.0 Stage 3 — **contract only**.

## 1. Purpose

Define a clean boundary between ForgeOS Core (control plane) and future execution runtimes.

ForgeOS decides **what may run**. A Runtime Backend executes **how** work is performed under those constraints.

## 2. Why ForgeOS is not a runtime

ForgeOS owns:

- Project Intelligence
- Policy Authority
- Planner / orchestration / task state
- Security / risk
- Verification policy
- Evidence acceptance
- Knowledge boundaries
- Release / deployment governance

ForgeOS does **not** own LLM loops, sandbox kernels, model providers, or team buses. Those belong to future runtime adapters.

## 3. Host Adapter vs Runtime Backend

| Concept | Role | Today |
|--------|------|-------|
| **Host Adapter** | Editor/IDE integration (events, hooks, workspace) | Cursor (real), CLI (stub), generic (test) |
| **Runtime Backend** | Execution engine for delegated work | **None implemented** (contract only) |

```text
Host Adapter
      ↓
ForgeOS Core
      ↓
Runtime Backend Interface   ← this document / runtime/backend-interface.mjs
      ↓
Future Runtime Adapter
      ↓
Runtime implementation
```

**Cursor is a Host Adapter.** Stage 3 does **not** claim Cursor is a Runtime Backend.

Existing host boundary:

- `runtime/interface.mjs` — host events, agent invocation helpers, tool provider
- `runtime/host-registry.mjs` — cursor / cli / generic hosts

New backend boundary:

- `runtime/backend-interface.mjs`

## 4. Interface contract

Conceptual shape:

```text
RuntimeBackend {
  id
  name
  version
  capabilities
  health()
  canHandle(task, projectIntelligence, policyRequirements)
  start(runRequest)
  cancel(runHandle [, task_id])
  collectEvidence(runHandle)
}
```

Validate with `validateRuntimeBackend(backend)`.

Contract version: `RUNTIME_BACKEND_CONTRACT_VERSION = "1"`.

## 5. runRequest

ForgeOS-owned execution request (`createRunRequest`):

- `task_id` (required — runtime must not detach from authorizing task)
- `objective`
- `project_intelligence` (reference / subset; not a second SoT)
- `policy_decision` (`authority: forgeos`, `decision: allow|deny`)
- `policy_requirements` (`allowed_paths`, `forbidden_paths`, `approval_scopes`, …)
- `isolation_requirements`
- `verification_commands`
- `evidence_requirements`
- `execution_constraints` (runtime limits — **not** authorization)

`policy_decision.authority` must be `forgeos`. Any other authority is rejected.

## 6. RunHandle

```text
{ run_id, task_id, backend_id, status }
```

ForgeOS refers to an execution without owning the backend’s transcript/session model.

## 7. Health

Normalized statuses:

```text
healthy | unhealthy | unavailable | unknown
```

Health ≠ policy. Unhealthy means **cannot execute**, not **policy denied**.

## 8. canHandle

Capability matching only:

```text
{ match, reasons[], authorization: null }
```

`canHandle` **never** grants ForgeOS authorization.

Mismatch examples: unsupported language, sandbox unavailable, interactive unsupported, parallel unsupported.

Stage 3 does **not** rank, select, or fall back across backends (that is Runtime Router / Stage 4+).

## 9. Cancellation

`cancel` must identify the run and task. Cross-task cancel is rejected (`TASK_MISMATCH`). Cancellation never grants authorization.

## 10. Evidence

Runtime returns a normalized **runtime-native** evidence bundle:

- execution status
- changed files / diff summary
- commands executed
- test results / log refs
- verification command outcomes (`exit_code`)

ForgeOS governance evidence (policy decisions, release approvals) remains ForgeOS-owned.

Missing evidence → `unavailable: true` / `EVIDENCE_UNAVAILABLE` — **not** a policy deny.

## 11. Verification boundary

| Layer | Meaning |
|-------|---------|
| Runtime | “command X exited 0” (`verification_results`) |
| ForgeOS | “verification requirements are satisfied” (`createVerificationAssessment`) |

Project Intelligence `verification.commands` remain authoritative for what ForgeOS requires.

## 12. Policy boundary

```text
ForgeOS DENY  → overall DENY (runtime must not authorize)
ForgeOS ALLOW + runtime DENY → overall DENY
ForgeOS ALLOW + runtime ALLOW → overall ALLOW
```

Helpers:

- `resolveOverallExecutionDecision`
- `assertRunStartAllowed` (policy deny stays `kind: 'policy'`, not a runtime error)

## 13. Task isolation

Runs are bound to `task_id`. Cancel/mutate for Task B against a Task A handle → `TASK_MISMATCH`.

## 14. Future adapter expectations

A future adapter (Cline / OpenHands / Codex / Claude / …) must:

1. Implement the RuntimeBackend methods
2. Enforce delegated path/isolation constraints
3. Never override ForgeOS DENY
4. Return normalized evidence
5. Preserve task identity on every handle

## 15. Explicit non-goals (Stage 3)

- Runtime Router / selection / ranking / fallback
- Cline, OpenHands, Codex, Claude adapters
- Agent refactor
- Multi-host expansion
- LLM provider / token accounting / transcript DB
- Claiming Cursor is a Runtime Backend

## 16. Relationship to Runtime Router

```text
Stage 3: Runtime Backend Interface (contract)
Stage 4: Runtime Router (registry + eligibility selection) — see RUNTIME-ROUTER.md
Stage 5+: Execution lifecycle + first concrete adapters
```

The interface is consumed by the Router for `canHandle` / health filtering.
The Router does not implement backends and does not call `start()`.
