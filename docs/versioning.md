# Versioning

## Agent OS version

Current: **1.0.0** (see `policy/rules.json` `agent_os_version`)

Semantic versioning: `major.minor.patch`

## Project compatibility

```yaml
agent_os:
  version: ">=1.0 <2.0"
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
