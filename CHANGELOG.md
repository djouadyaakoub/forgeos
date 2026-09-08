# Changelog

All notable changes to ForgeOS follow [Semantic Versioning](https://semver.org/).

## [2.0.0-rc.4] - 2026-09-08

- Correct extracted-package dependency locality validation across physical/canonical path aliases, including macOS temporary-directory aliases.
- Enforce physical containment inside the extracted package dependency tree; reject sibling-prefix traps, external dependency resolution, symlink escapes and failed realpath operations.
- Add bounded locality diagnostics and focused cross-platform regressions. No new feature; this remains a prerelease, not stable 2.0.0.

## [2.0.0-rc.3] - 2026-09-08

- Correct checksum-validator subprocess module mode for Node 18; missing/malformed artifacts fail closed with useful diagnostics.
- Recognize CLI entrypoints through realpath/symlink/junction aliases and filesystem case variants without global path lowercasing or automatic execution on library import.
- Validate non-empty JSON and subprocess errors in extracted consumer E2E, including direct-versus-alias host CLI output parity.
- Release-blocker corrections only; no new product feature. This remains a prerelease, not stable 2.0.0. Existing RC limitations and optional-runtime boundaries are unchanged.

## [2.0.0-rc.2] - 2026-09-08

- Replace external maintainer-project adapter checks with mandatory repository-owned fixture checks, preserving extraction and dry-run assertions.
- Stop CI immediately on any failed core command on all platforms; run INCLUDE-only clean-source reproduction across the full OS/Node matrix.
- Retain the Architecture 2.0 features and RC limitations below. RC1's public source tag is preserved; no RC1 GitHub Release was published after its CI failure.
- This is a prerelease, not stable 2.0.0. Exact approval covers only the supported dispatch subset; interactive host actions are not universally intercepted. OpenHands remains optional and context metrics do not guarantee token savings.

## [2.0.0-rc.1] - 2026-09-07

- Host-independent Project Intelligence, Policy, task scope, orchestration and derived evidence/Canvas.
- Codex, Cursor and Claude Code are peer interactive HOST_NATIVE adapters in the existing workspace; no vendor agent launcher is implied.
- Unified init/status/next/complete, knowledge review/recall, inert discovery, host and context benchmark CLI; Node bin mapping.
- Documentation completion rechecks scoped findings; capabilities without sufficient acceptance contracts remain UNKNOWN/PARTIAL rather than accepting arbitrary markers.
- MINIMAL/SCOPED read-only context and conservative FULL preparation. Context-byte metrics are not guaranteed token savings; vendor token telemetry is unavailable.
- Deterministic RC source inclusion, isolated test fixtures and extracted-package validation. Maintainer project state is excluded from consumer distribution.
- Exact Tier-3 approval binds normalized input, task, capability, operation, workspace and current scope; supported Local Executor push dispatch consumes approval once before effect. Replay and changed inputs reject.
- Reviewed knowledge lifecycle and inert capability-discovery metadata stay below deterministic facts and never grant authority.
- Full SemVer prerelease ordering supports RC progression and stable promotion while blocking normal downgrades.
- RC limitations: unsupported recognized high-risk dispatch paths fail closed; arbitrary interactive host actions are not universally intercepted. Approval is not execution success or verification PASS. OpenHands is optional; no mandatory Docker or live-runtime certification is implied.
- Existing projects with a 1.x-only compatibility range require explicit major-version review; new project templates target the 2.x line. This is not stable 2.0.0.

## [1.0.1] - 2026-09-03

### Fixed
- Release ZIP now includes `templates/` (required `templates/runtime/hook-shim.mjs` for `integrate-runtime`)
- Installer integrity requires the runtime hook shim (`bootstrap/install-from-release.mjs`)
- Project YAML empty-list round-trip: list fields serialize/parse as arrays (`[]`), not `{}` or `"[]"`
- Manifest load normalizes known list-valued Project Intelligence Contract fields
- `discoverCapabilities` fail-closed if capabilities is not an array
- Release validation now builds the artifact and runs an extracted-release consumer E2E (install → bootstrap → integrate → policy → orchestrator)

### Security
- No policy weakening; single ForgeOS policy authority unchanged

## [1.0.0] - 2026-09-02

### Added
- Universal Agent OS distribution lifecycle (install, update discovery, compatibility, migration planning)
- GitHub-oriented release manifest and release validation gate
- Secret scan script for pre-release hygiene
- Installed projects registry (`~/.cursor/agent-os/projects.yaml`)
- Update manager (`intelligence/update/`) with discovery, planning, migration, rollback, status
- Install from release bootstrap path
- CI workflow for secret scan, tests, and packaging validation
- Documentation: installation, updates, Phase 16 release report

### Changed
- Canonical version sourced from `package.json` via `policy/version.mjs`
- Plugin install manifest uses canonical version
- Orchestrator blocks workflows when project adapter is `INCOMPATIBLE`

### Security
- Secret scan patterns for API keys, tokens, private keys, connection strings
- No secrets stored in repository or user registry
- Supply-chain validation metadata in release manifest
- Update manager cannot escalate permissions or weaken policy

### Migration
- Adapter schema migrations classified as `AUTO_SAFE`, `REVIEW_REQUIRED`, `MANUAL`, or `INCOMPATIBLE`
- Project migrations require explicit approval for `REVIEW_REQUIRED`
- Rollback support for project adapter and global install manifest

### Compatibility
- `min_adapter_schema_version: 1` for v1.x releases
- PATCH/MINOR updates default to `AUTO_SAFE` when adapter contract unchanged
- MAJOR updates require review before project migration

[1.0.0]: https://github.com/example/cursor-agent-os/releases/tag/v1.0.0
