# Versioning

## Agent OS version

Current: **2.0.0-rc.3**, a prerelease (canonical source: `package.json`; synchronized with `policy/rules.json`).

Semantic versioning: `major.minor.patch-prerelease+build`. Stable outranks prerelease for the same core; build metadata does not affect precedence.

## Project compatibility

```yaml
agent_os:
  version: ">=2.0 <3.0"
```

## Update model

```text
Global OS update → all projects receive generic improvements
Project adapters unchanged unless migration required
```

## Detection

- `adapter outdated` — manifest schema_version mismatch
- `version incompatible` — project requires newer major version
- `migration required` — proposed via bootstrap, not silently applied
