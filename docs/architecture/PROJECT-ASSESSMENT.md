# Project Assessment + Capability Resolution — Architecture 2.0 Stage 8

## Purpose

Stage 8 introduces the **assess + plan** layer for `forgeos run` without automatic execution.

```text
Project Intelligence (authoritative)
        +
Assessment Evidence (docs/project/assessments/*.json)
        +
Verified Task History (future Stage 9 linkage)
        ↓
Derived Project Canvas (display only)
```

## Components

| Module | Role |
|--------|------|
| `intelligence/capability/binding.mjs` | Extends `agents/registry.yaml` into formal capability bindings |
| `intelligence/assessment/engine.mjs` | Project Assessment Engine — WHAT needs attention |
| `intelligence/assessment/applicability.mjs` | Deterministic capability applicability |
| `intelligence/capability/resolver.mjs` | WHICH implementation — no execution |
| `intelligence/assessment/canvas.mjs` | Derived canvas representation |
| `cli/run.mjs` | `forgeos run` assess + plan CLI |

## Boundaries

- **Assessment** never calls `backend.start()` or `executeGoverned()`.
- **Capability Resolver** never authorizes (Policy Authority remains `policy/authority.mjs`).
- **Runtime Router** remains lower-level for `oss_backed` execution (Stage 4 unchanged).
- **Planner** still decides HOW to address findings (unchanged).
- **Canvas** is derived — never written back to `.agent-os/project.yaml`.

## Host-native first

Resolution order when allowed by binding:

1. `host_native`
2. `forgeos_native`
3. `oss_backed` → Runtime Router (future governed execution)

OpenHands is **not** the default owner of ForgeOS capabilities.

## Evidence lifecycle

Assessment artifacts include:

- `forgeos_version`
- `project_intelligence_fingerprint`
- `capability_binding_fingerprint`
- `input_fingerprint`
- `freshness_ttl`

Evidence may become **stale** when PI changes, bindings change, TTL expires, or inputs change.

Only **verified** evidence may mark a capability `SATISFIED`.

## CLI

```bash
node cli/run.mjs [project_dir] [--json] [--no-persist] [--capability <id>]
```

`--execute` is **blocked** in Stage 8.
