# Phase 19 — Real Project #2 Validation: sim-activation

**Status: PASS WITH LIMITATIONS**  
**Date:** 2026-09-02  
**ForgeOS version:** 1.0.0  
**Project under test:** `C:\Apps\sim-activation` (read-only)  
**Reference project (not used for assumptions):** `C:\Apps\speed-flexy-server`

---

## 1. Project discovery

```yaml
project_discovery:
  project_id: sim-activation
  project_type: monorepo

  repository:
    languages:
      - Dart/Flutter
      - TypeScript/JavaScript
      - SQL
      - Kotlin (Android Gradle)
      - Python (local tooling only)
    package_managers:
      - npm (admin-web, tools/download-worker)
      - pub (Flutter apps and packages)
      - supabase CLI

  components:
    - name: admin-web
      path: admin-web/
      stack: [React 19, TypeScript, Vite 8, Tailwind 4, TanStack Query, Supabase JS]
      evidence: [admin-web/package.json, admin-web/src/main.tsx]
    - name: pdv
      path: pdv/
      stack: [Flutter, Android, Supabase]
      evidence: [pdv/pubspec.yaml, pdv/lib/main.dart]
    - name: distributeur
      path: distributeur/
      stack: [Flutter, Android HCE, Supabase]
      evidence: [distributeur/pubspec.yaml]
    - name: packages
      path: packages/
      stack: [Flutter packages: ui_kit, sim_update, cnibe_hce, secure_session]
      evidence: [packages/*/pubspec.yaml]
    - name: supabase
      path: supabase/
      stack: [Postgres, RLS, Auth, Storage]
      evidence: [supabase/config.toml, supabase/migrations/]
    - name: tools
      path: tools/
      stack: [PowerShell APK pipeline, Cloudflare Worker, R2 OTA]
      evidence: [tools/README.md, tools/download-worker/package.json]
    - name: admin
      path: admin/
      stack: [Flutter Web — RETIRED]
      evidence: [AGENTS.md, admin/README.md]

  entrypoints:
    - path: pdv/lib/main.dart
      type: Flutter mobile (PDV)
      evidence: verified
    - path: distributeur/lib/main.dart
      type: Flutter mobile (Distributor)
      evidence: inferred from structure
    - path: admin-web/src/main.tsx
      type: React SPA (Super Admin)
      evidence: verified
    - path: supabase/migrations/
      type: Database schema channel
      evidence: verified

  databases:
    - provider: Supabase Postgres
      evidence: [supabase/config.toml, supabase/migrations/]
      project_ref: klmaapbnxapxsuopttit
      source: docs/STACK.md (verified against config)

  external_services:
    - Supabase Auth / Storage
    - Cloudflare Pages (admin.sim-dz.com)
    - Cloudflare R2 + Worker (download.sim-dz.com)
    - Google OAuth (via Supabase)
    evidence: [README.md, docs/STACK.md, .github/workflows/]

  deployment_targets:
    - provider: cloudflare-pages
      component: admin-web
      url: https://admin.sim-dz.com
      evidence: [.github/workflows/deploy-admin-web-pages.yml, README.md]
    - provider: supabase
      component: database
      evidence: [.github/workflows/deploy-supabase-migrations.yml, supabase/migrations/]
    - provider: cloudflare-worker
      component: download
      evidence: [tools/download-worker/package.json, README.md]
    - provider: r2-ota
      component: mobile
      evidence: [tools/release.ps1, docs/android-build.md]
      note: inferred from docs, not a generic ForgeOS provider

  testing:
    frameworks:
      - Flutter test (pdv/, distributeur/)
      - TypeScript build (admin-web npm run build)
    commands:
      - cd admin-web && npm run build
      - cd pdv && flutter test
    ci_note: Flutter app CI not in .github/workflows (verified per AGENTS.md)

  documentation:
    paths:
      - AGENTS.md
      - docs/STACK.md
      - docs/architecture.md
      - docs/contracts/
      - docs/agents/
      - docs/map/ownership.md
      - .cursor/rules/

  existing_agent_os:
    detected: partial
    forgeos_manifest: false          # no .agent-os/project.yaml
    agents_md: true
    cursor_rules: true               # .cursor/rules/*.mdc
    cursor_registry: false           # no .cursor/agents/registry.yaml
    docs_playbooks: true             # docs/agents/task-playbooks/
    universal_runtime: false         # no .cursor/hooks.json portable shims
```

