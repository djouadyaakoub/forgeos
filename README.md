# ForgeOS 2.0.0-rc.1 — prerelease

Tier-3 approvals now require exact task/operation/workspace/scope/input binding
and durable one-use consumption for supported Local Executor direct Git push
dispatch. `forgeos approve` previews and explicitly confirms the intent; it does
not execute it. Unsupported intercepted high-risk paths deny. Interactive host
handoffs are declarations, not universal Codex/Cursor/Claude sandboxing.
See [the exact-approval contract](docs/architecture/POLICY-AUTHORITY.md).

### Release-candidate source workflow

`node scripts/release/rc-source-manifest.mjs` derives the candidate source decisions without staging files.
`npm run build-release` packages only distribution-approved files. `npm run validate-release` rebuilds and tests a fresh extracted consumer, including the optional parser installed from the lockfile with lifecycle scripts disabled.
After building, `npm run validate:rc-source` copies only INCLUDE files into a temporary directory, installs locked dependencies, runs core/governance/product suites and compares the resulting ZIP hash with the checkout build. It does not copy maintainer state or publish anything.
Historical reports and legacy artifacts remain for human review; generated archives/checksums and local project evidence are excluded from the proposed source commit. The generated source manifest is the inclusion reference, not permission to stage or publish.

CLI errors retain their original reasons and expose `diagnostic_code` for invalid projects, unsupported hosts, scope/Policy denial, stale tasks, failed verification, ambiguous/no next action, knowledge review and malformed local state.

**ForgeOS** is a Universal Development Intelligence Platform.

Current maturity: Architecture 2.0 Release Candidate 1, a prerelease, not stable 2.0.0 or production certification. ForgeOS owns Project Intelligence, Policy, scope, orchestration and verification; Codex, Cursor and Claude Code are peer interactive HOST_NATIVE adapters, not autonomous processes launched by ForgeOS. OpenHands remains optional, not a prerequisite for Core. Context-byte diagnostics do not guarantee token savings.

It provides orchestration, agents, project knowledge, research, architecture, QA, security, deployment, release management, learning, and project-aware automation.

**Editor/host integrations are adapters.** Cursor is one supported adapter.

## Architecture

```text
ForgeOS Core
       ↑
Host Adapter (Cursor / CLI / Generic / future IDEs)
       ↑
Editor or Host Environment
```

See [docs/architecture/EDITOR-NEUTRALITY.md](docs/architecture/EDITOR-NEUTRALITY.md).

## Quick start

### Interactive product workflow (Codex, Cursor or Claude Code)

Run from this checkout or the extracted package; global installation is optional. The package maps `forgeos` to the same Node entrypoint:

```powershell
node cli/forgeos.mjs init --project C:\path\to\project --host codex
node cli/forgeos.mjs init --project C:\path\to\project --host codex --apply
node cli/forgeos.mjs host doctor --project C:\path\to\project --host codex
node cli/forgeos.mjs status --project C:\path\to\project --host codex
node cli/forgeos.mjs next --project C:\path\to\project --host codex
node cli/forgeos.mjs next --project C:\path\to\project --host codex --capability documentation-sync --path docs/STACK.md --prepare
# Perform the scoped action interactively; ForgeOS does not launch the host.
node cli/forgeos.mjs complete --project C:\path\to\project --host codex --task PRINTED-TASK-ID --changed docs/STACK.md --learning "Compact evidence-backed observation"
node cli/forgeos.mjs knowledge list --project C:\path\to\project
node cli/forgeos.mjs --help
```

Use the actual task ID and changed path printed for your project. `next` reports ambiguity instead of choosing among unrelated findings. `--path` can narrow a prepared task to an allowed file. Missing host instructions can be previewed with `cli/host.mjs prepare` and applied explicitly with `--apply`. Existing handoffs are preserved; stale ones require the existing `cli/task.mjs --regenerate` path after reviewing current scope.

