# Capability Operations — Architecture 2.0 Stage 14

ForgeOS expresses remediation as **governed operations** bound to capabilities and findings — without automatic execution.

```text
User Request
    ↓
Intent
    ↓
Capability
    ↓
Assessment Finding
    ↓
Remediation Operation
    ↓
Task Candidate
    ↓
Implementation Resolution
```

Execution still requires:

```text
Approval → Policy Authority → Resolver → Governed Execution → Verification → Evidence → Rescan → Canvas
```

## Distinctions

```text
CAPABILITY ≠ FINDING ≠ OPERATION ≠ TASK ≠ AGENT ≠ RUNTIME
```

| Concept | Meaning |
|---------|---------|
| Capability | What ForgeOS can reason about |
| Finding | Evidence of a condition |
| Operation | Defined way to address a condition |
| Task | Bound candidate for later approval/execution |
| Agent | Specialist / host actor (not the operation) |
| Runtime | Programmatic executor behind oss_backed |

## Operation contract

`intelligence/capability/operation.mjs`

Validated fields include: identity, capability binding, scope, risk, prerequisites, expected effects, verification strategy, implementation types.

Operations must not claim policy authority, execute, authorize, or auto-execute.

## Registry

`intelligence/capability/operations.mjs`

Static, versioned, capability-bound. External definitions are **not** auto-trusted (`registerExternalOperation` fails closed).

## Selection

`intelligence/capability/operation-selection.mjs`

```text
Finding → registered operations (by finding type) → prerequisites → operation candidate
```

Deterministic. No LLM. Unsupported findings produce no fake operations.

## Scope

Operations declare `allowed_paths` / `forbidden_paths`. Tasks inherit scope. Broader work requires a new candidate — no silent expansion.

## Risk

`LOW | MEDIUM | HIGH | CRITICAL` — planning metadata only. Does **not** replace Policy Authority.

## Prerequisites

Evaluated deterministically (`project_initialized`, `has_source`, `explicit_changed_files`, …). Missing → `UNRESOLVED`.

## Expected effects & verification

Expected effects inform later verification. Stage 10 remains authoritative:

```text
Execution completed ≠ SATISFIED
```

## Resolver

`resolveCapability` / `resolveCapabilityOperation` answer:

```text
Capability → Operation → Implementation (host_native | forgeos_native | oss_backed)
```

Resolver still does not execute, authorize, or verify.

## Host-native

When resolved to host_native / Cursor:

```text
available: true
executable: false
invocation: interactive
→ HOST_INTERACTIVE_REQUIRED (Stage 12 handoff)
```

Canonical operations never embed Cursor-specific instructions.

## Main Agent

May plan over operations. Remains plan-only.

## Canvas

May show `recommended_operation`, risk, task candidate. Remains derived / non-authoritative.

## No automatic remediation

Stage 14 generates recommendations and task candidates only.
