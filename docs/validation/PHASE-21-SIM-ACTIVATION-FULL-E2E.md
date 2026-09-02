# Phase 21 — Real sim-activation Bootstrap & Full Cursor E2E

**Status: PASS WITH LIMITATIONS**  
**Date:** 2026-09-02  
**ForgeOS version:** 1.0.0  
**Target project:** `C:\Apps\sim-activation`  
**Reference (read-only):** `C:\Apps\speed-flexy-server`

---

## 1. Baseline

| Item | Pre-bootstrap state |
|------|---------------------|
| Git status | Clean (`main`, up to date) |
| `.agent-os/` | **Absent** |
| `.cursor/hooks.json` | **Absent** (`.cursor/rules/` existed) |
| ForgeOS manifest | **None** |
| Agent model | `docs/agents/SPECIALISTS.md` + playbooks (project-native) |
| CI | Cloudflare Pages + Supabase migrations |

**Canonical intelligence (Phase 20, read-only):**

| Metric | Value |
|--------|-------|
| Capabilities | 14 |
| Agents | 24 |
| Ownership | 10 |
| Deployment (discovery) | supabase, flutter-build, ci-cd + CI cloudflare-pages |
| Contradictions | 12 (SPECIALISTS vs playbook slug collisions — surfaced, not hidden) |

---

## 2. Adapter generation

**Dry-run:** `node bootstrap/initialize.mjs --dry-run --project-dir sim-activation`

- Project kind: `EXISTING_PROJECT`
- Proposed: `.agent-os/project.yaml` with 14 capabilities, 7 verification commands
- Sources: SPECIALISTS.md, playbooks, ownership.md, package manifests
- No Speed Flexy paths or assumptions

**Review:** Adapter reflects sim-activation stack (Flutter, React, Supabase, Cloudflare, R2/HCE via docs) — not Speed Flexy shape.

---

## 3. Adapter application

```powershell
node bootstrap/initialize.mjs --apply-adapter --project-dir "C:\Apps\sim-activation"
```

**Created:**

| Path | Purpose |
|------|---------|
| `.agent-os/project.yaml` | Project adapter (SIMACT prefix, capabilities, agents, ownership, verification) |

**Not modified:** Application source, migrations, secrets, production data.

---

## 4. Runtime integration

```powershell
node bootstrap/integrate-runtime.mjs --project-dir "C:\Apps\sim-activation"
```

**Created (`.cursor/` gitignored):**

| Path | Purpose |
|------|---------|
| `.cursor/hooks.json` | Portable hook commands (no absolute dev paths) |
| `.cursor/hooks/agent-os/*.mjs` | Portable shims |
| `.agent-os/runtime.yaml` | `UNIVERSAL_RUNTIME` |
| `.cursor/policy/local-runtime.RETIRED` | Local authority retired marker |

**Also created (tracked):**

| Path | Purpose |
|------|---------|
| `docs/project/tasks/index.yaml` | Task store skeleton |

**Runtime resolution:**

```json
{
  "runtime_mode": "UNIVERSAL_RUNTIME",
  "hook_strategy": "portable_shim",
  "absolute_dev_path_in_hooks": false,
  "plugin_root_resolved": "C:/Apps/ForgeOS"
}
```

Hooks use relative `node .cursor/hooks/agent-os/...` — no hard-coded checkout path in project hooks.

---

## 5. Cursor workspace

**Limitation:** This validation environment cannot drive live Cursor chat UI sessions programmatically.

**Proven instead:**

1. **Real hook execution** — `prove-policy-authority.mjs` spawns portable shim with workspace payload → **deny** on protected path (same chain Cursor uses)
2. **Orchestrator coordinator** — full planner + project adapter loaded with `CURSOR_PROJECT_DIR=sim-activation`
3. **Portable hooks.json** — ready for Cursor workspace open at `sim-activation`

**User action to complete live UI E2E:** Open `sim-activation` in Cursor; hooks activate automatically from `.cursor/hooks.json`.

---

## 6. Validation results

### Adapter validation

```powershell
node bootstrap/validate-applied-adapter.mjs --project-dir "C:\Apps\sim-activation"
```

**Result: PASS (14/14)**

Includes: manifest, capabilities, no Speed Flexy leakage, protected path BLOCK, tier3 BLOCK, cross-task BLOCK, portable hooks.

### Policy authority

