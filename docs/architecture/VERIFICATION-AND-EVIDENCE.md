# Verification and Evidence — Architecture 2.0 Stage 10

ForgeOS proves capability improvement independently of runtime success.

```text
Runtime result
   ↓
Project state
   ↓
ForgeOS verification (PASS | FAIL | UNKNOWN)
   ↓
Governance evidence (append-only)
   ↓
Assessment (consumes verified evidence)
   ↓
Canvas (derived)
```

Runtime `COMPLETED` is never capability `SATISFIED`.

Stage 30 exact-approval consumption receipts link approval/binding, execution,
task, operation, workspace fingerprint and consumption time. They remain
`verification: NOT_ESTABLISHED`; their durable conservative result is
`EXECUTION_OUTCOME_UNKNOWN_REAPPROVAL_REQUIRED`. Execution output may separately
report completion. Approval consumption is neither successful execution nor
ForgeOS verification PASS. It cannot satisfy a capability or authorize a Canvas
transition. Recognized Tier-3 verification commands are rejected, not dispatched
using an execution approval. See [Policy Authority](POLICY-AUTHORITY.md).

## Verification boundary

Module: `intelligence/orchestrator/capability-verification.mjs`

Verification is ForgeOS-owned. It does not call `backend.start()` or `executeGoverned()`.

Contract fields:

- `task_id`, `capability_id`, `execution_id`
- `result`: `PASS` | `FAIL` | `UNKNOWN`
- `strategy`, `checks[]`, `evidence`
- `verified_at`, `project_fingerprint`

Each check is independently readable. There is no single opaque boolean.

### Strategies

| Strategy | Behavior |
|----------|----------|
| `none` | Always `UNKNOWN`. Never coerced to `PASS`. |
| `presence` | Safe project-relative regular-file existence, only for existence objectives. |
| `finding_resolution` | Versioned documentation targets bound to task/workspace/configuration and baseline; fresh checks reject missing/empty documents and equivalent remaining drift. |
| `project_verification_commands` | Commands from Project Intelligence `verification.commands`, then Policy Authority, then bounded spawn. |

Capability metadata cannot introduce arbitrary shell. Commands not listed in the project verification contract are not executed.

Verification commands:

- are bounded to the project directory
- go through Policy Authority (`evaluatePreToolUse` / Shell)
- have timeout, exit-code, stdout/stderr capture
- redact secret-shaped output via `redactString`

A verification `PASS` cannot authorize execution or override a policy `DENY`.

Product documentation preparation attaches a finding-resolution contract and preserves historical presence handoffs. Configuration changes require replanning; changed document content is safely reassessed rather than blindly accepting the old finding. Scoped PASS is not capability completion: current documentation findings prevent SATISFIED even with valid PASS evidence. The derived Canvas is never written by the host. Content semantics remain bounded heuristics, not a general proof of documentation truth.

## Evidence authority

Schema: `schemas/governance-evidence.schema.yaml`  
Module: `intelligence/orchestrator/governance-evidence.mjs`

Two classes:

- `FORGEOS_GOVERNANCE_EVIDENCE` — authoritative for satisfaction transitions
- `RUNTIME_NATIVE_EVIDENCE` — informational transcript/log only

They are not merged into one authority.

Evidence is append-only (`governance-evidence-<id>.json`). Historical files are not rewritten. Later results may set `supersedes_evidence_id`.

Integrity is a SHA-256 of the canonical record excluding the `integrity` field. Altered timestamps fail validation.

Evidence is not an authorization mechanism.

## Fingerprints

Scoped fingerprints bind evidence to project state without hashing the entire tree:

- Project Intelligence fingerprint
- assessment input fingerprint
- capability binding fingerprint
- verification strategy fingerprint
- scoped state fingerprint (presence file hashes, or command list)

Evidence from project state A cannot silently satisfy project state B.

## Freshness

A stale `PASS` does not produce `SATISFIED`. Stale is distinguishable (`verification.status: stale`).

Stale when:

- TTL expires
- Project Intelligence changes
- relevant files change
- capability binding changes
- verification strategy changes

Historical evidence is retained.

## State transitions

```text
Candidate → Execution → Verification PASS → Governance evidence → SATISFIED
```

`SATISFIED` is refused for:

- runtime completion alone
- agent/runtime claims
- user approval
- Canvas mutation
- stale PASS
- UNKNOWN
- FAIL
- heuristic assessment alone
- forged or cross-task / cross-capability / cross-project evidence

`FAIL` and `UNKNOWN` are not collapsed: Canvas verification status is `failed` vs `not_verified`.

## Canvas delta

Derived only. A delta may claim a verified SATISFIED transition only when verification is `PASS` and an `evidence_id` is present.

## Rescan

`rescanProject()` reloads evidence, reassesses, rebuilds Canvas. Two rescans with unchanged project state must not contradict capability states.

## CLI

```text
forgeos run                         # assess + plan
forgeos run --execute --approve-task <id>
```

Execute output distinguishes:

```text
EXECUTION:
COMPLETED

VERIFICATION:
PASS

EVIDENCE:
RECORDED

CAPABILITY:
SATISFIED
```

`--json` includes `execution`, `verification`, `evidence`, `assessment`, `canvas`, `delta`.

Never report success when verification failed.
