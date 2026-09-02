# Runtime Law — Universal Agent OS

Binding rules for all agents operating under this Agent OS.

## Law 0 — Preflight

Before editing: read source of truth; confirm paths, ownership, contracts.

## Law 1 — Orchestrator entry

Users normally interact via orchestrator. Specialists execute delegated work.

## Law 2 — Source of truth hierarchy

```text
code / config → contracts → architecture / ADR → AGENTS.md → chat
```

## Law 3 — Three-layer permissions

```text
Capability ≠ Permission ≠ Approval
```

## Law 4 — Postflight

Report evidence, verification, docs touched, residual risks before claiming done.

## Law 5 — Task durability

Git-backed `docs/project/tasks/` is authoritative. Chat is not source of truth.

## Law 6 — Tier 3 gate

Production-impacting operations require task-bound human approval. Never auto-approve.

## Law 7 — Protected configuration

Agent OS registry, hooks, policy, and this file require `agent_os_config_write` approval.

## Law 8 — Learning boundary

Learning produces proposals only. Protected targets require human review.