```powershell
node bootstrap/prove-policy-authority.mjs --project-dir "C:\Apps\sim-activation"
```

**Verdict: `ONE_AUTHORITATIVE_DECISION`**

- Authority: `forgeos`
- Portable shim: ✓
- Live hook deny on `.cursor/hooks.json`: ✓

---

## 7. Orchestrator E2E (harness with applied adapter)

`npm run test:phase21` — **17/17 PASS**

| Test | Request | Result |
|------|---------|--------|
| T12 | Analyze project (read-only) | No deployment-execute |
| T13 | Inspect pdv/ | Specialist path, no deploy |
| T15 | Structure audit | No moves |
| T16 | Supabase RLS maintainability | Research triggered |
| T17 | Change impact admin-web/src | No deploy chain |
| T18 | Auth/permissions review | Security review required |
| T19 | Deployment discovery | Discovery only, no build |
| T20 | Dry-run admin-web deploy plan | Plan stages, no execute |

Evidence: `tests/fixtures/phase21-e2e-evidence.json`

---

## 8. Specialist delegation

T13 confirms orchestrator selects workflow from project intelligence (mobile/pdv domain) without Speed Flexy backend-api paths.

Project adapter agents include `activate-mobile`, `mobile`, ownership on `pdv/`.

---

## 9. Handoffs / task state

| Item | Status |
|------|--------|
| Task store | `docs/project/tasks/index.yaml` created |
| Task ID prefix | `SIMACT-YYYYMMDD-NNN` in manifest |
| Orchestrator execution records | Stages + evidence in coordinator output |
| Full resume-after-restart UI test | **Not automated** (limitation) |

---

## 10–14. Structure, Research, Change Impact, Security, Deployment

Covered by T15–T20 (all PASS). Deployment discovery includes **cloudflare-pages** from CI workflow parsing (Phase 20).

---

## 15. Policy tests

| Test | Expected | Actual |
|------|----------|--------|
| Protected path (`.cursor/hooks.json`) | BLOCK | **deny** (hook + dry-run) |
| Tier 3 (`git push`) | BLOCK | **deny** |
| Wrong-task approval | BLOCK | **deny** |
| Orchestrator write `pdv/lib/main.dart` | BLOCK | **deny** (no ownership) |

---

## 16. Approval isolation

Cross-task approval blocked with `SIMACT-20260902-001` vs `SIMACT-20260902-999`.

**Correct-task ALLOW (Test 24):** Not executed — sim-activation has no project-specific Tier 3 ops; global approvals require task approval files not created in this phase (policy evaluation only scope).

---

## 17. Project isolation

| Check | Result |
|-------|--------|
| sim-activation ≠ Speed Flexy capabilities | ✓ |
| No fly.io on sim-activation | ✓ |
| No Speed Flexy in manifest/adapter | ✓ |
| Research cache project-scoped | ✓ (Phase 20 test) |

---

## 18. Knowledge persistence

No global ForgeOS knowledge modified. Project knowledge remains in `sim-activation/docs/` and `.agent-os/project.yaml`.

Learning factory not triggered in bootstrap phase (by design — no implementation tasks).

---

## 19. Dynamic replanning

`invalidateApprovalOnActionEscalation(READ→WRITE)` and `ANALYZE→DEPLOY` — **PASS** (T28).

Planner exposes `action_type`, `subject_risk`, `action_risk`, `decision_trace`.

---

## 20. Update compatibility

`getUpdateStatus()` read-only — **PASS** (T29).

Project registered via manifest `project.id: sim-activation`.

---

## 21. Fresh runtime simulation

**Limitation:** Dev checkout resolves plugin root via `FORGEOS_DEV_ROOT` / repo discovery. True fresh-machine test requires user install manifest (`~/.cursor/forge-os/install.json`) without dev path — not fully simulated here.

Hooks themselves contain **no** absolute paths ✓.

---

## 22. Rollback

| Step | Result |
|------|--------|
| Rollback without backup | **Expected fail** (no prior hooks.json) |
| Rollback with synthetic backup | **Success** — restored hooks, runtime yaml archived |
| Re-integrate | **Success** — UNIVERSAL_RUNTIME restored |

---

## 23. Project changes audit

**Git tracked (uncommitted):**

```text
?? .agent-os/
?? docs/project/
```

**Gitignored (on disk, ForgeOS integration):**

