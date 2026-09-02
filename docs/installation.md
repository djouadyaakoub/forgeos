# Installation

Universal Cursor Agent OS installs **once at user scope**. Each project only needs `.agent-os/project.yaml` plus its own knowledge.

## 1. Install Cursor

Install [Cursor](https://cursor.com) on your machine.

## 2. Install Universal Agent OS

### From a versioned release (recommended)

```powershell
node bootstrap/install-from-release.mjs --source "C:\path\to\ForgeOS"
```

Dry run (integrity check only):

```powershell
node bootstrap/install-from-release.mjs --source "C:\path\to\ForgeOS" --dry-run
```

### Legacy install

```powershell
node bootstrap/install-plugin.mjs --plugin-root "C:\path\to\ForgeOS"
```

Writes `%USERPROFILE%\.cursor\agent-os\install.json` with plugin root and version.

## 3. Register / open a project

```powershell
node -e "import('./intelligence/registry/projects.mjs').then(m => m.registerProject('C:/path/to/your-project'))"
```

## 4. Integrate runtime into a project

```powershell
node bootstrap/integrate-runtime.mjs --project-dir "C:\path\to\your-project"
```

Creates:

- `.cursor/hooks.json` — portable paths (`node .cursor/hooks/agent-os/...`)
- `.cursor/hooks/agent-os/*.mjs` — shims that resolve user-scoped plugin
- `.agent-os/runtime.yaml` — `UNIVERSAL_RUNTIME` (no absolute dev path)

Rollback:

```powershell
node bootstrap/integrate-runtime.mjs --rollback --project-dir "C:\path\to\your-project"
```

## 5. Bootstrap project adapter

```powershell
node bootstrap/initialize.mjs --dry-run --project-dir "C:\path\to\your-project"
node bootstrap/initialize.mjs --apply-adapter --project-dir "C:\path\to\your-project"
```

## 6. Validate runtime

```powershell
cd ForgeOS
npm run test:plugin
npm run test:runtime
npm test
```

## Plugin root resolution order

1. `CURSOR_AGENT_OS_PLUGIN_ROOT`
2. `AGENT_OS_PLUGIN_ROOT` (legacy)
3. `%USERPROFILE%\.cursor\agent-os\install.json`
4. Cursor plugin cache scan
5. `AGENT_OS_DEV_ROOT` (development)
6. Development checkout fallback

Projects **must not** hard-code machine-specific paths in `hooks.json`.

## Per-project requirements

```text
Global Plugin  +  .agent-os/project.yaml  +  Project Knowledge
```

No copy of Universal OS inside the project.
