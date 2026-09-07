# Host-Native Intelligence — Architecture 2.0 Stages 12, 17, 23 and 24

ForgeOS is a host-independent control plane. Codex, Cursor and Claude Code are first-class HOST_NATIVE product hosts. Codex currently develops ForgeOS itself, without acquiring Core, Policy or verification authority.

## Target and currently implemented architecture

Stage 30 exact-approval metadata is shared by Codex, Cursor and Claude Code:
host programmatic and hooked exact dispatch are `UNSUPPORTED`; pure interactive
handoff is `DECLARED_ONLY`. Recognized intercepted Tier-3 requests are blocked.
Only the supported Local Executor direct push path consumes exact approval at
ForgeOS-controlled dispatch. No vendor host is claimed universally sandboxed;
manual actions and unintegrated tools cannot be intercepted by a handoff.
See [Policy Authority](POLICY-AUTHORITY.md) for input, replay and retry boundaries.

```text
Project Intelligence → Assessment → Capability Planning → Task Candidates
  → Approval / ForgeOS Policy Authority → Capability Resolver (selection only)
       ├── HOST_NATIVE → Host Platform → Codex | Cursor | Claude Code
       │                                 └── SAME existing workspace, interactive
       ├── FORGEOS_NATIVE → ForgeOS modules
       ├── OSS_DERIVED → provenance/methodology, NOT an external launcher
       └── OPTIONAL_RUNTIME → Runtime Router → opt-in backend
  → ForgeOS Verification → Governance Evidence → Rescan → derived Canvas
```

Local Executor is the programmatic reference backend, not a product host. OpenHands remains OPTIONAL_RUNTIME, not a prerequisite for Core or host-native work. The legacy oss_backed token is an alias, not another architecture.

## Canonical identities and separate inventories

`host/catalog.mjs` owns product IDs, names and instruction entrypoints. `host/adapter.mjs` re-exports its IDs and validates the contract. `host/discovery.mjs` statically registers the three adapter factories; it does not dynamically import user input.

`runtime/host-registry.mjs` is bootstrap/installation metadata, not a RuntimeBackend registry. Its product identity entries derive from the catalog. Historical Cursor hook/install metadata is retained separately from new project-instruction preparation. cli/generic remain legacy assessment/bootstrap contexts, never first-class product hosts. Backend registration stays in `runtime/registry.mjs`.

## Host Capability Contract

Shared behavior: `host/interactive.mjs`; thin facades: `host/adapters/{codex,cursor,claude-code}/`.

The adapter surface retains identity/version, capability classes, health, canHandle, prepare, start, cancel and collectEvidence. READ, ANALYZE, PLAN, EDIT, REFACTOR, TEST and DOCUMENTATION describe handoff task classes, not installed vendor tool access.

All three declare HOST_NATIVE, existing_project, same_workspace=true, interactive_execution=true, programmatic_execution=false, launches_external_runtime=false and requires_docker=false. start() returns HOST_INTERACTIVE_REQUIRED, never starts an agent loop. health() reports unknown live availability. Descriptor validation rejects contradictory claims.

Stage 24 adds configuration/preparation/diagnostic modules around this contract rather than expanding it into a vendor-feature catalog.

## Selection and project preference

Selection order:

1. Explicit CLI --host / API host_id.
2. Project host.preferred.
3. Operator API active_host_id / FORGEOS_ACTIVE_HOST declaration.
4. Legacy Cursor handoff fallback; existing assessment/bootstrap callers retain cli/generic fallback semantics.

An operator declaration or fallback is not live detection. Ambient vendor variables/directories do not determine the active host. Invalid project host configuration fails closed, even with an explicit override.

Preference lives in the EXISTING `.agent-os/project.yaml`, with existing `.agent-os/project.json` fallback when YAML is absent:

```yaml
host:
  preferred: codex
```

`host/configuration.mjs` intentionally parses only this strict unquoted YAML block: one top-level host entry and one two-space-indented preferred value. Unsupported/ambiguous block syntax is rejected, not repaired. This is not a new full YAML parser. YAML updates preserve unrelated text; JSON updates preserve unrelated data but reformat whitespace. No global settings are read or written. Missing preference is a valid unconfigured state.

## Diagnostics

`host/doctor.mjs` distinguishes supported, configured, selected, caller-hinted detection and operator-declared active state. installed=null, live_verified=false and unknown health are truthful defaults. Adapter existence is not installation proof.

handoff_ready means project metadata/instruction/descriptor prerequisites only; it does not approve a task or establish a live vendor session. The diagnostic can run successfully (ok=true) while readiness is false; inspect readiness and warnings. Overrides/custom instruction conflicts are reported. No host process, network probe or Docker check is launched.

## Single-source instructions and preparation

Root AGENTS.md is ForgeOS's canonical concise contributor guidance. Codex and Cursor consume it directly. Root CLAUDE.md contains only `@AGENTS.md`; it is a vendor import facade, not a second architecture or permanent agent. `templates/AGENTS.md` is a new-project scaffold, not a second live ForgeOS contributor guide.

