# Phase 20 — Universal Project Intelligence Hardening

**Status: PASS**  
**Date:** 2026-09-02  
**ForgeOS version:** 1.0.0

---

## 1. Canonical Project Intelligence Model

Internal unified model (`bootstrap/project-intelligence.mjs`):

```text
Canonical Project Intelligence
├── project identity
├── stack / components
├── capabilities (normalized)
├── agents (normalized)
├── ownership
├── policies
├── verification
├── deployment
├── knowledge
├── confidence summary
└── contradictions
```

Sources may include registry, SPECIALISTS.md, playbooks, AGENTS.md, ownership docs, CI, manifests — output is always canonical.

---

## 2. Multi-format extraction

Extended `bootstrap/adapter-extraction.mjs` + `bootstrap/multi-format-extraction.mjs`:

| Source | Handler |
|--------|---------|
| `.cursor/agents/registry.yaml` | Registry extractor (verified) |
| `.cursor/agents/*.md` | Agent file linkage |
| `docs/agents/SPECIALISTS.md` | Table parser |
| `docs/agents/task-playbooks/` | Playbook-derived agents/caps |
| `AGENTS.md` | Specialist table rows |
| `docs/map/ownership.md` | Ownership table |
| README / package scripts | Verification commands |

No source is required. Empty sections return empty arrays (no fake agents).

---

## 3. Capability normalization

`bootstrap/capability-normalizer.mjs`:

```yaml
capability:
  id: ""
  source: ""
  confidence: 0.0–1.0
  confidence_level: VERIFIED | INFERRED | HEURISTIC
  inferred: true|false
  domains: []
  paths: []
  agent: ""
  evidence: []
```

Inferred capabilities carry `confidence < 0.9` and `inferred: true`.

---

## 4. Agent normalization

Agents normalized to:

```yaml
agent:
  id: ""
  source_type: registry | markdown | playbook | documentation
  capabilities: []
  confidence: 0
  evidence: []
```

Playbooks do not auto-create `.cursor/agents/*.md` files.

---

## 5. Ownership extraction

From registry, `ownership.md`, path tables — with confidence and evidence.

Contradictions reported via `bootstrap/evidence-resolver.mjs` (no silent resolution).

---

## 6. Confidence model

Levels: `VERIFIED`, `INFERRED`, `HEURISTIC`, `UNKNOWN` (via `bootstrap/intelligence-model.mjs`).

Inference does not auto-promote to verified.

---

## 7. Source priority

Default order: explicit policy → registry → agent defs → playbooks → AGENTS.md → architecture/ownership → CI → heuristics.

Registry wins merges when conflicting with inferred docs.

---

## 8. Conflict resolver

`bootstrap/evidence-resolver.mjs`:

- Merges capabilities, agents, ownership
- Emits `CONTRADICTION` for agent/path conflicts
- Does not silently pick winners for risky conflicts

---

## 9. Project profile

`buildCanonicalProjectProfile(projectDir)` returns full profile for Planner input.

`profileToPlannerContext()` bridges to orchestrator.

---

## 10. Adapter generation modes

| Project type | Behavior |
|--------------|----------|
| ForgeOS-native (registry) | Registry-first, verified confidence |
| Legacy/custom (playbooks) | Docs/playbook extraction |
| No agent system | Stack + CI + manifests only |

---

## 11–12. Subject vs action risk

`intelligence/orchestrator/risk-assessment.mjs` + `action-risk.mjs`:

| Dimension | Example |
|-----------|---------|
| `subject_risk` | HIGH — auth/production topic |
| `action_risk` | LOW — read-only analyze |
| Combined | Max of both; approval only when action is not READ/ANALYZE/PLAN |

Action types: READ, ANALYZE, PLAN, WRITE, EXECUTE, DEPLOY, DELETE, PRODUCTION_CHANGE.

---

## 13–15. Deployment intent & investigation fix

`deployment-intent.mjs` + updated `shouldTriggerDeployment()`:

- **Execution workflow** only when `deployment_intent.requested === true` or explicit deploy language
- **Discovery-only** for "discover deployment targets / analyze deployment setup"
- Read-only investigation **no longer** triggers build → approve → deploy chain

Verified: analyze + "Do not modify" → specialist + verification only.

---

## 16–18. CI deployment discovery

`intelligence/deployment/ci-discovery.mjs` parses `.github/workflows/*`:

- Detects `wrangler pages deploy`, `supabase db push`, `fly deploy`, etc.
- Confidence + evidence per target
- Secret **names** only (no values)

Integrated into `discovery.mjs` via `mergeCiTargets()`.

---

## 19. Verification improvements

Merged from registry, AGENTS.md code blocks, package.json scripts, pubspec paths.

---

## 20–22. Trigger refinements

| Trigger | Change |
|---------|--------|
| Research | Not fired by "production" alone |
| Structure | Not fired for pure analysis |
| Security | Removed blanket `/production/` and `/deploy/` triggers |
| Deployment | Requires intent, not INVESTIGATION + targets |

