# Project Intelligence Contract

**Architecture 2.0 — Stage 1**

ForgeOS uses a **Project Intelligence Contract** as the canonical representation of what it knows about a project.

## Canonical source

| Item | Value |
|------|--------|
| Persisted path | `.agent-os/project.yaml` |
| Alternate JSON | `.agent-os/project.json` (optional) |
| Loader | `policy/project-adapter.mjs` → `loadProjectManifest` |
| Contract API | `policy/project-intelligence-contract.mjs` |
| Schema | `schemas/project-intelligence-contract.schema.yaml` |

There is **one** project-level source of truth. Do not introduce parallel `intelligence.json` stores.

## Contract version

```yaml
schema_version: 1
contract:
  version: 1
```

| Rule | Behavior |
|------|----------|
| Preferred | `contract.version` |
| Legacy | `schema_version` alone → treated as contract version |
| Missing both but `project:` present | Treated as version **1** |
| Unsupported version | Fail closed with clear error |

Current: **1** · Supported: **1..1**

## Authority classes

Not all fields are equally trustworthy:

| Class | Meaning |
|-------|---------|
| **DECLARED** | Explicit project YAML / human-authored |
| **DISCOVERED** | Filesystem/stack evidence (candidate) |
| **INFERRED** | Heuristic enrichment |
| **APPROVED** | Requires task/human approval to act |
| **AUTHORITATIVE** | Binding for policy, ownership, protected paths, identity |

Examples (see schema for full map):

- `project.id`, `ownership`, `policy.protected_paths` → **AUTHORITATIVE**
- `stack` → **DISCOVERED**
- `capabilities`, `verification.commands` → **DECLARED**
- `runtime.requirements` → **DECLARED** constraints (not backend selection)

**Discovery must not silently overwrite explicit declarations.**

## Empty-list semantics

Where the schema says **array**, empty is valid:

```yaml
capabilities: []
ownership: []
policy:
  protected_paths: []
  tier3_operations: []
integrations:
  mcp: []
verification:
  commands: []
```

`agents` is a **mapping object**, not a list:

```yaml
agents: {}
```

Forbidden coercions: `[]` → `{}`, `[]` → `"[]"`.

## Global + project

```text
Global ForgeOS baseline
        +
Project contract
        →
Effective capabilities / merged agents
```

Formula (capabilities): `global + project`  
Policy: project may **add** restrictions; must **not** weaken global protected paths or baseline Tier 3.

```text
Global Policy ∩ Project Restrictions ∩ Agent Permissions ∩ Task Scope ∩ Approval
```

## Runtime requirements (Stage 1)

Optional block for a **future** Runtime Router:

```yaml
runtime:
  requirements: {}
```

Allowed constraint keys (optional): `interactive`, `autonomous`, `sandbox`, `parallel`, `network`, `filesystem`.

This describes **constraints**. It does **not** select Cline, OpenHands, Codex, or Claude.

## Knowledge boundaries

```text
Global ForgeOS Knowledge
        │
        X  no silent promotion
        │
Project Knowledge (pointers in contract)
        │
Task Evidence (docs/project/tasks/)
```

## Pipeline

```text
Raw .agent-os/project.yaml
        ↓
parseSimpleYaml
        ↓
normalizeProjectManifest (agent_os ↔ forgeos)
        ↓
normalizeManifestListFields
        ↓
toProjectIntelligenceContract + validate
        ↓
Planner / Orchestrator / Policy consumers
```

## Project vs task vs run

| Layer | Owns |
|-------|------|
| **PROJECT** | This contract |
| **TASK** | `docs/project/tasks/**` |
| **RUN** | Runtime session / future backend execution |

Do not move task/run state into the project contract.

## Backward compatibility

Existing v1 manifests without `contract:` continue to load as contract version 1.  
Bootstrap/`adapterToYaml` writes both `schema_version` and `contract.version`.

## Stage 25 facts and interpretations partition

Canonical project configuration remains `.agent-os/project.yaml` (or JSON fallback), unchanged in authority. `intelligence/assessment/knowledge.mjs` adds a derived, project-scoped knowledge view, not a parallel authoritative project configuration.

`collectKnowledgeFacts(projectDir)` owns collection of bounded filesystem content fingerprints, configuration fingerprint, StructuralFacts observations and graph observations. It bypasses structural cache for freshness, then deep-freezes the returned snapshot. `partitionProjectKnowledge(facts, entries)` accepts only in-process collector snapshots, retains the facts branch by identity, and builds a separate interpretation branch from a whitelist. It cannot merge interpretation keys into facts. Deep freeze is a JavaScript API guard, not an OS sandbox or authentication against arbitrary code in the process.