**ForgeOS `buildProjectProfile()` result:** `EXISTING_PROJECT`, `initialized: true` (via `AGENTS.md`), stack: node + flutter + java + python (tools only).

---

## 2. Detected stack

| Layer | Technology | Evidence |
|-------|------------|----------|
| Admin web | React 19, Vite 8, TypeScript | `admin-web/package.json` |
| Mobile | Flutter/Dart (PDV, Distributeur) | `*/pubspec.yaml` |
| Backend | Supabase Postgres + RLS | `supabase/` |
| Android | Gradle/Kotlin wrappers | `*/android/*.gradle.kts` |
| OTA/Downloads | R2 + Cloudflare Worker | `tools/`, README |
| Retired | Flutter `admin/` | AGENTS.md quarantine |

`detectStackIndicators()` correctly detects nested markers (not root-only). No Go, no Docker at repo level.

---

## 3. Components

See discovery YAML. Production surfaces: `admin-web/`, `pdv/`, `distributeur/`, `supabase/`, `packages/*`, `tools/`. Quarantine: `admin/`.

---

## 4. Adapter creation / reconciliation

| Item | Status |
|------|--------|
| `.agent-os/project.yaml` | **missing** |
| `.cursor/agents/registry.yaml` | **missing** |
| `.cursor/policy/rules.json` | **missing** |
| Agent model | **docs/agents playbooks** (project-native, not ForgeOS registry format) |

**Assessment:** `incomplete` — mature project with its own agent OS in `docs/agents/`, not yet bridged to ForgeOS Project Adapter.

**Bootstrap dry-run** (`node bootstrap/initialize.mjs --dry-run --project-dir sim-activation`):

```json
{
  "planned_actions": [
    { "action": "create", "path": ".agent-os/project.yaml" },
    { "action": "create", "path": "docs/project/tasks/index.yaml" },
    { "action": "create", "path": ".cursor/agents/registry.yaml" },
    { "action": "create", "path": ".cursor/hooks.json" }
  ],
  "proposed_adapter": {
    "capabilities": 0,
    "agents": [],
    "deployment": { "providers": ["supabase"] }
  }
}
```

**Not applied** — sim-activation left read-only per Phase 19 integrity rules.

**Reconciliation gap (generic):** `adapter-extraction.mjs` reads `.cursor/agents/registry.yaml`; sim-activation uses `docs/agents/SPECIALISTS.md` + playbooks. Extraction returns empty capabilities — this is a **generic gap**, not a sim-activation workaround.

---

## 5. Capabilities

| Source | Count | Notes |
|--------|-------|-------|
| ForgeOS extraction | 0 | No registry.yaml |
| Project docs (ownership.md) | 7 areas | Inferred from `docs/map/ownership.md` |
| AGENTS.md specialists | 12 playbooks | Project-native routing |

No capabilities invented. Proposed ForgeOS adapter would need playbook-to-capability mapping as a future generic enhancement.

---

## 6. Agents

| ForgeOS global agents | sim-activation project agents |
|-----------------------|-------------------------------|
| 11 (orchestrator, architect, security, …) | 0 in registry format |
| Used via planner scoring | 12 playbooks in `docs/agents/task-playbooks/` |

Orchestrator selects global specialists by task class; does not require project registry. Appropriate for this validation.

---

## 7. Ownership

From `docs/map/ownership.md` (verified):

| Area | Paths |
|------|-------|
| Admin web | `admin-web/` |
| PDV mobile | `pdv/` |
| Distributor | `distributeur/` |
| Shared Flutter | `packages/*` |
| Backend | `supabase/` |
| Release | `tools/` |
| Quarantine | `admin/` |

