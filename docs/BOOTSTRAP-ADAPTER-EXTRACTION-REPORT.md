# Final Report — Bootstrap Project Adapter Extraction

## 1. Root cause

The original `buildManifest()` in `bootstrap/initialize.mjs` **hard-coded empty placeholders**:

```yaml
capabilities: []
policy:
  protected_paths: []
  tier3_operations: []
integrations:
  mcp: []
verification:
  commands: []
```

Bootstrap only performed **stack detection** and **documentation path mapping**. It never read:

- `.cursor/agents/registry.yaml`
- `.cursor/policy/rules.json`
- `.cursor/mcp.json`
- agent definitions, playbooks, or package scripts

Therefore a mature project like Speed Flexy produced a structurally valid but **information-empty** adapter.

---

## 2. Extraction design

| Section | Derivation |
|---------|------------|
| **capabilities** | Each entry in `registry.yaml` → `agents.*.capabilities`, with domains, paths, agent, verification, playbook |
| **agents** | `registry.yaml` agents merged with `.cursor/agents/*.md` existence |
| **ownership** | `paths_owned`, `paths_writable`, `paths_readable`, `paths_forbidden` per agent |
| **policy.protected_paths** | Project forbidden paths + sensitive domain contracts; **excludes** global `.cursor/*` infrastructure |
| **policy.tier3_operations** | `rules.json` + registry `tier_3_operations` **minus** global Universal OS baseline |
| **approval.scopes** | `tier_3_operations` + per-agent `approval_required` |
| **integrations.mcp** | `mcp.json` server ids, type, purpose (agent usage); env refs noted, no secret values |
| **verification.commands** | Registry verification arrays + `package.json` build/test scripts + go/flutter markers |
| **knowledge** | Existing doc paths (AGENTS.md, STACK, contracts, etc.) |
| **deployment** | `backend/fly.toml`, `*/wrangler.toml`, `supabase/migrations/` |

**Source priority:** policy/config → registry → agent files → playbooks → docs.

Contradictions (e.g. registry agent without `.md` file) are reported, not silently resolved.

---

## 3. Speed Flexy dry-run summary

```json
{
  "project_kind": "AGENT_OS_INITIALIZED",
  "adapter_summary": {
    "capability_count": 37,
    "agent_count": 13,
    "ownership_count": 13,
    "protected_path_count": 15,
    "tier3_operation_count": 6,
    "mcp_count": 9,
    "verification_command_count": 26,
    "deployment_providers": ["fly.io", "cloudflare-pages", "supabase"],
    "contradiction_count": 0
  },
  "proposed_adapter": {
    "capabilities": 37,
    "agents": ["orchestrator", "architect", "backend-api", "frontend-ui", "mobile", "data-db", "devops-release", "qa-bugfix", "docs-sync", "security", "safe-cleanup", "performance", "product-feature"],
    "tier3_operations": ["fly_deploy", "wrangler_deploy", "supabase_apply_migration_production", "destructive_sql_production", "ledger_manual_adjustment", "production_debug_with_data_write"],
    "mcp": ["dart", "supabase", "figma", "untitledui", "cloudflare-docs", "cloudflare-bindings", "cloudflare-builds", "cloudflare-observability", "stitch"],
    "verification_commands": 26
  }
}
```

**Repository stack:** go, node, flutter, java, docker

**Component stacks:** backend (go, docker), mobile (flutter, java), app/web/superadmin (node), simulator (go, node), tools (go)

---

## 4. Evidence map (Speed Flexy)

| Extracted item | Source file |
|----------------|-------------|
| 37 capabilities | `.cursor/agents/registry.yaml` |
| 13 agents | `registry.yaml` + `.cursor/agents/*.md` |
| 13 ownership entries | `registry.yaml` paths_* fields |
| 15 protected paths | registry `paths_forbidden`, `sensitive_domains.contracts` |
| 6 Tier 3 ops | `.cursor/policy/rules.json` (project-specific subset) |
| 9 MCP integrations | `.cursor/mcp.json` |
| 26 verification commands | registry + `*/package.json` + go/flutter paths |
| Deployment | `backend/fly.toml`, `*/wrangler.toml`, `supabase/migrations/` |

---

## 5. Tests

| # | Scenario | Result |
|---|----------|--------|
| 1 | Mature Go/Flutter/Node | PASS |
| 2 | Project-local agents | PASS |
| 3 | Project-local capabilities | PASS |
| 4 | Protected paths | PASS |
| 5 | Tier 3 operations | PASS |
| 6 | MCP metadata | PASS |
| 7 | Verification commands | PASS |
| 8 | Secret redaction | PASS |
| 9 | Missing optional sections | PASS |
| 10 | Contradictory evidence | PASS |
| 11 | Empty/new project | PASS |
| 12 | Initialized project | PASS |
| + | Speed Flexy reference | PASS (14/14 total) |

```bash
npm run test:adapter   # 14/14 PASS
npm run test:bootstrap # 10/10 PASS
npm test               # 13/13 PASS
```

---

## 6. Security

- MCP output contains **metadata only** — no API keys, tokens, or connection secrets
- `has_env_references` flags `${env:...}` usage without copying values
- Global protected paths (`.cursor/agents/`, hooks, policy) are **not** duplicated as project overrides
- Project Tier 3 ops are **additive** to global baseline (`git_push` etc. remain global)
- Tier 3 remains approval-gated via existing policy engine

---

## 7. Speed Flexy integrity

`C:\Apps\speed-flexy-server` was **not modified** during this task. Only `--dry-run` was executed against it. Existing `.agent-os/project.yaml` (empty sections) remains unchanged.

---

## 8. Universal OS changes

| File | Change |
|------|--------|
| `bootstrap/adapter-extraction.mjs` | **New** — full extraction pipeline |
| `bootstrap/project-discovery.mjs` | Integrates adapter extraction into profile |
| `bootstrap/initialize.mjs` | Uses extracted adapter for manifest; dry-run `proposed_adapter` |
| `tests/bootstrap-adapter-extraction.test.mjs` | **New** — 14 tests |
| `docs/bootstrap.md` | Adapter extraction documentation |
| `package.json` | `test:adapter` script |

---

## 9. Remaining limitations

1. YAML parser is minimal — complex nested YAML may need `.agent-os/project.json` fallback
2. Supabase/Postgres not a separate stack flag (only deployment provider metadata)
3. Dry-run with existing manifest reports `preserve` action — use `proposed_adapter` for review
4. `specialist-mapping.yaml` vs `registry.yaml` contradictions only checked when both exist
5. Applying improved adapter to Speed Flexy requires explicit user approval (not done here)

---

## 10. Apply readiness

**READY TO APPLY**

The bootstrapper can now extract a complete project adapter from Speed Flexy evidence. Review `proposed_adapter` via dry-run, then apply to replace the empty `.agent-os/project.yaml` when approved.

```powershell
node C:\Apps\cursor-agent-os\bootstrap\initialize.mjs --dry-run --project-dir "C:\Apps\speed-flexy-server"
```

Do **not** apply until human review of extracted Tier 3 ops, MCP metadata, and capabilities.
