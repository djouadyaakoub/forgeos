# Universal Cursor Agent OS — Architecture

## Overview

```text
USER
  ↓
GLOBAL ORCHESTRATOR (plugin)
  ↓
PROJECT DISCOVERY
  ↓
PROJECT ADAPTER (.agent-os/project.yaml)
  ↓
CAPABILITY REGISTRY (global + project)
  ↓
EXISTING SPECIALIST  OR  CAPABILITY GAP → EPHEMERAL AGENT
  ↓
TASK / HANDOFF
  ↓
POLICY (global ∩ project)
  ↓
VERIFICATION
  ↓
LEARNING (proposals → project knowledge)
```

## Layers

| Layer | Location | Scope |
|-------|----------|-------|
| Global Agent OS | Cursor plugin (user scope) | Generic orchestration, policy baseline, global specialists |
| Project Adapter | `.agent-os/project.yaml` | Stack, paths, project capabilities, Tier 3 extensions |
| Project Knowledge | `AGENTS.md`, `docs/` | Business rules, architecture, lessons |

## Installation model

Install plugin once at user scope. Each project carries its own adapter and knowledge. Bootstrap skill initializes uninitialized projects non-destructively.

## Key invariants

1. Projects cannot weaken global security baseline.
2. Task state is Git-backed in the project repo.
3. Ephemeral agents use flat `.cursor/agents/<id>.md` path.
4. Learning proposals never auto-modify protected targets.