---

## 8. Policy

**Global ForgeOS policy** applied when `CURSOR_PROJECT_DIR=sim-activation`:

| Test | Expected | Result |
|------|----------|--------|
| A — Write `.cursor/hooks.json` | BLOCK | **deny** (`protected_path`) |
| B — `git push` without approval | BLOCK | **deny** (`missing_task_context`) |
| C — Wrong-task approval | BLOCK | **deny** (`no_approved_scope_match`) |

**Project-local policy:** `.cursor/rules/95-security-secrets.mdc` defines KYC/PII/secrets discipline — Cursor-native, not ForgeOS Tier 3 registry.

**Limitation:** No project-specific Tier 3 operations (e.g. `wrangler pages deploy`) until adapter + registry created. Global rules still block protected paths.

---

## 9. Deployment

**ForgeOS `discoverDeploymentTargets()` (evidence-based):**

| Provider | Component | Confidence |
|----------|-----------|------------|
| supabase | database | 0.85 |
| flutter-build | mobile (pdv, distributeur, packages) | 0.6 |
| ci-cd | .github/workflows | 0.5 |

**Not auto-detected:** `cloudflare-pages` (no `wrangler.toml` at repo root; deploy via CI `npx wrangler pages deploy`). **Generic gap:** CI workflow content parsing incomplete.

**Human-verified targets** (from project docs): Cloudflare Pages, Supabase migrations CI, R2 OTA, download Worker.

**Dry-run deployment plan:** Not executed (no ForgeOS adapter applied; no production deploy per constraints).

---

## 10. Environment

| Environment | Evidence |
|-------------|----------|
| production | admin.sim-dz.com, download.sim-dz.com |
| local dev | `.vscode/dart_defines.json`, `admin-web/.env.local` (gitignored) |
| CI secrets | GitHub Secrets (CLOUDFLARE_*, SUPABASE_*) |

No secret values exposed during validation.

---

## 11. Research

| Test | Task | Research triggered? |
|------|------|-------------------|
| 4 | Supabase RLS maintainability | **Yes** — `research` stage planned |

Research cache path: `docs/agents/research/` (per ForgeOS design). **Neither project has cache files yet** — isolation vacuously holds.

---

## 12. Structure intelligence

| Test | Task | Workflow |
|------|------|----------|
| 3 | Structure audit | `specialist-execution` → `verification` (2 stages) |

Structure-audit capability invoked via specialist path. No file moves executed.

---

## 13. Change impact

| Test | Task | Workflow |
|------|------|----------|
| 5 | Impact of changing `admin-web/src` | `specialist-execution` → `verification` |

Appropriate minimal workflow. Change-impact agent not over-invoked for this phrasing.

---

## 14. Security

| Test | Task | Security triggered? |
|------|------|---------------------|
| 6 | Auth/permissions analysis | **Yes** — `security-review` stage |

Sensitive domains in project: KYC/PII, RLS, HCE, billing (per `.cursor/rules/95-security-secrets.mdc`).

---

## 15. Full Orchestrator E2E (Node harness)

Harness: `node bootstrap/e2e-orchestrator.mjs --project-dir sim-activation`

| # | Task type | Stages | Research | Security | Notes |
|---|-----------|--------|----------|----------|-------|
| 1 | INVESTIGATION | 13 | No | Yes | **Over-triggers** deployment pipeline |
| 2 | Explain startup | 2 | No | No | ✓ Minimal |
| 3 | Structure audit | 2 | No | No | ✓ Minimal |
| 4 | RLS evaluation | 4 | Yes | No | ✓ Research appropriate |
| 5 | Change impact | 2 | No | No | ✓ Minimal |
| 6 | Security analysis | 3 | No | Yes | ✓ Security appropriate |
| 7 | Deployment discovery | 13 | No | Yes | **Over-triggers** full deploy workflow |

