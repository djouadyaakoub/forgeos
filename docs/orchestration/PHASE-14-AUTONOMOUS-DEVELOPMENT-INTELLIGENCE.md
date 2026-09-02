# Phase 14 — Autonomous Development Intelligence Orchestration

**Status:** PASS  
**Date:** 2026-09-02  
**Scope:** Universal Agent OS only (`C:\Apps\cursor-agent-os`)  
**Reference project (read-only):** `C:\Apps\speed-flexy-server` — not modified

---

## 1. Planner Architecture

Phase 14 transforms the Development Intelligence Layer from static capability lists into an **adaptive orchestration engine**.

```text
User Request
 ↓
Understand → Classify → Assess Complexity/Risk
 ↓
Build Development Workflow (minimum viable)
 ↓
Execute → Evidence → Verify → Learn
```

**Layer responsibilities (no layer bypasses another):**

| Layer | Role |
|-------|------|
| **Orchestrator** | Coordinates execution |
| **Planner** | Decides recommended workflow |
| **Policy Engine** | ALLOW/BLOCK |
| **Architect** | Architectural judgement |
| **Specialists** | Domain implementation |
| **QA** | Verification |
| **Security** | Security review |
| **Docs Sync** | Documentation truth |
| **Knowledge Curator** | Persistent knowledge selection |

### Modules

| Module | Path |
|--------|------|
| Planner | `intelligence/orchestrator/planner.mjs` |
| Coordinator | `intelligence/orchestrator/coordinator.mjs` |
| Classification | `intelligence/orchestrator/classification.mjs` |
| Complexity | `intelligence/orchestrator/complexity.mjs` |
| Risk assessment | `intelligence/orchestrator/risk-assessment.mjs` |
| Triggers | `intelligence/orchestrator/triggers.mjs` |
| Scoring | `intelligence/orchestrator/scoring.mjs` |
| Execution | `intelligence/orchestrator/execution.mjs` |
| Routing (legacy) | `intelligence/orchestrator/routing.mjs` |

**Entry points:**

- `planDevelopmentIntelligenceWorkflow(request, context)` — pure planning
- `coordinateDevelopmentWorkflow(input)` — loads project adapter + policy + registry, returns plan + execution record

**Bootstrap integration:** `bootstrap/e2e-orchestrator.mjs` now uses `coordinateDevelopmentWorkflow()`.

---

## 2. Classification

Multi-label task classes (`classification.mjs`):

```text
BUG_FIX | FEATURE | REFACTOR | ARCHITECTURE_CHANGE | SECURITY |
PERFORMANCE | DATABASE | MIGRATION | DOCUMENTATION |
PROJECT_ORGANIZATION | RESEARCH | DEPENDENCY | RELEASE | INVESTIGATION
```

Tasks can combine labels, e.g. `FEATURE + DATABASE + SECURITY`.

---

## 3. Complexity / Risk Model

**Complexity** (`complexity.mjs`) — how hard is the work?

Factors: files affected, domains, components, database/API impact, cross-agent dependencies, unknowns. Project adapter can add `project_signals.complexity_boost`.

| Level | Typical signals |
|-------|-----------------|
| LOW | 1–2 isolated signals, explain/investigate |
| MEDIUM | Multiple files, one subsystem |
| HIGH | Multiple subsystems, public interfaces |
| CRITICAL | Production-scale cross-cutting |

**Risk** (`risk-assessment.mjs`) — how dangerous is failure?

Separate from complexity. Example: rename variable → LOW complexity, LOW risk. Change one migration → LOW complexity, **CRITICAL** risk.

Risk escalation invalidates prior approvals via `requiresApprovalInvalidation()`.

---

## 4. Workflow Generation

`planDevelopmentIntelligenceWorkflow()` produces:

```yaml
development_workflow:
  task_class: "FEATURE + DATABASE"
  complexity: HIGH
  risk: HIGH
  objectives: []
  required_capabilities: []
  recommended_agents: []
  stages:
    - name: research
      agent: solution-research
      capability: solution-research
      reason: "..."
      required: true
      parallelizable: false
      depends_on: []
      handoff:
        inputs: []
        outputs: [research_result]
        evidence_required: [sources_consulted, decision]
  verification:
    required: true
    commands: []
  security_review: { required: true/false, reason: "..." }
  architecture_review: { required: true/false }
  research: { required: true/false, reason: "..." }
  documentation_sync: { required: true/false }
  structure_review: { required: true/false }
  skipped_agents: []
  skipped_reasons: {}
```

**Adaptive rules:** stages added/removed based on trigger evidence. Skipped agents include reasons (e.g. "Simple task does not need research").

---

## 5. Agent Scoring

`scoring.mjs` — `scoreSpecialist()` factors:

- Capability match
- Path ownership
- Domain match
- Risk compatibility (tier limits)

Score alone **cannot** override policy. `discoverCapabilities()` merges global + project registry.

---

## 6. Dynamic Replanning

`execution.mjs` → `replanWorkflow()`:

```text
pause → reassess → expand workflow → request approval if risk increased → continue
```

When scope changes (e.g. migration discovered mid-task):

- `approval_invalidation_required: true`
- `pause_required: true` for CRITICAL escalation

---

## 7. Approval Interaction

Approval required when risk is HIGH/CRITICAL or scopes include:

- production_operation, migration, security_boundary, credential_change

Orchestrator cannot bypass approval. Risk escalation clears `approvals_granted`.

Policy Engine retains ALLOW/BLOCK authority — Security Agent reviews; Policy decides.

---

## 8. Evidence Model

Each stage defines `handoff.evidence_required`. `recordStageEvidence()` persists:

```yaml
evidence:
  files_inspected: []
  commands_run: []
  tests_passed: []
  sources_consulted: []
  decisions: []
```

`validateStageEvidence()` blocks stage completion without required evidence.

---

## 9. Learning Integration

`finalizeWorkflow()` → Knowledge Curator → Learning Factory → **proposal only**.

- `silent_global_modification: false`
- Planner does not self-modify rules during a task

---

## 10. Research Integration

`shouldTriggerResearch()` checks:

1. Project knowledge sufficiency
2. Research cache TTL (`docs/agents/research/`)
3. Fast-changing topic revalidation
4. Keyword triggers (new technology, offline sync, library selection, etc.)

Skipped when: explain tasks, known domain, valid cache.

---

## 11. Structure Integration

`shouldTriggerStructure()` for: refactor, organization, many moved files, module extraction.

Not triggered for: small bugs, rename variable, explain.

Structure Plan still required before moves (Phase 13).

---

## 12. Multi-Agent Orchestration

Multi-domain tasks (e.g. Go + Flutter + Supabase) produce parallel implementation stages with `integration-verification` merge point.

`depends_on` explicitly models stage ordering. `parallelizable: true` when no dependency conflict.

---

## 13. Failure Recovery

`handleAgentFailure()`:

- `max_retries: 2` (default)
- Strategies: retry → alternate_agent → escalate to architect
- No infinite retry loops

---

## 14. Efficiency Model

`computeWorkflowEfficiency()` tracks:

- required vs executed vs unnecessary stages
- parallelization opportunities
- replanning count
- verification failures
- efficiency score (0–100)

Cost-awareness: prefer minimal workflow when risk is equal; security/correctness/verification always win.

---

## 15. E2E Results

| Scenario | Request | Result |
|----------|---------|--------|
| **A — Simple** | Explain backend queue | specialist only; research/security skipped |
| **B — Complex** | Offline-first sync subsystem | research + architect + implementation + QA |
| **C — Refactor** | Refactor queue module | change-impact + structure + safe-refactor + tests |
| **D — Security** | Change tenant authorization | security gate automatic |
| **E — Unknown tech** | Evaluate technology X | research before architect |
| **F — Escalation** | Migration discovered mid-task | replan → CRITICAL → approval invalidation |

Speed Flexy: read-only validation — planner runs, project not modified.

---

## 16. Security Results

- Security auto-triggered for auth, tenant, payments, secrets, production, MCP
- Policy engine authority preserved (`policy_authority: policy_engine`)
- Risk escalation invalidates stale approvals
- No privilege escalation in planner paths

---

## 17. Limitations

- Specialist selection uses heuristics when project adapter lacks domain agents
- No live web search in planner — research stage delegates to solution-research agent
- Parallel execution is planned but not auto-executed concurrently in bootstrap E2E
- Token/cost estimates not available in all environments
- Global registry YAML parsing is lightweight (not full YAML parser)

---

## Tests

```bash
npm run test:orchestration   # 35/35 PASS (Phase 14)
npm run test:intelligence    # 38/38 PASS (Phase 13)
npm test                     # 13/13 PASS
npm run test:plugin          # 7/7 PASS
npm run test:runtime         # 10/10 PASS
npm run test:adapter         # 14/14 PASS
npm run test:bootstrap       # 10/10 PASS
npm run test:policy          # PASS
```

---

## Success Criteria

```text
✓ unnecessary agents skipped
✓ research triggered when uncertainty exists
✓ architecture review triggered when needed
✓ security triggered automatically for sensitive work
✓ structure agent triggered for organization/refactoring
✓ workflow can re-plan
✓ approvals revalidated on risk escalation
✓ evidence model defined
✓ project isolation maintained
✓ planner connected to orchestrator (coordinator + e2e)
✓ previous tests remain green
✓ Speed Flexy not modified
```

**Phase 14: PASS**
