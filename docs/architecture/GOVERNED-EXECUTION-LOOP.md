# Governed Execution Loop — Architecture 2.0 Stage 9

Stage 9 connects Stage 8 assessment to the existing governed execution lifecycle.
Stage 11 adds plan-only intent → capability orchestration (`forgeos plan`) upstream of this loop.

```text
forgeos plan "<request>"     → Main Agent plan only (NOT_STARTED)
forgeos run                 → assess + plan + canvas (no execution)
forgeos run --execute
  --approve-task <task_id>  → explicit task-scoped approval (programmatic)
forgeos task <task_id>      → host-native interactive handoff (Stage 12)
forgeos task complete <id>  → request ForgeOS verification (not success)
```

## Lifecycle

```text
Assessment → Task Candidate → Explicit Approval → Policy Authority
  → Capability Resolver → coordinateGovernedExecution → Runtime
  → ForgeOS verification (PASS|FAIL|UNKNOWN) → Evidence
  → Rescan → Canvas delta
```

`backend.start()` is reached only via `executeGoverned()` inside `coordinateGovernedExecution`.

## Approval

Approval is **not** authorization.

- Task-scoped (`task_id` + `capability_id`)
- Non-transferable, non-blanket
- Time-bounded
- Operation fingerprint bound when present
- `--yes` / `--force` are rejected

Policy DENY still DENY even with a valid approval.

## Verification vs runtime

Runtime `COMPLETED` is not capability `SATISFIED`.

Capability `SATISFIED` requires ForgeOS verification `PASS`.

`UNKNOWN` never becomes `PASS`.

## Canvas

Canvas remains derived. Successful verification appends `docs/project/assessments/governance-evidence-*.json`. Rescan merges only fresh PASS evidence. Project Intelligence is not modified.

See `docs/architecture/VERIFICATION-AND-EVIDENCE.md` for Stage 10 verification, evidence, freshness, and fingerprints.

## Stage 25 task scope

`policy/task-scope.mjs` defines a workspace-bound containment contract: task/project identity, allowed/denied paths, capability/operation IDs, expected effects, action classes, manifest-context fingerprint and canonical contract fingerprint. Sorted unique sets and normalized separators make fingerprints deterministic. Exact paths, segment `*`/`?` and whole-segment `**` are supported; brace/negated/class globs, traversal, absolute/device paths and symlink/junction traversal are rejected. Denied paths win; Policy may restrict further.

Assessment-generated candidates carry `task_scope`. Legacy unbound candidates are bound at host-handoff/approved-execution boundaries. A supplied contract that differs from candidate constraints is rejected rather than silently widened. A changed manifest makes it stale. Explicit fresh planning/regeneration is required. Checksums are not signed approvals.

Policy Authority exposes `evaluateTaskScope`: failure is DENY, success is only a satisfied scope prerequisite (permission=null), never ALLOW. `evaluatePreToolUse` and the generic pre-tool entrypoint intersect a supplied scope with the actual tool path; caller scope_action cannot substitute a different tool path. Existing engine authorization still runs. Legacy callers without a scope retain their existing Policy semantics.

Approved execution preflights declared write paths and refuses command operations unless the contract explicitly permits execute; it still routes through the existing governed lifecycle and approval/Policy checks. Direct lower-level runtime callers are not silently migrated into a new approval system. No second Policy engine or vendor launcher exists.

Host handoffs carry the contract; completion validates it before verification commands. ForgeOS verification records its fingerprint and can reject out-of-scope `observed_changed_paths` supplied to the completion API. Those observations are explicitly caller-supplied and non-exhaustive: Stage 25 does not attest every interactive edit or scan a dirty Git tree as if all changes belonged to one task. No observations means not_observed, not a clean-scope claim. Capability verification and Canvas authority remain unchanged.

The Core intelligence entrypoint no longer re-exports Cursor-specific factories. Consumers of those two exports should import the existing `host/adapters/cursor/index.mjs` integration surface; neutral consumers use host discovery. Adapter export names and direct imports are preserved. The neutrality test is unchanged.

## Unified interactive product surface

`cli/forgeos.mjs` uses `intelligence/orchestrator/product-workflow.mjs` to join current assessment, explicit task/finding selection, Task Scope, Policy, host resolution, handoff, completion, verification/evidence, derived Canvas and candidate knowledge. It is a facade over existing authorities, not another scheduler or CLI framework. `status` presents host readiness, current bounded PI, findings, pending task/scope/verification history, knowledge state and deterministic next choices. `next` does not guess between unrelated choices; `--prepare` persists a handoff but does not execute. `--path` narrows existing allowed paths, never widens them. Existing handoffs are not overwritten; use the existing explicit task regeneration flow for stale scopes.

The product preflight and changed-path completion checks call `PolicyAuthority`'s `evaluateScopedTaskTool`. This synchronous helper binds scope and supplies the existing task's specialist role to the same Policy engine. It temporarily binds the legacy project environment context and restores it in `finally`; it does not write a vendor session, spawn a specialist or change rules. This removes ambient orchestrator read-only context confusion without granting new tiers. Tool-hook inputs cannot select the separate trusted session argument. Host work still requires per-action Policy; preparation is not blanket approval or live interception.

Documentation candidates explicitly retain the existing AGENTS.md presence requirement even when the file already exists. PASS means that presence requirement passed, not that all documentation is correct. The product completion response summarizes Canvas rather than dumping every nested candidate. Candidate write-back failures are distinct from verification failure. Acceptance/retrieval belong to the interpretation lifecycle described in the Project Intelligence contract; neither affects capability resolver availability or Canvas authority.

