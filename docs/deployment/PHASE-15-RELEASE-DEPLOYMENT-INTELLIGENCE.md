# Phase 15 — Release & Deployment Intelligence

**Status:** PASS  
**Date:** 2026-09-02  
**Scope:** Universal Agent OS only (`C:\Apps\cursor-agent-os`)  
**Reference project (read-only):** `C:\Apps\speed-flexy-server` — not modified, no production deployment executed

---

## 1. Architecture

Phase 15 adds a complete **Release & Deployment Intelligence** cycle:

```text
Validated Change
      ↓
Change Impact → QA → Security (when required)
      ↓
Environment Audit (production)
      ↓
Release Readiness
      ↓
Deployment Plan
      ↓
Build → Artifact Verification
      ↓
Approval (Tier 3 for production)
      ↓
Deploy
      ↓
Health Check → Smoke Tests → Observation Window
      ↓
Success / Rollback (approval-gated)
      ↓
Release Notes → Knowledge Update
```

**Universal vs Project boundary:**

| Universal OS | Project Adapter |
|--------------|-----------------|
| Deployment capability framework | Platform (fly.io, vercel, railway, supabase) |
| Plan/build/verify/rollback workflow | Component config, build commands |
| Secret redaction, approval model | Health checks, smoke tests |
| Failure classification, retry policy | Environment definitions |

No Speed Flexy-specific deployment logic in Global OS.

---

## 2. Deployment Agent

**Agent ID:** `release-deployment`  
**Definition:** `agents/release-deployment.md`

Responsibilities: discover targets, create deployment plans, build, execute approved deployments, verify, rollback planning/execution, release notes.

**NOT policy authority** — Policy Engine decides ALLOW/BLOCK.

---

## 3. Environment Agent

**Agent ID:** `environment-config`  
**Definition:** `agents/environment-config.md`

Responsibilities: environment discovery, config shape audit, environment diff.

**Never** reads, writes, or displays secret values.

---

## 4. Discovery

`intelligence/deployment/discovery.mjs` → `discoverDeploymentTargets()`

Evidence sources (no platform assumptions):

- Project adapter `deployment.platforms` / `deployment.profiles`
- Filesystem: `fly.toml`, `wrangler.toml`, `vercel.json`, `railway.json`, `Dockerfile`, `supabase/migrations`, CI configs
- `package.json` deploy scripts

Output per target: component, provider, confidence, evidence, config, deployable.

**Speed Flexy read-only validation:** discovers fly.io, cloudflare-pages, supabase from filesystem evidence — not modified.

**Sample-project fixture:** discovers vercel + railway (not fly.io) — proves no hard-coded Speed Flexy platforms.

---

## 5. Deployment Profiles

Schema: `schemas/deployment-profile.yaml`

`intelligence/deployment/profile.mjs` — `createDeploymentProfile()`, `profilesFromAdapter()`

Includes: build, deploy, verify (health + smoke), rollback, observation window. No credentials.

---

## 6. Deployment Plans

Schema: `schemas/deployment-plan.yaml`

`intelligence/deployment/plan.mjs` — `createDeploymentPlan()`, `validateDeploymentPlan()`

**Required before execution.** Integrates with `change-impact` via `inferDeployableComponents()`:

- `docs/` changes → no deployment
- `backend/` changes → backend deploy
- API contract changes → backend + web + mobile review

---

## 7. Build

`intelligence/deployment/build.mjs`

Records `build_evidence`: commands_run, artifacts, checksums, tests_passed.

---

## 8. Approval

Tier 3 operations (global policy):

- `production_deploy`
- `production_rollback`
- `production_migration`
- `production_configuration_change`
- `credential_environment_mutation`

Approval is **task-bound**, **operation-bound**, **scope-bound**. Self-approval forbidden. Cross-task approval rejected.

---

## 9. Execution

`intelligence/deployment/executor.mjs` → `executeDeployment()`

