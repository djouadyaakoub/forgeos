---
name: initialize-agent-os
description: Non-destructively bootstrap Agent OS for an existing or new project. Inspects repo, builds project profile, creates .agent-os/project.yaml and knowledge skeleton.
disable-model-invocation: true
---

# Initialize Agent OS

Bootstrap project adapter without modifying application code.

## Preconditions

- Run from project repository root.
- Default mode is **non-destructive** — no overwrites without explicit confirmation.

## Workflow

```text
inspect project
  → build project profile
  → detect stack
  → detect architecture
  → detect existing docs
  → detect boundaries
  → detect MCP/tools
  → map capabilities
  → identify missing knowledge
  → produce initialization plan
  → write artifacts (with confirmation)
```

## Steps

1. Run `node <agent-os-plugin>/bootstrap/initialize.mjs --dry-run` to preview plan.
2. Present plan to user: detected stack, existing knowledge, proposed manifest, gaps.
3. On approval, run without `--dry-run`.
4. Created artifacts (minimal):
   - `.agent-os/project.yaml`
   - `docs/project/tasks/` skeleton (if missing)
   - `.cursor/agents/registry.yaml` stub (project capabilities only)
   - Optional `AGENTS.md` from template (only if missing)

## Existing project priority

Resolve facts in order:

```text
code/config → contracts → architecture → AGENTS/rules → documentation
```

Report contradictions — do not guess.

## New project

Create minimal manifest only. Do not invent stack or architecture before it exists.

## References

- [docs/bootstrap.md](../../docs/bootstrap.md)
- [templates/project.yaml](../../templates/project.yaml)
