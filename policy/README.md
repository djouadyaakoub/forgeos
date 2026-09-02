# Policy Engine

Universal Agent OS policy layer. Stdlib-only Node ESM.

## Components

| File | Role |
|------|------|
| `engine.mjs` | Pre-tool, shell, MCP evaluation |
| `project-adapter.mjs` | Load `.agent-os/project.yaml`, merge with global rules |
| `rules.json` | Global security baseline |
| `ephemeral-factory.mjs` | Ephemeral agent lifecycle |
| `learning-factory.mjs` | Learning proposals pipeline |

## Health check

```bash
node policy/tests/run-all.mjs
```

## Effective policy

```text
Global baseline ∩ Project adapter ∩ Agent permissions ∩ Task approval
```

Projects may add Tier 3 operations and protected paths. Projects cannot remove global protected paths or disable fail-closed behavior.