The assessment result exposes `project_knowledge`; interpretations do not influence capability resolution, Policy, verification or Canvas state. Existing StructuralFacts evidence classes and derived/non-authoritative semantics are retained: a parser observation is not semantic certainty or authoritative configuration.

Candidate hypotheses/conclusions/learnings require ID, text, project workspace, based_on_fact_fingerprint, confidence in [0,1], file evidence_refs and provenance (human/heuristic/llm, source, observed_at). Unknown top-level fields and malformed entries are INVALID. Cross-project or missing-reference entries are QUARANTINED. A different fact fingerprint is STALE. CURRENT means matching bounded facts/provenance, not factual correctness, approval or promotion. Repetition/success never promotes a learning to facts.

Optional `.agent-os/interpretations.json` is an array of these non-authoritative records. It is read-only to ForgeOS in this stage and excluded from the fact fingerprint to avoid self-invalidation. There is no automatic session-memory ingestion or global promotion. API callers can instead supply interpretations directly. Configuration, preferences and general methodology are not stored as project facts in this file.

```text
node cli/knowledge.mjs --project <directory> --json
```

This read-only diagnostic collects facts and classifies candidate records. Malformed JSON yields an INVALID store entry; unsafe linked storage fails closed. Evidence references resolve only to inventoried file paths; their existence does not prove the interpretation's claim.

Analysis scope reports included fingerprints, omitted paths/reasons, parser diagnostics as unsupported detail, truncation and limits (default 1,000 files; maximum 10,000; depth 12; 1 MiB per file). Dependencies/build outputs/generated assessment outputs and symlinks are omitted. PARTIAL is explicit; COMPLETE_WITHIN_DECLARED_SCOPE never means whole-project semantic completeness. Changes outside included scope need not change the fact fingerprint; interpretations may only reference included evidence.

No runtime dependency, external agent, new permanent specialist, vendor hook or discovery-catalog registration was introduced by Stage 25.

## Project knowledge lifecycle and product workflow

`intelligence/assessment/knowledge-lifecycle.mjs` adds controlled project-local write-back in `.agent-os/knowledge/records.json`. The legacy `.agent-os/interpretations.json` remains read-only and is not silently imported or accepted. Both stores are interpretations, never deterministic facts. Knowledge and discovery metadata directories are excluded from fact inventory so review does not invalidate its own sources.

New candidates always start UNREVIEWED. Review status (UNREVIEWED, ACCEPTED, REJECTED) is independent from freshness (CURRENT, STALE, QUARANTINED, INVALID). Acceptance requires an explicit local human operator assertion; agents can reject but cannot accept. The writer identity cannot accept its own candidate. This is API/CLI separation, not authenticated proof that a human operated the local process: arbitrary same-user code can edit local files. History is retained; stale accepted entries cannot be reaccepted without a new current candidate.

Write-back is compact text with file references, source/time/confidence, workspace, fact fingerprint and scope. Task-derived candidates additionally bind task, execution, governance evidence and Task Scope fingerprints. Current retrieval revalidates this chain, including evidence integrity and freshness against current verification fingerprints. Existing checksums are integrity checks, not signatures. Presence verification proves file presence, not the truth of a learning or documentation completeness.

`retrieveKnowledge()` returns only CURRENT ACCEPTED project interpretations with exact path, task or capability relevance, deterministic ordering and explicit omissions. Default limits are five items / 6,000 serialized item bytes; hard maxima are twenty items / 32,000 bytes. Diagnostics and envelope overhead are outside the item budget. It never returns instructions or overrides current facts, configuration, Policy, scope, verification or Canvas. New product handoff preparation returns this host-neutral context alongside the handoff; legacy host/plan APIs do not silently inject it.

The local metadata writer bounds stores to 256 records / 1 MiB and review history to 64 entries per record, serializes writers with exclusive locks and atomically replaces the store. Invalid JSON and unsafe symlink/junction paths fail closed. Crash locks require explicit operator inspection/recovery; there is no silent cleanup. Compact content rejects recognized credential-like strings, control/binary characters, code fences, transcript-like dialogue and reasoning markers. These conservative heuristics are not a complete secret detector or semantic truth classifier.

Use `node cli/forgeos.mjs --help` for status, next, complete, knowledge review/recall and inert discovery. `next --prepare` prepares a same-workspace interactive task, not execution. `complete --learning` verifies first, persists governance evidence, derives Canvas, then creates an UNREVIEWED candidate. Knowledge failure is reported separately from successful verification. Supplied changed paths are checked but are not an exhaustive observation of host activity.

Generic capability discovery is separately implemented in `intelligence/capability/discovery.mjs`. Local HTTPS URLs, source/license/revision, claims and execution requirements remain inert metadata. Metadata eligibility is only readiness for manual registration review: it is neither installation, availability, registration, claim verification nor Policy approval. No catalog ingestion, network client, dynamic import, host launch or backend registration is connected to it.
