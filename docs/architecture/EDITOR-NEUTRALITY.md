# Editor Neutrality

ForgeOS is **editor-neutral at the Core**. Cursor is an adapter, not the product identity.

## Architecture

```text
ForgeOS Core
├── Orchestrator, Planner, Policy, Intelligence
├── Agents, Knowledge, Learning, Release, Deployment
└── Runtime Interface (host-neutral)

Host Adapters
├── adapters/cursor/     — Cursor IDE integration
├── adapters/cli/        — CLI boundary (conceptual)
└── future: VS Code, JetBrains, ...

Project Adapter
└── .agent-os/project.yaml (project-scoped, host-neutral)
```

## Dependency rules

```text
Core → generic interfaces only
Adapters → may depend on Core
Core ✕ must NOT depend on Cursor Adapter
```

Enforced by `tests/architecture/editor-neutral.test.mjs` and `scripts/validate-branding.mjs`.

## Runtime event flow

```text
Host payload (Cursor hook, CLI command, etc.)
  ↓
Host Adapter normalizes
  ↓
ForgeOS Runtime Event (schemas/runtime-event.yaml)
  ↓
Policy Engine → ALLOW / BLOCK
  ↓
Orchestrator / Specialists
```

## Host adapter contract

Defined in `schemas/host-adapter.yaml`. Each host declares capabilities:

- `agents`, `hooks`, `tasks`, `terminal`, `workspace`, `approval_ui`

Not all hosts provide all capabilities.

## Cursor-specific items (adapter boundary)

| Item | Location |
|------|----------|
| Plugin manifest `name: cursor-agent-os` | `.cursor-plugin/plugin.json` |
| Hook shims | `.cursor/hooks/agent-os/` or `forge-os/` |
| `CURSOR_PROJECT_DIR` | Read from Cursor IDE |
| Cursor hook payload normalization | `adapters/cursor/integration.mjs` |

## Core identifiers

| Identifier | Value |
|------------|-------|
| Product | ForgeOS |
| Package | `forgeos` |
| Policy authority | `forgeos` |
| Env var | `FORGEOS_ROOT` |

## Legacy compatibility

| Legacy | ForgeOS |
|--------|---------|
| `agent_os:` in project.yaml | `forgeos:` (both supported) |
| `AGENT_OS_PLUGIN_ROOT` | `FORGEOS_ROOT` |
| `cursor-agent-os` (product) | `forgeos` |
| `cursor-agent-os` (Cursor plugin ID) | unchanged in adapter |

## Generic host proof

`tests/fixtures/generic-host/` demonstrates Core orchestration without Cursor.
