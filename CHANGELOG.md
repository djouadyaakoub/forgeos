# Changelog

All notable changes to Universal Cursor Agent OS follow [Semantic Versioning](https://semver.org/).

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
