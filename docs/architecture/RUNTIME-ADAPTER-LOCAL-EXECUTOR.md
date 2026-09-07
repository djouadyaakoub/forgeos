# Runtime Adapter — Local Executor

Architecture 2.0 Stage 5 — first concrete Runtime Backend.

## Why selected

| Candidate | Availability (this environment) | Decision |
|-----------|----------------------------------|----------|
| Cline | CLI not found | Deferred |
| OpenHands | CLI not found | Deferred |
| Codex | CLI not found | Deferred |
| Claude | CLI not found | Deferred |
| **Local Executor** | Node.js + filesystem available | **Selected** |

Local Executor is a **realistic reference backend**: it performs real bounded filesystem writes and real process verification. It does **not** pretend to be Cline/OpenHands/Codex/Claude.

## Identity

```text
id: local-executor
name: ForgeOS Local Executor
version: 1.0.0
module: runtime/adapters/local-executor.mjs
```

## Prerequisites

- Node.js ≥ 18
- Writable project directory for allowed paths
- No external API keys

## Interface mapping

Implements Stage 3 `RuntimeBackend`:

| Method | Behavior |
|--------|----------|
| `health()` | healthy / injectable unhealthy |
| `canHandle()` | autonomous FS/process; rejects interactive |
| `start(runRequest)` | path-checked writes + verification commands |
| `cancel()` | sync — safely unsupported in-flight |
| `collectEvidence()` | normalized runtime-native evidence |

## Capabilities

```text
interactive: false
autonomous: true
sandbox: false
parallel: false
languages: javascript, typescript, shell, text
```

## Operations

Via `runRequest.execution_constraints`:

- `write_file` / `write_files`
- `run_commands`
- `noop`

## Isolation model

1. Paths must stay inside `project_dir`
2. `allowed_paths` must match (when non-empty)
3. `forbidden_paths` denied
4. Hard-forbidden always: `.cursor/**`, `.agent-os/**`, `policy/**`, `docs/agents/**`

ForgeOS Policy Authority remains authoritative; hard-forbidden is defense in depth.

## Evidence mapping

Returns `runtime_native_evidence` with changed files, commands, verification exit codes.

Does not store LLM transcripts (none exist).

## Cancellation

Safely unsupported for in-flight sync work. Cross-task cancel rejected via `TASK_MISMATCH`.

## Known security limitations

- Not a full OS sandbox (no container/VM)
- Shell verification uses `shell: true` — only trusted ForgeOS-supplied commands should be passed
- Does not replace host Policy hooks for Cursor IDE tool calls

## Registration

Opt-in only:

```js
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';

const registry = createRuntimeRegistry();
registry.register(createLocalExecutorBackend());
```

Default Runtime Registry remains empty until a caller registers a backend.
