# Updates

Universal Agent OS updates are **global** (plugin/runtime). Project migrations are **separate** and never run silently.

## Check for updates

```powershell
node -e "import('./intelligence/update/status.mjs').then(m => console.log(JSON.stringify(m.getUpdateStatus(), null, 2)))"
```

Equivalent capability: `agent-os update status`

Shows:
- Installed version
- Latest available version (from release manifest)
- Per-project compatibility (`AUTO_SAFE`, `REVIEW_REQUIRED`, `MANUAL`, `INCOMPATIBLE`)
- Whether migrations are available

**No files are modified** by the status command.

## Review compatibility

```powershell
node -e "import('./intelligence/update/manager.mjs').then(m => console.log(JSON.stringify(m.planUniversalUpdate(), null, 2)))"
```

Each registered project receives a classification:

| Status | Meaning |
|--------|---------|
| `AUTO_SAFE` | Metadata-only changes; optional adapter fields |
| `REVIEW_REQUIRED` | Breaking or adapter migration — approval required |
| `MANUAL` | Missing required features — human intervention |
| `INCOMPATIBLE` | Version out of range — no automatic change |

## Apply update

### Global OS (user scope)

```powershell
node bootstrap/install-from-release.mjs --source "C:\path\to\release"
```

Or from development checkout (local validation):

```powershell
node bootstrap/install-from-release.mjs --source .
```

Dry run:

```powershell
node bootstrap/install-from-release.mjs --source . --dry-run
```

### Project migrations

Project adapter changes run **only** when explicitly approved:

```powershell
node -e "import('./intelligence/update/manager.mjs').then(m => console.log(JSON.stringify(m.applyUniversalUpdate({ approval: { granted: true } }), null, 2)))"
```

`REVIEW_REQUIRED` projects are **blocked** without `approval.granted: true`.

`INCOMPATIBLE` projects are **never** modified.

## Verify after update

```powershell
node -e "import('./intelligence/update/manager.mjs').then(m => console.log(JSON.stringify(m.verifyUpdate(), null, 2)))"
```

Expected: `UPDATE_VERIFIED` or `UPDATE_FAILED` with per-check details.

## Rollback

### Global OS install manifest

```javascript
import { rollbackUniversalUpdate } from './intelligence/update/migration.mjs';
rollbackUniversalUpdate('/path/to/install.json.backup');
```

### Project adapter

```javascript
import { rollbackProjectMigration } from './intelligence/update/migration.mjs';
rollbackProjectMigration('/path/to/project', '/path/to/project.yaml.backup-123');
```

Rollback is separate for global OS vs project adapter.

## Register / unregister projects

```powershell
node -e "import('./intelligence/registry/projects.mjs').then(m => { m.registerProject('C:/path/to/project'); console.log(m.discoverInstalledProjects()); })"
```

```powershell
node -e "import('./intelligence/registry/projects.mjs').then(m => { m.unregisterProject('C:/path/to/project'); })"
```

Registry stores **metadata only** — no secrets, no business logic, no full project knowledge.

## Semantic versioning policy

| Bump | Typical classification |
|------|------------------------|
| PATCH | `AUTO_SAFE` (bug/security/docs) |
| MINOR | `AUTO_SAFE` if adapter contract unchanged |
| MAJOR | `REVIEW_REQUIRED` or `MANUAL` |

## What AUTO_SAFE includes

- Optional adapter fields
- Version compatibility metadata
- Non-breaking capability metadata

## What AUTO_SAFE never includes

- Architecture, contracts, ADRs
- Business logic or application source
- Database migrations
- Production configuration
- Policy weakening or permission escalation

## Release workflow (maintainers)

```text
change → tests → version bump → validate-release → tag → GitHub release
```

```powershell
npm run secret-scan
npm run test:distribution
npm run validate-release
```

Release validation does **not** create tags or push to GitHub automatically.
