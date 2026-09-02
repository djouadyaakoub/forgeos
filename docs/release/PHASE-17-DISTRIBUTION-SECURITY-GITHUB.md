# Phase 17 — Distribution Security & GitHub Integration

**Status: PASS WITH LIMITATIONS**  
**Date:** 2026-09-02  
**Version:** 1.0.0  
**Builds on:** [Phase 16](./PHASE-16-GITHUB-PACKAGING-UNIVERSAL-DISTRIBUTION.md)

---

## 1. GitHub source configuration

Central configuration at `policy/distribution.yaml`:

```yaml
distribution:
  source:
    provider: github
    owner: ""
    repository: cursor-agent-os
    plugin_id: cursor-agent-os
  release_channel: stable
  update:
    enabled: true
    check_interval: "24h"
```

- Generic and configurable
- No credentials or user secrets
- Loaded via `policy/distribution.mjs`

---

## 2. Release discovery

Module: `intelligence/update/github.mjs`

```javascript
discoverLatestGithubRelease(config, options)
```

Returns: `version`, `tag`, `published_at`, `release_url`, `assets`, `release_manifest`, `channel`

Channels: `stable`, `beta`, `alpha` — stable excludes prereleases.

Discovery sources (in order):
1. Fixture path (tests)
2. Mock releases (tests)
3. GitHub public API (when configured)

---

## 3. Authenticity

Module: `intelligence/update/authenticity.mjs`

`verifySourceAuthenticity()` enforces:
- Configured `owner` (when set)
- Configured `repository`
- Expected `plugin_id`
- Release manifest `plugin_id`

**Blocked:** arbitrary owner, repository, branch-as-release.

---

## 4. Integrity (SHA256)

Module: `scripts/security/checksum.mjs`

```javascript
calculateSha256(file)
verifySha256(file, expected)
```

On mismatch: **BLOCK** — no install attempted.

---

## 5. Signature model

Module: `intelligence/update/signature.mjs`

```javascript
verifyReleaseSignature(manifest, options)
```

| Mode | Status |
|------|--------|
| Signing key available | Abstraction ready; full verification not implemented |
| Default | **checksum-only** (documented minimum) |

Checksum success does **not** bypass policy or approval.

---

## 6. Trust model

| Layer | Meaning |
|-------|---------|
| **Authenticity** | Release belongs to configured GitHub source |
| **Integrity** | Downloaded artifact matches SHA256 |
| **Compatibility** | Project adapter can use the release |
| **Policy** | Whether action is allowed (approval, tiers) |

---

## 7. Update checker

Extended `intelligence/update/checker.mjs`:

- `discoverUniversalOsUpdateRemote()` — local + remote
- `checkForUpdate()` — respects cache interval and `force_check`
- Remote unavailable → `state: UNKNOWN` (not "no update")

```yaml
update_status:
  installed: "1.0.0"
  latest: "1.1.0"
  update_available: true
  channel: stable
  security_update: false
```

---

## 8. Security advisory

Schema: `schemas/security-advisory.yaml`

Release manifest field: `security.advisory: true` raises notification priority but does **not** bypass compatibility, approval, or rollback.

---

## 9. Update status

`agent-os update status` (read-only):

- Installed / latest version
- Release channel
- Security status
- Affected projects
- Migrations required
- `--refresh` via `force_check: true`

Modules: `intelligence/update/status.mjs`

---

## 10. Staged installation

```text
download → verify → stage → validate → activate
```

| Module | Role |
|--------|------|
| `downloader.mjs` | Download to temp, verify checksum |
| `activate.mjs` | Backup, validate, activate, verify, rollback |
| `lock.mjs` | Prevent concurrent updates |

Backups: `~/.cursor/agent-os/backups/<version>/`

---

## 11. Compatibility & migration

Unchanged from Phase 16 with integrity gates:

| Status | Behavior |
|--------|----------|
| AUTO_SAFE | Eligible when integrity + authenticity verified |
| REVIEW_REQUIRED | Proposal + explicit approval |
| MANUAL | Blocked |
| INCOMPATIBLE | Notify only, no mutation |

`buildUpdateProposal()` in `intelligence/update/proposal.mjs`

