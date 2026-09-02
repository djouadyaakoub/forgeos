# Bootstrap

## Modes

| Mode | Behavior |
|------|----------|
| `--dry-run` | Inspect and plan only; no writes |
| default | Create missing adapter artifacts only |

## Project kinds

| Kind | Meaning |
|------|---------|
| `UNINITIALIZED` | No meaningful project signals |
| `EXISTING_PROJECT` | Mature repo (AGENTS.md, docs, code) without `.agent-os/project.yaml` |
| `AGENT_OS_INITIALIZED` | `.agent-os/project.yaml` present |

`EXISTING_PROJECT` is not the same as Agent OS initialized. Bootstrap may still plan adapter creation.

## Stack detection

Stack is detected from **repository evidence**, not from installed executables (`go`, `flutter`, etc. in PATH).

Markers are searched recursively (skipping `node_modules`, `.git`, `vendor`, etc.):

| Technology | Evidence |
|------------|----------|
| Go | `go.mod`, `go.sum`, `.go` sources |
| Node | `package.json`, lockfiles |
| Flutter | `pubspec.yaml`, `.dart` sources |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py` |
| Rust | `Cargo.toml` |
| .NET | `.csproj`, `.sln` |
| Java | `pom.xml`, `build.gradle` |
| Docker | `Dockerfile`, `compose.yml`, `docker-compose.yml` |

Output includes:

```yaml
stack:
  repository: { go: true, node: true, ... }
  components:
    backend: { go: true }
    web: { node: true }
```

If `docs/STACK.md` exists but no markers are found, bootstrap reports `stack_detection_warning`.

## Adapter extraction (mature projects)

For existing projects with Agent OS artifacts, bootstrap **extracts** (read-only):

| Section | Sources |
|---------|---------|
| `capabilities` | `.cursor/agents/registry.yaml`, playbooks |
| `agents` | registry + `.cursor/agents/*.md` |
| `ownership` | registry path ownership |
| `policy.tier3_operations` | `.cursor/policy/rules.json` (project-specific only) |
| `policy.protected_paths` | registry forbidden paths, sensitive domains |
| `integrations.mcp` | `.cursor/mcp.json` (metadata only, secrets redacted) |
| `verification.commands` | registry, `package.json` scripts |
| `deployment` | `fly.toml`, `wrangler.toml`, `supabase/migrations/` |

Dry-run output includes `proposed_adapter` with extracted summary. Global baseline is never weakened.

## Flow

```text
inspect → profile → stack detect → doc detect → boundaries →
capabilities map → gaps → plan → (confirm) → write
```

## Non-destructive defaults

- Does not modify application source code
- Does not delete files
- Does not overwrite existing `.agent-os/project.yaml`
- Does not replace existing `AGENTS.md` without confirmation

## Fact priority (existing projects)

```text
code/config → contracts → architecture → AGENTS/rules → documentation
```

Contradictions are reported, not silently resolved.