**Generic gap:** INVESTIGATION + `risk: HIGH` triggers full release/deployment chain even for read-only tasks (tests 1, 7).

---

## 16. Cursor runtime E2E

| Check | Status |
|-------|--------|
| `.cursor/hooks.json` with portable shims | **Not present** |
| `.agent-os/runtime.yaml` | **Not present** |
| `integrate-runtime.mjs` | **Blocked** — requires `.agent-os/project.yaml` first |

**Validated instead:**

```text
Node harness (CURSOR_PROJECT_DIR=sim-activation)
  → ForgeOS Runtime resolution
  → Orchestrator / Planner
  → Global specialists
```

**Not validated:** Live Cursor hook interception in sim-activation workspace. Would require `--apply-adapter` + `integrate-runtime` (explicitly deferred to preserve read-only integrity).

---

## 17. Project isolation

| Dimension | Speed Flexy | sim-activation | Isolated? |
|-----------|-------------|----------------|-----------|
| Stack | Go + Flutter + Node + Docker | Flutter + Node + Supabase (no Go) | ✓ |
| Top-level dirs | backend, superadmin, … | pdv, admin-web, supabase, … | ✓ |
| Capabilities (registry) | 37 | 0 | ✓ |
| Agents (registry) | 13 | 0 | ✓ |
| Deploy providers | fly.io, cloudflare-pages, supabase, docker | flutter-build, supabase, ci-cd | ✓ |
| fly.io | Present | Absent | ✓ |
| Research cache | N/A (empty) | N/A (empty) | ✓ |

---

## 18. Speed Flexy leakage test

| Check | Result |
|-------|--------|
| sim-activation knowledge in ForgeOS Core | **None** (only Phase 19 test fixtures) |
| fly.io assumed for sim-activation | **No** |
| Speed Flexy paths in planner for sim-activation | **No** |
| Speed Flexy adapter copied to sim-activation | **No** |
| sim-activation modified | **No** (git clean) |

---

## 19. Tests

### ForgeOS regression (all green)

| Suite | Result |
|-------|--------|
| `npm test` | 13/13 |
| `npm run test:policy` | 13/13 |
| `npm run test:bootstrap` | 10/10 |
| `npm run test:adapter` | 14/14 |
| `npm run test:runtime` | 10/10 |
| `npm run test:plugin` | 7/7 |
| `npm run test:intelligence` | 38/38 |
| `npm run test:orchestration` | 35/35 |
| `npm run test:deployment` | 36/36 |
| `npm run test:distribution` | 25/25 |
| `npm run test:security` | 25/25 |
| `npm run test:neutrality` | 5/5 |
| `npm run test:migration` | 5/5 |
| `npm run test:branding` | 7/7 |
| `npm run test:project-two` | **10/10** (new) |

---

## 20. Files modified

### sim-activation

```text
files_created:   0
files_modified:  0
files_deleted:   0
```

Git working tree: **clean** (verified).

### ForgeOS (validation artifacts only)

```text
files_created:
  - docs/validation/PHASE-19-SIM-ACTIVATION.md
  - tests/project-two-sim-activation.test.mjs
  - tests/fixtures/phase19-bootstrap-dryrun.txt
  - tests/fixtures/phase19-orchestrator-test[1-7].json

files_modified:
  - package.json  (added test:project-two script)
```

---

## 21. Limitations

1. **No live Cursor hook E2E** — sim-activation not bootstrapped with ForgeOS runtime (read-only constraint).
2. **Adapter extraction gap** — projects using `docs/agents/` playbooks without `.cursor/agents/registry.yaml` yield empty capabilities.
3. **Planner over-trigger** — read-only INVESTIGATION tasks with HIGH risk invoke full deployment workflow (tests 1, 7).
4. **Deployment discovery gap** — Cloudflare Pages from CI workflow not surfaced without `wrangler.toml` marker file.
5. **Project-specific Tier 3** — no project-local tier3 until adapter applied; only global policy active.
6. **Research cache isolation** — not exercised (no cache files in either project).

---

