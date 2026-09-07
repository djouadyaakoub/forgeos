# Deterministic Project Intelligence — Architecture 2.0 Stage 13

ForgeOS strengthens Project Intelligence with **deterministic structural evidence** while preserving authority boundaries.

```text
Project
   ↓
Discovery
   ↓
Structural Analysis (Intelligence Providers)
   ├── babel-parser (optional OSS_DERIVED @babel/parser, forgeos_native)
   ├── forgeos-structural (bundled, zero-dep fallback)
   ├── tree-sitter (adapter present — packaging BLOCKED)
   └── SCIP (adapter present — packaging BLOCKED)
        ↓
Normalized Structural Facts (derived)
        ↓
Dependency graph (ForgeOS-native, from StructuralFacts only)
        ↓
Change impact / dependency intelligence (assessment)
        ↓
ForgeOS Assessment
        ↓
Capability Plan → Canvas (derived)
```

Governance remains separate:

```text
Policy Authority → Capability Resolver → Governed Execution → Verification → Evidence
```

## Architectural principle

External analyzers are **intelligence providers**.

They are **not** Policy Authority, Project Intelligence Authority, Planner, Executor, Verification Authority, or Canvas Authority.

## Adapter contract

`intelligence/adapters/adapter.mjs`

```text
id, name, version, capabilities, supported_languages
health(), canAnalyze(), analyze(), normalize()
```

Boundaries enforced by validation:

- no policy authority
- no Project Intelligence authority
- no Canvas authority
- no mutation / execution flags

## Analyzers

| Analyzer | Status | Notes |
|----------|--------|-------|
| `forgeos-structural` | **IMPLEMENTED** | Pure Node JS/TS structure (regex); always available fallback |
| `babel-parser` | **OPTIONAL OSS_DERIVED** | In-process `@babel/parser` → existing StructuralFacts; not required for clean install |
| `tree-sitter` | **BLOCKED** | Native/WASM deps break zero-dep clean-install; no fake CST |
| `SCIP` | **BLOCKED** | Protobuf/indexer deps not safe for default distribution; no fake symbols |

Default `runStructuralAnalysis` selects `babel-parser` when the optional package loads; otherwise `forgeos-structural`. Capability `structural-ast-analysis` is `OSS_DERIVED` / `forgeos_native`. Parser success is not verification PASS and not Canvas SATISFIED.

## Normalized facts

Schema: `schemas/structural-facts.schema.yaml`  
Module: `intelligence/adapters/structural-facts.mjs`

Facts are:

- deterministic (sorted + fingerprinted)
- serializable / versioned
- project-scoped
- `derived: true`, `authoritative: false`
- secret-safe (string redaction on messages)

Stale when project fingerprint, input fingerprint, analyzer version, or normalization version changes.

## Assessment integration

`runProjectAssessment` collects structural intelligence on demand and feeds modules:

- structure-audit / codebase-organization
- architecture-guard
- dependency-audit
- dead-code-analysis
- duplication-analysis
- change-impact

Evidence classes: `deterministic` | `heuristic` | `insufficient`.

Insufficient evidence never becomes SATISFIED.

## Caching

Optional cache under `.agent-os/cache/structural/` — fingerprint-bound, non-authoritative.

## Canvas

May show `evidence_source`, `analyzer`, `evidence_class`. Remains `derived: true`, `authoritative: false`.

## CLI

```text
node cli/inspect.mjs [project] [--json] [--changed file]
```

Read-only inspection. No remediation.

`forgeos run` continues to assess with structural enrichment.

## Security

Adapters must not execute project scripts, mutate files/PI/policy, create approvals, or call `backend.start`.

## Dependency decision

**Core remains usable with zero required npm dependencies.** `@babel/parser` is an **optionalDependency** (pinned 7.29.8, MIT, parse-only). Clean install / `--omit=optional` / missing `node_modules` fall back to `forgeos-structural`. `@babel/core` is not used.

See Stage 13 (tree-sitter/SCIP blockers) and Stage 19 report for the Babel provider.
