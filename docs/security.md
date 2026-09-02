# Security Model

## Effective security

```text
Global baseline + Project restrictions (additive)
```

Projects may be **stricter**. Projects **cannot** silently disable:

- Fail-closed on unknown tools
- Tier 3 approval gates
- Protected Agent OS paths
- Anti-self-modification (ephemeral agents)
- Cross-task approval isolation

## Global protected paths

- `.cursor/agents/`, `.cursor/hooks/`, `.cursor/policy/`, `.cursor/skills/`
- `.cursor/agents/registry.yaml`, `.cursor/hooks.json`
- `docs/agents/RUNTIME_LAW.md`

## Tier 3

Requires task-bound approval: `approval.status: approved` with exact operation in `approval.scope`.

## Ephemeral safety

- Default max tier 2
- Cannot modify registry, hooks, policy, own spec
- Cannot self-escalate permissions
