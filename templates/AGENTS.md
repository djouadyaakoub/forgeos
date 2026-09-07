# AGENTS.md — Project Entry Point

> This file describes **this project** for human and agent readers.
> ForgeOS governance remains authoritative; project-specific contributor guidance lives here.

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

## ForgeOS contributor boundaries

- Manifest: `.agent-os/project.yaml`
- Tasks: `docs/project/tasks/`
- Capability != Agent. Do not create permanent specialist agents for host integration.
- Work in this project/workspace; do not launch another coding host.
- Policy DENY remains binding. Host completion is not ForgeOS verification PASS.
- Canvas is derived from verified evidence, not an approval source.
- Preserve existing dirty work. Do not commit, tag, push or release without explicit authorization.
- Codex and Cursor use this file; a Claude Code facade may import it using @AGENTS.md.
