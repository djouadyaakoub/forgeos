# Optional Programmatic Backend Selector (Runtime Router)

Architecture 2.0 Stage 4 — **reframed Stage 17**.

## 1. Purpose

Select which **registered optional RuntimeBackend** is eligible for programmatic execution.

This module is **not** the primary ForgeOS agent router.

| Layer | Owns |
|-------|------|
| Capability Resolver | `host_native` / `forgeos_native` / `oss_derived` / `optional_runtime` |
| This selector (Runtime Router) | Which registered RuntimeBackend handles `optional_runtime` / reference backends |
| Policy Authority | Authorization |
| `executeGoverned` | Actual `backend.start` |

The Router does **not** decide whether the operation is authorized.

Authorization remains exclusively:

```text
policy/authority.mjs  (POLICY_AUTHORITY = forgeos)
```

**Product rule (Stage 17):** Optional Runtime ≠ Core Execution Model. Host-native is primary UX.
## 2. Router vs Runtime Backend

| Component | Role |
|-----------|------|
| Runtime Backend Interface | Contract for execution backends (`runtime/backend-interface.mjs`) |
| Runtime Registry | Holds registered backends (`runtime/registry.mjs`) |
| Runtime Router | Selects eligible backend (`runtime/router.mjs`) |

The Router never calls `start()`, `cancel()`, or `collectEvidence()`.

## 3. Router vs Policy Authority

```text
ForgeOS DENY  → RouteDecision.status = DENIED (no backend)
ForgeOS ALLOW → Router evaluates capability + health
              → ROUTED | NO_COMPATIBLE_BACKEND | …
```

Policy ALLOW ≠ routing success.

There is **no** `router/rules.json` or router-local policy engine.

## 4. Host vs Runtime

| Registry | Holds |
|----------|-------|
| `runtime/host-registry.mjs` | Host adapters: Cursor / CLI / generic |
| `runtime/registry.mjs` | Runtime backends (execution) |

Host field `runtime.entrypoint` means host-adapter module path — **not** a RuntimeBackend.

## 5. Registry

```text
register(backend)
unregister(id)
get(id)
list()
```

Registration validates via `validateRuntimeBackend`. Duplicate ids rejected.  
Default registry starts **empty** (no production backends).

## 6. Routing inputs

- **Task:** `task_id`, objective, requirements, optional `backend_id`
- **Project Intelligence:** `runtime.requirements`, isolation hints, verification (referenced)
- **Policy context:** ForgeOS decision + allowed/forbidden paths / approval scopes
- **Backend:** Stage 3 capabilities + `health()` + `canHandle()`

## 7. canHandle

Uses Stage 3 semantics: capability match only; `authorization: null`.

## 8. Health

Selectable: `healthy` only.

`unhealthy` / `unavailable` / `unknown` → not selected (distinct from Policy DENY).

## 9. Explicit backend selection

```text
backend_id = X
```

Still requires:

1. registered  
2. healthy  
3. canHandle match  
4. ForgeOS policy ALLOW  

Never bypasses policy or capability checks.

## 10. Multiple eligible backends

**Strategy:** deterministic **registration order** (first eligible wins).

No cost / latency / reputation scoring in Stage 4.  
`RouteDecision.selection` lists all eligible ids and notes when multiple matched.

## 11. RouteDecision

```text
status: DENIED | NO_COMPATIBLE_BACKEND | ROUTED
        | INVALID_REQUEST | NO_BACKENDS_REGISTERED
task_id
backend_id | null
reasons[]
candidates[]
policy_decision
selection
evidence   // routing evidence only
authorization: null
execution: null
```

## 12. Task isolation

Every decision carries `task_id`. Task A route is not Task B authorization.

## 13. No fallback execution

No automatic A→B failover after failure. Eligibility/selection only.

## 14. No runtime start

`route()` must not invoke backend execution lifecycle methods.

`prepareRunRequestFromRoute` may draft fields for a future `createRunRequest` — still no `start()`.

## 15. Future routing evolution

Later stages may add:

- scoring / preferences  
- fallback policies  
- execution lifecycle orchestration (`runtime/execution.mjs` — Stage 5)  
- concrete third-party adapters (Cline / OpenHands / Codex / Claude)

Stage 5 ships a **Local Executor** reference backend for real bounded execution.
See `RUNTIME-ADAPTER-LOCAL-EXECUTOR.md` and `EXECUTION-LIFECYCLE.md`.

## 16. Relationship to execution lifecycle

```text
Planner / Orchestrator
      ↓
Policy Authority
      ↓
Runtime Router.route()     ← Stage 4
      ↓
createRunRequest (later)
      ↓
backend.start() (later)
```

## 17. Evidence

Routing evidence explains: task, policy decision, candidates, health, capability match, selected backend.

Not runtime transcripts or verification acceptance.

## 18. Explicit non-goals

- Concrete production Runtime Backends  
- Cline / OpenHands / Codex / Claude adapters  
- Cursor as RuntimeBackend  
- `start` / `cancel` / evidence collection orchestration  
- Automatic fallback  
- Cost/latency/model ranking  
- Agent refactor / multi-host expansion  
- LLM provider / transcript / token systems  