---

## 23–24. Planner decision trace

`development_workflow.decision_trace`:

```yaml
triggers: []
selected: []
skipped: [{ agent, reason }]
explanations: []
```

`formatDeploymentIntentExplanation()` included in trace.

---

## 25–26. Dynamic replan & approval invalidation

`invalidateApprovalOnActionEscalation()` in `risk-assessment.mjs` for READ→WRITE, staging→production escalations.

Planner exposes `action_type`, `subject_risk`, `action_risk` for replan hooks.

---

## 27. Fixture matrix

`tests/fixtures/intelligence-matrix/`:

| Fixture | Role |
|---------|------|
| A | Reuses `adapter-mature` (registry) |
| B | `specialists-only` |
| C | `playbook-only` |
| D | AGENTS.md patterns (in multi-format tests) |
| E | Empty / stack-only (existing empty fixture) |
| F | Contradiction fixture (existing) |
| G | `ci-only-deploy` |

---

## 28. sim-activation validation (read-only)

| Metric | Result |
|--------|--------|
| Capabilities extracted | **14** (from SPECIALISTS + playbooks) |
| Agents normalized | **24** |
| Cloudflare Pages (CI) | **Detected** |
| Project modified | **No** |

---

## 29. Speed Flexy validation (read-only)

| Metric | Before Phase 20 | After Phase 20 |
|--------|-----------------|----------------|
| Capabilities | 37 (registry) | **49** (registry + any doc merges) |
| Agents | 13 | **25** |
| Registry behavior | — | **Preserved** (verified source wins) |

No modifications to Speed Flexy.

---

## 30. Cross-project comparison

| Dimension | Speed Flexy | sim-activation |
|-----------|-------------|----------------|
| Stack | Go + Flutter + Node | Flutter + React + Supabase |
| Capabilities | Registry-heavy | Playbook/SPECIALISTS-heavy |
| Agents | 13 registry + merges | 24 playbook-derived |
| Deployment | fly.io, cloudflare, supabase | cloudflare-pages (CI), supabase, flutter-build |
| Isolation | ✓ | ✓ |

---

## 31–32. Isolation tests

- Research cache: project A ≠ project B (`tests/project-intelligence.test.mjs`)
- Deployment: fly.io on Speed Flexy not on sim-activation
- Capabilities differ per project

---

## 33. Security tests

- Inferred capabilities cannot reach VERIFIED confidence
- Documentation cannot grant tier elevation
- Conflict resolver surfaces mismatches
- Global protected paths unchanged

---

## 34. Tests added

`npm run test:project-intelligence` — **15/15 PASS**

Covers: normalization, fixture matrix, evidence resolver, action risk, deployment intent, planner fix, triggers, research isolation, live sim-activation, Speed Flexy.

---

## 35. Regression

| Suite | Result |
|-------|--------|
| `npm test` | 13/13 |
| `npm run test:adapter` | 14/14 |
| `npm run test:orchestration` | 35/35 |
| `npm run test:intelligence` | 38/38 |
| `npm run test:deployment` | 36/36 |
| `npm run test:project-two` | 10/10 |
| `npm run test:project-intelligence` | 15/15 |
| All other Phase 16–19 suites | PASS |

---

## 36. Migration / compatibility impact

- **Backward compatible:** `extractProjectAdapter()` shape preserved (agents still object map)
- **Additive:** capabilities/agents may increase when docs exist (not a breaking change)
- **Planner:** Read-only workflows shorter; deploy workflows unchanged when intent explicit
- No new agents added

---

## 37. Remaining limitations

1. YAML playbook front-matter not parsed (title-line heuristic only)
2. Specialist ID slugification may differ from human names
3. `profile.deployment` may list generic `ci-cd` alongside specific CI providers
4. Live Cursor hook E2E still depends on project bootstrap (unchanged from Phase 19)
5. Automatic replan on mid-flight discovery not fully wired to coordinator (trace fields ready)

---

## 38. Success criteria

| Criterion | Status |
|-----------|--------|
| ForgeOS-native projects work | ✓ |
| Legacy/custom agent projects work | ✓ |
| Playbook projects → normalized capabilities | ✓ |
| No-agent projects → useful intelligence | ✓ |
| No fake capabilities | ✓ |
| Inferred facts carry confidence | ✓ |
| Contradictions surfaced | ✓ |
| Read-only investigation ≠ deployment | ✓ |
| CI workflow discovery | ✓ |
| Deployment requires explicit intent | ✓ |
| Subject vs action risk | ✓ |
| Research/structure triggers refined | ✓ |
| Project isolation | ✓ |
| Speed Flexy unaffected (read-only) | ✓ |
| sim-activation unmodified | ✓ |
| Regression green | ✓ |

---

**Phase 20 = PASS**

Universal Project Intelligence hardening complete. No changes to `sim-activation` or `speed-flexy-server` repositories.
