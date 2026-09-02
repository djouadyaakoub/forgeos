# Phase 13 — Development Intelligence & Codebase Organization

**Status:** PASS  
**Date:** 2026-09-02  
**Scope:** Universal Agent OS only (`C:\Apps\cursor-agent-os`)  
**Reference project (read-only):** `C:\Apps\speed-flexy-server` — not modified

---

## 1. Architecture

Phase 13 extends Universal Agent OS from orchestration/policy into a **Development Intelligence Layer**:

```text
User
 ↓
Universal Orchestrator
 ↓
Understand → Research → Plan → Architect Review
 ↓
Specialist Execution → Verification
 ↓
Structure Review → Security Review → Docs Sync → Knowledge Update
```

**Global Universal Knowledge** (workflows, policies, schemas, generic heuristics) remains separate from **Project Knowledge** (architecture, business logic, ADRs, project research cache).

Implementation lives under `intelligence/` with central exports in `intelligence/index.mjs`. Orchestrator routing is implemented in `intelligence/orchestrator/routing.mjs` and documented in `agents/orchestrator.md`.

---

## 2. New Agents

| Agent ID | Role |
|----------|------|
| `codebase-organization` | Structure audit, Structure Plans, safe organization |
| `solution-research` | Evidence-based research (READ / ANALYZE / COMPARE) |
| `project-archaeology` | Git/docs investigation — why code exists |
| `release-readiness` | Pre-release assessment |

Agent definitions: `agents/codebase-organization.md`, `agents/solution-research.md`, `agents/project-archaeology.md`, `agents/release-readiness.md`.

---

## 3. New Capabilities

Registered in `agents/registry.yaml`:

| Capability | Module |
|------------|--------|
| `structure-audit` | `intelligence/structure/analyzer.mjs` |
| `codebase-organization` | `intelligence/structure/plan.mjs` |
| `solution-research` | `intelligence/research/workflow.mjs` |
| `dependency-audit` | `intelligence/dependency/auditor.mjs` |
| `dead-code-analysis` | `intelligence/dead-code/detector.mjs` |
| `duplication-analysis` | `intelligence/duplication/analyzer.mjs` |
| `architecture-guard` | `intelligence/architecture/guardian.mjs` |
| `change-impact` | `intelligence/change-impact/analyzer.mjs` |
| `documentation-drift` | `intelligence/documentation/drift.mjs` |
| `test-coverage-strategy` | `intelligence/testing/coverage-strategy.mjs` |
| `safe-refactor` | `intelligence/refactor/safe-refactor.mjs` |
| `performance-investigation` | `intelligence/performance/investigator.mjs` |
| `knowledge-curation` | `intelligence/knowledge/curator.mjs` |
| `project-archaeology` | `intelligence/archaeology/investigator.mjs` |
| `release-readiness` | `intelligence/release/readiness.mjs` |

---

## 4. Structure System

### Structure Plan

Every organization operation must produce a reviewable plan (`schemas/structure-plan.yaml`):

- `createStructurePlan()`, `validateStructurePlan()`, `planToYaml()` in `intelligence/structure/plan.mjs`
- Rollback strategy included for MEDIUM+ changes
- No random file moves without plan validation

### Risk Classification

`intelligence/risk.mjs`:

| Level | Auto-execute | Examples |
|-------|--------------|----------|
| LOW | Yes | create directory, unused file move, harmless rename |
| MEDIUM | No | used module move, import changes, test moves |
| HIGH | No | package boundaries, public interfaces |
| CRITICAL | **Never** | migrations, auth, ledger, secrets, production config |

### Architecture-aware Analysis

`structureAudit()` considers ownership rules, conventions, mixed stacks, oversized modules, orphans — not filenames alone.

---

## 5. Research System

### Workflow

`planResearchWorkflow()` — Problem → requirements → technologies → search (prefer official docs) → compare → tradeoffs → recommend.

### Schema

`schemas/research-result.yaml` — candidates with relevance/maturity/maintenance scores (not stars alone).

### Caching

- Project-scoped: `<project>/docs/agents/research/<hash>.yaml`
- TTL: 90 days default, 14 days for fast-changing topics
- **Never stored in Global OS**

---

## 6. Change Impact

`analyzeChangeImpact()` produces:

- `impact_score`, `affected_paths`, `affected_agents`, `affected_tests`
- `risk_level`, `requires_security_review` for sensitive paths
- Deployment impact detection (migrations, hosting config)

---

## 7. Architecture Guardian

`architectureGuard()` reads architecture docs/ADRs and detects layer violations (e.g. UI → DB direct access). Status: `PASS` or `VIOLATIONS_FOUND`.