## 22. Compare with Speed Flexy

| Dimension | Speed Flexy | sim-activation |
|-----------|-------------|----------------|
| **Stack** | Go API, Flutter superadmin, Node | Flutter mobile ×2, React admin, Supabase |
| **Components** | backend, superadmin, web | pdv, distributeur, admin-web, supabase, packages |
| **Agents** | 13 registry agents | 12 docs playbooks (no registry) |
| **Capabilities** | 37 extracted | 0 (different agent model) |
| **Deployment** | fly.io, Cloudflare, Supabase | Cloudflare Pages, Supabase CI, R2 OTA |
| **Policy** | Full adapter + Tier 3 | Global ForgeOS + Cursor rules only |
| **Verification** | Registry commands | Per-component README/AGENTS |
| **Knowledge** | `.agent-os` + docs | AGENTS.md + docs/ (no ForgeOS manifest) |
| **Research** | Project-scoped path | Same path design, empty |
| **Structure** | Go modules + Flutter | Monorepo multi-surface |

**Conclusion:** Universal OS adapts per project evidence; no unified configuration imposed.

---

## 23. Orchestrator flow proof

```text
ForgeOS
   ↓
Discover sim-activation          ✓ buildProjectProfile()
   ↓
Detect stack                     ✓ flutter, node, java, supabase evidence
   ↓
Extract project evidence         ✓ docs, ownership, STACK.md
   ↓
Create Project Adapter           ◐ dry-run proposed (not applied)
   ↓
Load Project Knowledge           ✓ AGENTS.md, docs/* via discovery
   ↓
Capabilities / policy            ◐ global only (no project registry)
   ↓
Initialize Universal Runtime     ✗ not applied (read-only)
   ↓
Orchestrator                     ✓ e2e-orchestrator harness
   ↓
Select specialists dynamically   ✓ task-class routing
   ↓
Research when needed             ✓ test 4
   ↓
Security when needed             ✓ test 6
   ↓
Final verified result            ✓ evidence-based answers in harness
```

---

## 24. Generic gaps identified (not sim-activation workarounds)

| Gap | Type | Suggested Core fix |
|-----|------|-------------------|
| Playbook-based agent OS not extracted | Generic | Extend `adapter-extraction.mjs` to read `docs/agents/SPECIALISTS.md` |
| INVESTIGATION triggers deploy chain | Generic | Refine planner risk→workflow for read-only objectives |
| CI-only Cloudflare deploy not discovered | Generic | Parse `.github/workflows/*.yml` for wrangler/pages deploy |
| integrate-runtime requires manifest first | By design | Document bootstrap order: adapter → runtime |

---

## 25. Success criteria

| Criterion | Status |
|-----------|--------|
| sim-activation discovered independently | ✓ |
| Adapter generated from project evidence | ◐ dry-run only |
| No Speed Flexy knowledge leakage | ✓ |
| Project isolation works | ✓ |
| Universal runtime works | ◐ harness only |
| Orchestrator works | ✓ |
| Planner adapts workflow | ◐ partial (over-trigger on tests 1,7) |
| Relevant agents selected | ✓ |
| Unnecessary agents skipped | ◐ partial |
| Policy works | ✓ (global) |
| Task approvals isolated | ✓ |
| Knowledge project-scoped | ✓ |
| Research project-scoped | ✓ (design; no cache yet) |
| Previous ForgeOS tests green | ✓ |
| Cursor runtime tested | ✗ not wired in sim-activation |

---

## 26. Final verdict

**PASS WITH LIMITATIONS**

ForgeOS demonstrates genuine project independence on sim-activation: correct stack discovery, isolation from Speed Flexy, working orchestrator/planner harness, and global policy enforcement — all without modifying the target project or copying Speed Flexy configuration.

Limitations are architectural (playbook-based projects, planner over-trigger, no live Cursor hooks) rather than security or isolation defects. No BLOCKED conditions met.

---

**Phase 19 complete.** No third project started. No Speed Flexy modifications. No sim-activation modifications.