Pre-checks: policy, approval, environment, artifacts. Fail-closed → BLOCK.

**Dry-run:** `runDeploymentWorkflow({ dry_run: true })` or `formatDryRunReport()` — shows target, build, deploy, verification, rollback, approval requirements without execution.

---

## 10. Verification

`intelligence/deployment/verify.mjs`

Health check types: HTTP, WebSocket, CLI, database, worker, platform, custom (from deployment profile).

Smoke tests: project-aware from adapter profile.

Deployment not successful until verification evidence recorded.

---

## 11. Rollback

`intelligence/deployment/rollback.mjs`

Rollback plan required before production deployment. Execution approval-gated (Tier 3). No auto-rollback unless policy explicitly allows.

---

## 12. Monitoring

`intelligence/deployment/monitoring.mjs`

Bounded `observation_window` (default 10m, configurable per profile). No indefinite monitoring.

---

## 13. Failure Recovery

`intelligence/deployment/failure.mjs`

Failure types: BUILD_FAILED, DEPLOY_FAILED, HEALTH_CHECK_FAILED, SMOKE_TEST_FAILED, CONFIGURATION_FAILED, PLATFORM_FAILED, VERIFICATION_FAILED, POLICY_BLOCK.

Retry: max 2 attempts. Policy denial not retryable.

---

## 14. Security

- Secret redaction in all deployment evidence (`intelligence/deployment/redact.mjs`)
- Environment audit never exposes values
- Deployment agent cannot self-approve
- Security agent auto-routed for production/sensitive deployments (via Phase 14 planner)
- Cross-project deployment profile isolation verified

---

## 15. Project Adapter Extension

Backward-compatible blocks in `.agent-os/project.yaml`:

```yaml
deployment:
  profiles: []
environment:
  environments: []
compatibility:
  auto_migrate: false
```

Sample-project fixture: Vercel frontend + Railway backend.

---

## 16. Planner Integration

Phase 14 planner extended for release/deploy tasks:

```text
change-impact → tests → security → environment-audit → release-readiness
→ deployment-discovery → deployment-plan → build → approval
→ deploy → verify → monitoring → release-notes
```

`shouldTriggerDeployment()` uses `discoverDeploymentTargets()` — no `if project == speed-flexy`.

---

## 17. Tests

```bash
npm run test:deployment      # 36/36 PASS
npm run test:orchestration   # 35/35 PASS
npm run test:intelligence    # 38/38 PASS
npm test                     # 13/13 PASS
npm run test:plugin          # 7/7 PASS
npm run test:runtime         # 10/10 PASS
```

Coverage: discovery, profiles, plans, change-aware deployment, environment audit/diff, build, artifacts, approval, execution, health/smoke, rollback, retry, failure classification, release notes, secret redaction, privilege escalation, cross-project isolation, dry-run, planner integration, release readiness gate.

**No production deployment executed in tests.**

---

## 18. Speed Flexy Read-Only Validation

- Deployment targets discovered from evidence (fly.toml, wrangler.toml, supabase/migrations)
- Project not modified (mtime verified)
- No Speed Flexy strings in `discovery.mjs`

---

## 19. Limitations

- Build/deploy commands are simulated in tests (no live platform API calls)
- Deployment diff (current vs candidate version) requires runtime platform metadata not always available
- Staging → production promotion suggested but not auto-approved
- Platform-specific rollback commands come from project adapter, not universal defaults
- Live log/metrics integration depends on platform MCP availability

---

## Success Criteria

```text
✓ deployment platform discovered from project evidence
✓ no hard-coded Speed Flexy deployment logic
✓ production remains approval-gated
✓ rollback remains approval-gated
✓ environment secrets never exposed
✓ project isolation maintained
✓ deployment evidence persisted
✓ failures classified
✓ retries bounded
✓ dry-run available
✓ previous tests remain green
```

**Phase 15: PASS**
