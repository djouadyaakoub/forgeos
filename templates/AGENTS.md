# AGENTS.md — Project Entry Point

> This file describes **this project** for human and agent readers.
> Universal Agent OS behavior is provided by the global plugin; project specifics live here.

## Project summary

<!-- One paragraph: what this project does -->

## Architecture

<!-- High-level diagram or description -->

## Package map

| Path | Purpose |
|------|---------|
| | |

## Invariants

<!-- Non-negotiable rules agents must respect -->

## Source of truth hierarchy

```text
code / config
  → contracts
  → architecture / ADR
  → AGENTS.md
  → chat (never authoritative)
```

## Verification gates

<!-- Commands agents must run before claiming done -->

## Agent OS

- Manifest: `.agent-os/project.yaml`
- Tasks: `docs/project/tasks/`
- Project specialists: `.cursor/agents/`
