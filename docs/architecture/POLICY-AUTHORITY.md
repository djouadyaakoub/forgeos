# ForgeOS Policy Authority

Canonical ALLOW/BLOCK authority for ForgeOS-scoped operations.

## Authority identity

```text
POLICY_AUTHORITY = forgeos
```

Implementation surface:

- Engine: `policy/engine.mjs`
- Canonical API: `policy/authority.mjs` (`PolicyAuthority.evaluate`)
- Host portable wiring: `policy/portable-hooks.mjs`

There is exactly one ForgeOS authorization engine. Host and future runtime adapters **translate and enforce**; they do not invent parallel ALLOW/BLOCK rule databases.

## Decision path (Cursor production host)

```text
Cursor hook event
    ↓
Project `.cursor/hooks.json` (portable commands)
    ↓
`.cursor/hooks/agent-os/*` shim (resolve ForgeOS install)
    ↓
`policy/hooks/policy-*.mjs`
    ↓
Policy Authority (`policy/authority.mjs` → `policy/engine.mjs`)
    ↓
ALLOW / DENY (+ authority metadata)
    ↓
Host enforcement (Cursor permission response)
```

## Offline / direct evaluation

Tests and scripts may call `policy/engine.mjs` or `PolicyAuthority.evaluate` directly.

That is **not** a production bypass. Production host execution must be hook-enforced. Offline evaluation uses the same authority identity and rules.

## Hierarchy (unchanged)

```text
Global Baseline
      ∩
Project Restrictions
      ∩
Agent Permissions
      ∩
Task Scope
      ∩
Approval
```

Project configuration may **narrow** policy. It must not remove global protected paths, global Tier 3 baseline, required approvals, or task-scope isolation.

## Runtime boundary (future adapters)

```text
ForgeOS Policy Authority
        ↓
Runtime Backend Interface (contract — Stage 3)
        ↓
Runtime Adapter (future)
        ↓
Runtime sandbox
```

See `docs/architecture/RUNTIME-BACKEND-INTERFACE.md`.

Valid:

```text
ForgeOS: ALLOW
Runtime sandbox: DENY   → overall DENY (stricter sandbox)
```

Invalid for ForgeOS-governed operations:

```text
ForgeOS: DENY
Runtime: ALLOW          → must never authorize
```

Runtime Router / Cline / OpenHands / Codex / Claude adapters are **not** implemented in Stage 2 or Stage 3.

## Fail-closed

Missing ForgeOS root, hook errors, invalid policy context, missing task scope for Tier 3, or missing approval → **DENY**.

## Task-scoped approvals

Approvals are bound to a task id. Task A approval must never authorize Task B.

## Exact Tier-3 approval (Stage 30)

Legacy task/category approval is eligibility only, never sufficient for Tier 3.
`policy/exact-approval.mjs` binds task, capability, operation ID, canonical workspace,
current Task Scope fingerprint, action and normalized argv with the existing stable
canonicalizer and SHA-256. It is an evidence store, not another Policy engine.

The supported dispatch subset is a single direct `git push` / force-push command
through Local Executor. Shell/Bash/exec_command wrappers normalize to argv;
plain inter-argument spaces are equivalent. Quotes, control characters, shell
operators, substitutions, unsupported fields and non-ASCII tokens are rejected.
All arguments remain bound; targets are displayed, not reduced to a category.
Other recognized Tier-3 operations and external runtime paths lack an exact effect
adapter and fail closed. This is not a general shell sandbox or script analyzer;
indirect effects inside arbitrary scripts, Git configuration/hooks and executables
remain outside exact-input proof. Workspace identity is not a frozen Git remote/config snapshot.

`forgeos approve --project PATH --file intent.json --expires-at YYYY-MM-DDTHH:mm:ss.SSSZ`
previews task, operation, target, normalized input, workspace and one-use semantics.
The project-relative JSON contains `task_id`, `capability_id`, `operation_id`,
`task_scope`, and `event`. Repeat with `--confirm-human --by OPERATOR --confirm-fingerprint BINDING`
only after reviewing. This is an explicit local operator assertion, not authenticated
identity. Creation never dispatches anything. Pass the returned approval ID as
`exact_approval_id` to governed execution (legacy run CLI: `--exact-approval ID`).
Policy DENY still wins.

Timestamps use exact millisecond UTC ISO format and must represent real dates;
maximum exact-approval lifetime is one hour. Invalid, future-issued and expired
records reject. Ordinary low-risk approvals do not acquire one-use friction.

Validation is read-only and may repeat. `dispatchExactShell` rechecks Policy and
scope and durably consumes immediately before the synchronous effect callback.
Local Executor uses `spawnSync(argv[0], argv.slice(1), {shell:false})` for that effect.
Exclusive project-local lock and consumption files provide one concurrent winner;
consumption is written and fsynced before dispatch. Revocation uses the same lock.
No reservation expires into reusable approval: stale locks and partial consumption
files fail closed. Crash after consume (even before the effect) burns approval.
Unknown outcome requires new approval, never automatic retry. Failed validation
does not consume. A duplicate precheck is not a dispatch.

Store: `.agent-os/approvals`; safe project paths reject symlink escape; bounded
records and directory entries; immutable append evidence rather than overwrites.
Hash integrity is not identity. Malicious same-user filesystem access, filesystem
rollback and power-loss durability beyond file fsync are not solved.

Current integrated host hooks cannot atomically consume at vendor dispatch:
intercepted Tier 3 is blocked (`UNSUPPORTED`), not optimistically allowed. Pure
interactive/manual actions are `DECLARED_ONLY` / not enforced. Hosts do not gain
approval authority. Only the supported ForgeOS-controlled dispatch is enforced.

## Evidence

Policy decisions carry `authority: forgeos` (and related reason / task / operation fields where applicable) for audit and future evidence ingestion. Existing `.cursor/policy/audit.log` remains the local audit sink.

## Deprecated wiring

Absolute-path `hooks.json` entries pointing at a machine checkout are **deprecated**. Bootstrap and `integrate-runtime` install portable shims only.

Legacy `policy_authority: universal` / `universal-agent-os` in `runtime.yaml` normalize to `forgeos` at load time.
