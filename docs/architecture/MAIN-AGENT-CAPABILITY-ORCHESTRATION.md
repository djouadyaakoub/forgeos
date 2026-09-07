# Main Agent / Capability Orchestration — Architecture 2.0 Stage 11

Stage 11 adds intent → capability planning on top of Stages 8–10.

```text
User request
 ↓
Main Agent (plan only)
 ↓
Intent Analysis
 ↓
Project Intelligence + Assessment
 ↓
Capability Selection (registry only)
 ↓
Dependency Planning (deterministic)
 ↓
Task Candidates (Stage 9 contract)
 ↓
[Approval → Policy → Resolver → Governed Execution]  // downstream, unchanged
```

## Main Agent responsibility

Module: `intelligence/orchestrator/main-agent.mjs`  
CLI: `node cli/plan.mjs "<request>"`

The Main Agent:

- analyzes intent
- selects registered capabilities
- plans dependencies
- generates Stage 9 task candidates
- exposes risk and unresolved questions

The Main Agent does **not**:

- execute
- call `backend.start()`
- authorize (Policy Authority)
- own runtime selection
- verify or write authoritative evidence
- modify Project Intelligence

`execution_status` for plans is always `NOT_STARTED`.

## Intent model

`intelligence/orchestrator/intent.mjs`

Captures:

- objective / requested outcome
- scope / constraints
- urgency (only if explicit)
- risk signals
- requested capability hints
- unresolved questions

Does not invent requirements. Unknown stays unknown.

## Capability selection

`intelligence/orchestrator/capability-selection.mjs`

- Selects only IDs present in `agents/registry.yaml`
- Unknown IDs → `{ status: "UNRESOLVED", reason: "no_registered_capability" }`
- Assessment-aware: `SATISFIED` / `NOT_APPLICABLE` skip remediation unless user explicitly requested change
- Expands declared `requires:` dependencies for inspectable ordering

## Dependency model

Capabilities may declare:

```yaml
requires: [structure-audit]
```

Examples in the registry:

- `codebase-organization` requires `structure-audit`
- `safe-refactor` requires `architecture-guard`

Planner: `intelligence/orchestrator/dependency-planner.mjs`

- deterministic topological order (lexicographic Kahn)
- cycle detection
- duplicate elimination
- `parallelizable` is a planning hint only (no parallel execution in Stage 11)

## Task generation

Uses existing `createTaskCandidate` (Stage 9). Adds:

- `depends_on: [task_id, ...]`
- `parallelizable: boolean`

Tasks remain non-executing (`execute: false`, `auto_execute: false`).

## Existing agent mapping

Capability ≠ Agent.

Permanent specialists remain implementation/intelligence providers behind capabilities via `specialist_ids`:

| Specialist | Example capabilities |
|------------|----------------------|
| orchestrator | orchestration |
| architect | cross-cutting-design, architecture-guard, change-impact |
| codebase-organization | structure-audit, codebase-organization, safe-refactor |
| docs-sync | documentation-sync, documentation-drift |
| security | auth-review |
| qa-bugfix | reproduce-bug, test-coverage-strategy |
| … | … |

Main Agent says “capability required”.  
Resolver says “implementation currently valid”.  
Policy says “allowed/denied”.

## Host-native first

Resolver preference order is unchanged (`host_native` → `forgeos_native` → `oss_backed`).  
OpenHands is optional and not required for planning.

## Approval / policy / execution boundaries

```text
Plan → explicit task-scoped approval → Policy Authority → Resolver → coordinateGovernedExecution
```

- No blanket approval
- No `--yes` / `--force`
- `forgeos plan --execute` is rejected
- Existing `forgeos run` Stage 9 semantics preserved

## Plan fingerprint

Deterministic hash of:

- normalized intent
- Project Intelligence fingerprint
- selected capabilities + dependency edges
- task candidate identities
- relevant assessment states

Timestamps are not the primary identity.

## CLI

```bash
node cli/plan.mjs "Organize this project professionally" [--json] [--project <dir>]
node cli/run.mjs [dir]                         # assess + plan (Stage 8)
node cli/run.mjs [dir] --execute --approve-task <id>  # Stage 9 (unchanged)
```

## JSON plan

Includes: `intent`, `capabilities`, `tasks`, `dependencies`, `unresolved`, `risk_summary`, `execution_status: "NOT_STARTED"`.