---

## 8. Dead Code / Duplication

- **Dead code:** evidence-based candidates only; `auto_delete: false`
- **Duplication:** exact hash and filename duplicates; consolidation proposals with `auto_merge: false`

---

## 9. Documentation Drift

`detectDocumentationDrift()` compares implementation signals vs STACK.md, AGENTS.md, README. Does not auto-fix architectural truth — uses Docs Sync flow.

---

## 10. Release Readiness

`assessReleaseReadiness()` outputs:

```yaml
release_readiness:
  status: READY | NOT_READY | BLOCKED
  blockers: []
  warnings: []
  evidence: []
```

---

## 11. Knowledge Curation

`curateKnowledge()` classifies information as temporary, permanent candidate, or reject (secrets). Architectural decisions require approval. Scope: project only; `global_persistence: false`.

---

## 12. Global / Project Boundary

| Global OS | Project |
|-----------|---------|
| Generic workflows | Architecture, ADRs |
| Generic policies | Business logic |
| Generic schemas | Project conventions |
| Generic agents | Project-specific research cache |
| Generic heuristics | Framework patterns |

Research cache, structure findings, and archaeology conclusions stay in the project. Speed Flexy was used read-only for validation — no business knowledge added to Global OS.

---

## 13. Update / Migration Model

`intelligence/compatibility/adapter.mjs`:

- `checkCompatibility()` — OS version range, adapter schema version, required features
- `planUniversalOsUpdate()` — discovers projects, generates migration proposals
- Migration modes: `AUTO_SAFE`, `REVIEW_REQUIRED`, `MANUAL`, `INCOMPATIBLE`
- `auto_upgrade_business_knowledge: false` — never auto-modify architecture, contracts, ADRs, schemas

Extended `checkAgentOsCompatibility()` in `policy/project-adapter.mjs` with `adapter_schema_version` and `migration_mode`.

### Project Registry

Optional metadata at `~/.cursor/agent-os/projects.yaml` via `intelligence/registry/projects.mjs` — paths, adapter version, OS version, status only.

---

## 14. Tests

```bash
npm run test:intelligence   # 38/38 PASS
npm test                    # 13/13 PASS (universal matrix)
npm run test:plugin         # 7/7 PASS
```

Coverage includes: structure analysis, structure plan, risk classification, dependency analysis, research schema/cache, architecture violations, change impact, dead code, duplication, documentation drift, knowledge curation, OS compatibility, project registry, multi-project isolation, security boundaries, Speed Flexy read-only structure audit.

---

## 15. Security

- Sensitive domains (auth, database, tenant, secrets, payments, ledger, production, permissions, MCP) auto-route through `security` via `requiresSecurityReview()`
- CRITICAL structure changes never auto-execute
- Knowledge curation rejects secret patterns
- Global protected paths unchanged
- No privilege escalation in new agents (tier limits enforced in `policy/rules.json`)

---

## 16. Limitations

- Structure analysis uses heuristics — not full import/call-graph parsing
- Dependency audit scans manifests only; no runtime usage analysis
- Dead code detection is filename/pattern based; full static analysis deferred
- Research agent provides workflow/schema — live web search integration is orchestrator responsibility
- Project registry is optional and local; no remote sync
- Adapter auto-migration not implemented (detection + proposals only)

---

## 17. Next Recommendations

1. Wire `planDevelopmentIntelligenceWorkflow()` into bootstrap/e2e orchestrator for automated routing in live sessions
2. Add import-graph analysis for structure plans (Go/TS module resolvers)
3. Integrate `npm audit` / `govulncheck` into dependency-audit
4. Add Structure Plan execution module with git-aware rollback
5. Project adapter template: include `agent_os.adapter_schema_version` and `compatibility` block in bootstrap output
6. Dashboard for `~/.cursor/agent-os/projects.yaml` during Universal OS updates

---

## Success Criteria

```text
Universal OS
  ├── Orchestrator (with Development Intelligence Loop)
  ├── Architect
  ├── QA
  ├── Security
  ├── Docs Sync
  ├── Codebase Organization
  ├── Solution Research
  ├── Project Archaeology
  └── Release Readiness
        ↓
Project Adapter → Project Knowledge

✓ No project knowledge leakage
✓ No privilege escalation
✓ Structure changes reviewed
✓ Research evidence-based
✓ Architecture protected
✓ Refactors verified (workflow defined)
✓ Global updates isolated from projects
✓ Project compatibility detectable
✓ Git remains source of truth for project knowledge
✓ Speed Flexy not modified
```

**Phase 13: PASS**