Status/assessment are read-only. Preparation never executes; completion requests ForgeOS verification and records evidence, not unconditional success. Verification may be limited to file presence. Capability satisfaction is separate from knowledge acceptance. Candidate knowledge is project-local, unreviewed, freshness-aware and never a fact or Policy instruction. Accept only by an explicitly authorized human operator using `knowledge accept --id ... --reviewer ... --confirm-human --note ...`; this local assertion is not authenticated human identity. Agents may explicitly reject with `--agent-rejection`, never accept.

`knowledge recall` retrieves bounded current accepted interpretations. `discovery add --file <project-relative-json>` and `discovery assess` handle inert metadata only: eligibility never installs/registers/executes anything. `--json` is available throughout. Legacy inspect/plan/run/task/host CLIs remain supported.

Project-local state may contain task metadata, verification receipts, assessments and knowledge candidates. The consumer archive never bundles the maintainer's development-project state. Review `templates/project.gitignore` for optional local-state exclusions; you are not required to commit knowledge or task history. Project policy/manifest files remain your own deliberate version-control choice.

Analytical/architectural and release capabilities without an adequate composite acceptance contract remain PARTIAL/UNKNOWN. A marker file or successful runtime is not proof of their objective. Health/smoke command evidence proves only the configured checks. ForgeOS is not a universal semantic verifier, host sandbox or authenticated knowledge-review service.

For bounded read-only context, use `inspect --path README.md`. MINIMAL avoids full assessment; SCOPED reads selected evidence plus bounded accepted knowledge; FULL includes assessment. `--workflow full` requests stronger preparation, while risk/protected paths cannot be downgraded. This context path never authorizes an edit. Prepared write tasks retain the existing scope/Policy/approval pipeline.

New product documentation tasks use finding-resolution checks against fresh documentation assessment, not merely AGENTS presence. A scoped task may pass while other documentation findings keep the capability PARTIAL. Checks detect missing/empty documents and known stack drift; they do not prove arbitrary prose correctness.

`benchmark context --evidence README.md --evidence src/example.js --json` compares measured context bytes with an explicitly controlled full-supplied-file baseline. It does not observe vendor token billing: `REAL_TOKEN_USAGE_UNAVAILABLE`. Tiny tasks can incur overhead. Accepted knowledge adds bounded interpretation context, not authority or a guaranteed cost saving.

```bash
npm test
npm run test:neutrality
```

### Install (Cursor adapter)

```powershell
node bootstrap/install-from-release.mjs --source .
node bootstrap/integrate-runtime.mjs --project-dir "C:\path\to\your-project"
```

## Cursor Adapter

The Cursor integration lives under `adapters/cursor/`. The Cursor marketplace plugin ID remains `cursor-agent-os` for compatibility; the product identity is **ForgeOS**.

## Project adapter

Projects use `.agent-os/project.yaml` (path unchanged for compatibility):

```yaml
forgeos:
  version: ">=1.0 <2.0"
  adapter_schema_version: 1
```

Legacy `agent_os:` blocks are supported. Migrate with:

```powershell
node bootstrap/migrate-to-forgeos.mjs --project-dir <path> --apply
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FORGEOS_ROOT` | ForgeOS installation root |
| `FORGEOS_DEV_ROOT` | Development checkout |
| `CURSOR_PROJECT_DIR` | Cursor IDE workspace (Cursor-provided) |

Legacy: `AGENT_OS_PLUGIN_ROOT`, `CURSOR_AGENT_OS_PLUGIN_ROOT` (still supported).

## Version

**2.0.0-rc.1** — Architecture 2.0 prerelease; canonical source: `package.json`. Stable 2.0.0 is not released. Check GitHub Releases for publication and validated product assets; an automatic GitHub source archive is not the ForgeOS product ZIP.

## Historical note

`cursor-agent-os` is the historical predecessor name of ForgeOS. Phase 1–17 reports retain the old name as historical documentation.

## License

MIT