```text
.cursor/hooks.json
.cursor/hooks/agent-os/
.cursor/policy/local-runtime.RETIRED
```

**Not changed:** Application source, migrations, secrets, Speed Flexy.

---

## 24. ForgeOS Core fixes (generic, not sim-specific)

| Fix | File |
|-----|------|
| Empty YAML `[]` parsed as `{}` broke tier3 merge | `policy/project-adapter.mjs` |
| `validate-applied-adapter` Speed Flexy-specific | Rewritten project-agnostic |
| Empty policy arrays in adapter YAML | `adapter-extraction.mjs` emit fix |

---

## 25. Regression

| Suite | Result |
|-------|--------|
| `npm test` | 13/13 |
| `npm run test:phase21` | 17/17 |
| `npm run test:project-two` | 10/10 |
| `npm run test:project-intelligence` | 15/15 |
| `npm run test:adapter` | 14/14 |
| `npm run test:orchestration` | 35/35 |
| `npm run test:deployment` | 36/36 |
| `npm run test:runtime` | 10/10 |
| `npm run test:policy` | 13/13 |

---

## 26. Security

| Check | Status |
|-------|--------|
| No secrets in adapter/manifest | ✓ |
| No Speed Flexy leakage | ✓ |
| Cross-project isolation | ✓ |
| Cross-task approval isolation | ✓ |
| Policy fail-closed | ✓ |
| Read-only ≠ deployment | ✓ |
| No production operations | ✓ |

---

## 27. Comparison

| Dimension | Speed Flexy | sim-activation |
|-----------|-------------|----------------|
| Intelligence | Registry-heavy | Playbook/SPECIALISTS-heavy |
| Stack | Go + Flutter + Node | Flutter + React + Supabase |
| Capabilities | ~49 (registry+docs) | 14 (docs-derived) |
| Deployment | fly.io, cloudflare, supabase | cloudflare-pages (CI), supabase |
| Runtime | Integrated (reference) | **Integrated (this phase)** |
| Cursor hooks | Portable shims | **Portable shims** |

---

## 28. Limitations

1. **Live Cursor chat UI E2E** — not automated in agent environment; hooks + orchestrator proven via harness and real hook spawn
2. **Handoff resume after context restart** — task store created; full UI resume not tested
3. **Correct-task ALLOW** — not tested (no approval fixture for sim-activation Tier 3)
4. **Fresh machine without dev checkout** — needs install manifest validation on clean host
5. **`.cursor/` gitignored** — integration files not in git diff (by project design)
6. **12 extraction contradictions** — SPECIALISTS vs playbook agent slug collisions (surfaced, not auto-resolved)
7. **Plugin root** — resolves to dev checkout when running bootstrap from `ForgeOS` (expected for local dev)

---

## 29. Classification of gaps

| Gap | Type |
|-----|------|
| Live Cursor chat automation | Cursor platform limitation |
| Fresh-machine plugin root | Deployment/distribution (install manifest) |
| Slug collision SPECIALISTS/playbooks | ForgeOS Core extraction (generic) |
| YAML empty array parsing | ForgeOS Core (fixed) |

No sim-activation-specific workarounds added.

---

## 30. Success criteria

| Criterion | Status |
|-----------|--------|
| Adapter applied | ✓ |
| Universal runtime active | ✓ |
| Portable hooks active | ✓ |
| Universal policy authoritative | ✓ |
| Orchestrator works (harness) | ✓ |
| Specialist delegation | ✓ |
| Structure / research / security / deployment discovery | ✓ |
| Policy BLOCK tests | ✓ |
| Project isolation | ✓ |
| Rollback + re-integrate | ✓ |
| Regression green | ✓ |
| Live Cursor UI chat E2E | ◐ Manual (workspace ready) |

---

## 31. Final verdict

**PASS WITH LIMITATIONS**

ForgeOS is **fully bootstrapped and runtime-integrated** on `sim-activation` with portable hooks, universal policy authority, project-specific adapter, and comprehensive harness E2E.

**Limitation:** Live Cursor UI orchestration sessions were not driven programmatically in this environment; the integration is **ready for manual Cursor workspace validation** and hook/policy behavior was verified via real shim execution.

---

**Next step for user:** Open `C:\Apps\sim-activation` in Cursor and run Test 1–10 from Phase 21 spec in chat to complete live UI confirmation.

No Speed Flexy modifications. No production operations. No application source changes.