---

## 12. Rollback

Tested scenarios:
- Checksum mismatch → BLOCK
- Downgrade → blocked without `allow_downgrade`
- Failed activation → rollback install manifest
- Failed migration → adapter backup restored
- Concurrent update → `UPDATE_IN_PROGRESS`

---

## 13. Offline behavior

- Installed runtime continues working
- Update check returns `UNKNOWN` / `remote_unavailable`
- Cached metadata used for display only (not for unverified install)

---

## 14. Release builder

`scripts/release/build-release.mjs` produces:

```text
release/
  cursor-agent-os-1.0.0.zip
  release-manifest.json
  checksums.json
  dist/cursor-agent-os-1.0.0/
```

Does **not** publish to GitHub.

---

## 15. CI

`.github/workflows/ci.yml` extended with:
- `tests/distribution-security.test.mjs`
- `validate-release.mjs` checks checksums + security tests

---

## 16. Multi-project behavior

Registry dashboard via `getProjectDashboard()`:

```yaml
project:
  id: ""
  path: ""
  installed_os: ""
  adapter_schema: ""
  compatibility: ""
  update_status: ""
  migration_required: false
```

Metadata only — no secrets, no business logic.

---

## 17. E2E scenarios

| Scenario | Result |
|----------|--------|
| A: 1.0→1.1 AUTO_SAFE | ✓ |
| B: REVIEW_REQUIRED proposal | ✓ |
| C: INCOMPATIBLE no mutation | ✓ |
| D: checksum mismatch BLOCK | ✓ |
| E: GitHub unavailable UNKNOWN | ✓ |
| F: rollback on failure | ✓ |
| G: A/B/C multi-project | ✓ |
| H: downgrade blocked | ✓ |

---

## 18. Limitations

1. **Signature verification** — checksum-only in practice; signing abstraction documented
2. **GitHub API** — uses public metadata; token auth deferred to secure user storage
3. **ZIP archive** — placeholder archive for checksum CI; full zip bundling can be enhanced
4. **No GitHub publish** — release candidate ready locally; no tag/push/release created

---

## 19. Success criteria

| Criterion | Status |
|-----------|--------|
| GitHub release discovery works | ✓ |
| Configured source enforced | ✓ |
| Release manifest validated | ✓ |
| Artifact checksum verified | ✓ |
| Tampered artifact blocked | ✓ |
| Version compatibility enforced | ✓ |
| AUTO_SAFE constrained | ✓ |
| REVIEW_REQUIRED requires approval | ✓ |
| INCOMPATIBLE does not mutate | ✓ |
| Staged install safe | ✓ |
| Rollback works | ✓ |
| Remote outage does not break runtime | ✓ |
| Project registry isolated | ✓ |
| No secrets stored | ✓ |
| No arbitrary repo install | ✓ |
| No silent project mutation | ✓ |
| Downgrade protected | ✓ |
| Concurrent updates prevented | ✓ |
| Previous tests green | ✓ |

---

## 20. Test results

| Suite | Result |
|-------|--------|
| `npm run test:security` | 25/25 PASS |
| `npm run test:distribution` | 25/25 PASS |
| `npm test` | 13/13 PASS |
| `npm run test:policy` | 13/13 PASS |
| `npm run test:bootstrap` | 10/10 PASS |
| `npm run test:adapter` | 14/14 PASS |
| `npm run test:runtime` | 10/10 PASS |
| `npm run test:plugin` | 7/7 PASS |
| `npm run test:intelligence` | 38/38 PASS |
| `npm run test:orchestration` | 35/35 PASS |
| `npm run test:deployment` | 36/36 PASS |
| `npm run validate-release` | READY |

---

## Distribution lifecycle (complete)

```text
Universal Agent OS
       ↓
GitHub Source (configured)
       ↓
Versioned Release
       ↓
Authenticity + SHA256
       ↓
Secure Install (staged)
       ↓
Secure Update
       ↓
Compatibility
       ↓
Project Migration (with approval)
       ↓
Verification
       ↓
Rollback
```

**Phase 17 = PASS WITH LIMITATIONS**

Ready for release candidate review. No GitHub Release created in this phase.
