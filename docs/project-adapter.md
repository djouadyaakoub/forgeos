# Project Adapter

## Manifest location

```text
.agent-os/project.yaml
```

JSON alternative: `.agent-os/project.json`

## Required fields (minimal)

```yaml
schema_version: 1
agent_os:
  version: ">=1.0 <2.0"
project:
  id: my-app
  name: My App
  task_id_prefix: MYAPP
```

## Optional sections

- `stack` — detected or declared technologies
- `paths` — backend, frontend, docs, tasks
- `knowledge` — pointers to docs (only what exists)
- `capabilities` — project-specific capability definitions
- `agents` — project specialist permissions
- `policy` — additive Tier 3 ops, shell/MCP rules, protected paths
- `integrations.mcp` — MCP server references
- `verification.commands` — project test/build commands

## Merge rules

```text
Effective policy = Global baseline ∩ Project restrictions (additive only for Tier 3)
Effective registry = Global capabilities + Project capabilities
Project routing overrides generic when path matches
```

## Version compatibility

Projects declare `agent_os.version`. Unsupported major versions are detected, not silently upgraded.