Vendor documentation checked for this design:

- [Codex AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md): project instructions and possible overrides.
- [Cursor rules](https://cursor.com/docs/rules): AGENTS.md support.
- [Claude Code memory](https://code.claude.com/docs/en/memory): CLAUDE.md and explicit AGENTS.md import.

`host/preparation.mjs` previews by default; --apply creates only missing project-local manifest/instructions. Existing guidance and metadata are preserved. Claude preparation creates the thin facade only if absent and rejects conflicting existing content. Repeated preparation is idempotent. Existing manifest preferences are changed only by explicit config set, not by prepare --host.

`bootstrap/initialize.mjs --prepare-host` delegates to this path before legacy bootstrap actions. The older full Cursor-oriented bootstrap still serves its separate installation purpose; it is not silently run for Codex/Claude preparation. Preparation never installs a vendor or launches another workspace.

## Interactive handoff hardening

`intelligence/orchestrator/host-handoff.mjs` creates `docs/project/tasks/<task-id>.handoff.json`. Handoffs bind task/capability, canonical workspace, selected host, scope, Policy context, operation, expected effects, evidence requirements and verification strategy.

Integrity hashes detect accidental tampering, not a malicious writer capable of recomputing them. Cross-task/workspace replay and host mismatch fail. A host_context_fingerprint covers the project manifest text and capability bindings. Changes invalidate cached display/completion; ordinary target edits do not invalidate the handoff merely by occurring. This is context freshness, not a wall-clock expiry or fresh Policy authorization.

--regenerate is explicit. Integrity and task/workspace checks remain required. Host switching can regenerate a valid record. Stale governance context requires a current assessment candidate; old scope cannot simply be reconstructed and blessed. Legacy missing-workspace records also require a current candidate, never automatic promotion. Malformed persisted data is not treated as an absent file.

`host/project-files.mjs` bounds metadata, instruction, handoff and verification-presence paths. Traversal, absolute/device/ambiguous Windows names, and existing symlinks/junctions are rejected. These checks are not an OS sandbox or a defense against hostile concurrent filesystem changes/hard links.

## Policy, verification and Canvas boundaries

Policy Authority remains the sole ALLOW/DENY source. Cached or supplied DENY blocks creation/regeneration/completion. An absent decision is advisory, not authorization. Host instructions cannot approve work or broaden scope. Interactive adapters do not automatically intercept every vendor tool operation.

Resolver chooses implementation and does not execute it. Availability is distinct from executability: host_native can be available=true, executable=false, invocation=interactive.

Completion requests run ForgeOS capability verification against current state, create ForgeOS governance evidence and optionally rescan. Repeated completion rechecks rather than reusing a previous PASS. Handoff creation is not runtime start; host “done” is not verification PASS; bounded PASS is not automatically capability SATISFIED. Canvas remains derived and may stay PARTIAL when broader project evidence is insufficient/stale.

## Actual CLI entrypoints

```text
node cli/host.mjs list --json
node cli/host.mjs doctor --project <dir> --host codex --json
node cli/host.mjs config get --project <dir> --json
node cli/host.mjs config set codex --project <dir>          # preview
node cli/host.mjs config set codex --project <dir> --apply
node cli/host.mjs prepare --project <dir> --host claude-code # preview
node cli/host.mjs prepare --project <dir> --host claude-code --apply
node bootstrap/initialize.mjs --prepare-host --project-dir <dir> --host codex --apply
node cli/task.mjs <task_id> --project <dir> --host codex
node cli/task.mjs <task_id> --project <dir> --host cursor --regenerate
node cli/task.mjs complete <task_id> --project <dir>
node cli/plan.mjs "<request>" --host codex
node cli/run.mjs --execute --approve-task <id> # Local Executor, NOT host launch
```

Use --no-persist for task/verification preview without artifact writes. Host CLI writes require --apply. Unknown IDs, unsupported legacy execution contexts, invalid config, workspace mismatch, Policy DENY and verification FAIL remain distinct outcomes. Task CLI exits 1 for invalid requests and 2 for failed verification. --yes/--force are not approval shortcuts.

## Intentionally unsupported and future possibilities

Currently unsupported: programmatic Codex/Cursor/Claude launch, live-session attestation, vendor installation, automatic enforcement of every interactive action, arbitrary external workspace handoff. No adapter claims integrated skills/hooks/MCP/resume/structured-output/vendor approval APIs.

Future vendor-specific enhancements require explicit authorization, verified contracts and regression evidence. Host products may provide features not integrated by ForgeOS; omission here is not a claim about vendor feature absence. No such enhancement is required for the implemented interactive path.

See also: [Governed execution](GOVERNED-EXECUTION-LOOP.md), [Verification](VERIFICATION-AND-EVIDENCE.md), [Policy](POLICY-AUTHORITY.md), [Runtime Router](RUNTIME-ROUTER.md).
