# ForgeOS

**ForgeOS** is a Universal Development Intelligence Platform.

It provides orchestration, agents, project knowledge, research, architecture, QA, security, deployment, release management, learning, and project-aware automation.

**Editor/host integrations are adapters.** Cursor is one supported adapter.

## Architecture

```text
ForgeOS Core
       ↑
Host Adapter (Cursor / CLI / Generic / future IDEs)
       ↑
Editor or Host Environment
```

See [docs/architecture/EDITOR-NEUTRALITY.md](docs/architecture/EDITOR-NEUTRALITY.md).

## Quick start

```bash
npm test
npm run test:neutrality
```

### Install (Cursor adapter)

```powershell
node bootstrap/install-from-release.mjs --source .
node bootstrap/integrate-runtime.mjs --project-dir "C:\path\to\your-project"
```

## Cursor Adapter

The Cursor integration lives under `adapters/cursor/`. The Cursor marketplace plugin ID remains `cursor-agent-os` for compatibility; the product identity is **ForgeOS**.

## Project adapter

Projects use `.agent-os/project.yaml` (path unchanged for compatibility):

```yaml
forgeos:
  version: ">=1.0 <2.0"
  adapter_schema_version: 1
```

Legacy `agent_os:` blocks are supported. Migrate with:

```powershell
node bootstrap/migrate-to-forgeos.mjs --project-dir <path> --apply
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FORGEOS_ROOT` | ForgeOS installation root |
| `FORGEOS_DEV_ROOT` | Development checkout |
| `CURSOR_PROJECT_DIR` | Cursor IDE workspace (Cursor-provided) |

Legacy: `AGENT_OS_PLUGIN_ROOT`, `CURSOR_AGENT_OS_PLUGIN_ROOT` (still supported).

## Version

**1.0.0** — canonical source: `package.json`

## Historical note

`cursor-agent-os` is the historical predecessor name of ForgeOS. Phase 1–17 reports retain the old name as historical documentation.

## License

MIT
