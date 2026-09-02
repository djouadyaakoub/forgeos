---
name: agent-status
description: Show persisted Agent OS task status from docs/project/tasks/. Use when checking task progress, blockers, approvals, or verification for a task ID.
disable-model-invocation: true
---

# Agent status

Read-only task status report. Do not modify source code or run production operations.

## Input

Task ID after `/agent-status`, or ask for latest active task.

Task ID format comes from project manifest (`project.task_id_prefix`, default `TASK-YYYYMMDD-NNN`).

## Steps

1. Load `.agent-os/project.yaml` for task path if present.
2. Locate task under `docs/project/tasks/{active|completed|archived}/`.
3. Read `task.yaml` and latest handoff/result files.
4. Report: Task ID, Title, Status, Bucket, Agents, Blockers, Approval, Verification, Resume hint.
5. Use persisted YAML only — not chat memory.
