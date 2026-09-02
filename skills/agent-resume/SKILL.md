---
name: agent-resume
description: Resume an interrupted Agent OS task as orchestrator from Git-backed task state. Use with /agent-resume and a task ID.
disable-model-invocation: true
---

# Agent resume

Resume orchestration from durable task state.

## Steps

1. Load task from `docs/project/tasks/active/<task_id>/task.yaml`.
2. Read status, current_agent, latest handoff + result.
3. Re-run preflight — validate assumptions against repo (code/config > contracts > docs).
4. Continue from latest verified state; do not redo completed handoffs.
5. Operate as orchestrator per [orchestrator.md](../../agents/orchestrator.md).

## Rules

- `in_progress` ≠ done — use evidence
- Tier 3 still requires task-bound approval
- Project adapter overrides paths and capabilities
