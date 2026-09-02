# Universal Cursor Agent OS — Final Report

## 1. Extraction status

**COMPLETE**

The repository at `C:\Apps\cursor-agent-os` is built, tested (13/13 passing), and ready for Cursor plugin distribution. Full user-scope plugin installation in Cursor UI was not executed in this session (requires manual plugin install).

---

## 2. Universal architecture

```text
Global Agent OS (Cursor plugin @ user scope)
        +
Project Adapter (.agent-os/project.yaml)
        +
Project Knowledge (AGENTS.md, docs/, .cursor/agents/registry.yaml)
```

```text
USER → GLOBAL ORCHESTRATOR → PROJECT DISCOVERY → PROJECT ADAPTER
  → CAPABILITY REGISTRY (global + project) → SPECIALIST | EPHEMERAL
  → TASK/HANDOFF → POLICY → VERIFICATION → LEARNING → PROJECT KNOWLEDGE
```

---

## 3. Global components extracted

| Component | Source concept | Location |
|-----------|----------------|----------|
| Orchestrator loop | Speed Flexy Phase 3–5 | `agents/orchestrator.md` |
| Architect specialist | Generic cross-cutting role | `agents/architect.md` |
| QA specialist | `qa-bugfix` | `agents/qa-bugfix.md` |
| Security specialist | Generic security review | `agents/security.md` |
| Docs-sync specialist | Generic doc alignment | `agents/docs-sync.md` |
| Global capability registry | `registry.yaml` schema | `agents/registry.yaml` |
| Policy engine | Phase 6 engine | `policy/engine.mjs` |
| Project adapter merge | New (generalized) | `policy/project-adapter.mjs` |
| Global rules baseline | `rules.json` (stripped SF ops) | `policy/rules.json` |
| Ephemeral factory | Phase 7 flat-path | `policy/ephemeral-factory.mjs` |
| Learning factory | Phase 8 proposals | `policy/learning-factory.mjs` |
| Policy hooks | Phase 6 hooks | `policy/hooks/*.mjs`, `hooks/hooks.json` |
| Task/handoff schemas | Phase 5 | `schemas/task-state.schema.yaml`, `schemas/handoff-packet.schema.yaml` |
| Ephemeral schema | Phase 7 | `schemas/ephemeral-agent.schema.yaml` |
| Learning schema | Phase 8 | `schemas/learning-proposal.schema.yaml` |
| Tool profiles | Phase 3 (genericized) | `schemas/tool-profiles.yaml` |
| Capability registry schema | Phase 3 | `schemas/capability-registry.schema.yaml` |
| Agent status skill | Phase 5 | `skills/agent-status/SKILL.md` |
| Agent resume skill | Phase 5 | `skills/agent-resume/SKILL.md` |
| Bootstrap skill | New | `skills/initialize-agent-os/SKILL.md` |
| Bootstrap scripts | New | `bootstrap/initialize.mjs`, `bootstrap/project-discovery.mjs` |
| Core rules | `00-core`, `96-testing` | `rules/*.mdc` |
| Runtime law | Law 0–8 (generic) | `docs/agents/RUNTIME_LAW.md` |

**Not migrated globally:** `backend-api`, `frontend-ui`, `mobile`, `data-db`, `devops-release`, `safe-cleanup`, `performance`, `product-feature` — remain project-local.

---

## 4. Project-specific components (intentionally local)

- Business/domain knowledge (`AGENTS.md` content)
- Stack rules (`01-stack-locked`, `production-stack`, etc.)
- Path ownership (`backend/**`, `supabase/**`, `mobile/gateway/**`, etc.)
- Project capability registry entries
- Tier 3 ops (`fly_deploy`, `supabase_apply_migration`, `ledger_manual_adjustment`, etc.)
- MCP server configs
- Deployment provider settings
- Task data (`docs/project/tasks/`)
- Lessons, ADRs, contracts
- Project specialists under `.cursor/agents/`

---

## 5. Plugin structure

```text
cursor-agent-os/
├── .cursor-plugin/plugin.json
├── agents/                    # 5 global specialists + registry.yaml
├── skills/                    # agent-status, agent-resume, initialize-agent-os
├── hooks/hooks.json           # Plugin hook wiring
├── policy/                    # engine, adapter, factories, hooks, rules.json
├── rules/                     # Universal .mdc rules
├── schemas/                   # Generic schemas
├── bootstrap/                 # Discovery + initialize
├── templates/                 # project.yaml, AGENTS.md, STACK.md, registry
├── docs/                      # architecture, installation, security, etc.
├── tests/                     # Universal test matrix + fixtures
├── package.json
└── README.md
```

---

## 6. Global vs project boundary

| Concern | Global | Project |
|---------|--------|---------|
| Orchestrator behavior | ✓ | — |
| Policy fail-closed baseline | ✓ | Can only add restrictions |
| Protected Agent OS paths | ✓ | Cannot remove |
| Tier 3 approval model | ✓ | Adds project-specific ops |
| Tool profiles | ✓ | Can narrow via agent config |
| Task/handoff schemas | ✓ | Task data stored in project |
| Ephemeral factory mechanics | ✓ | Specs/results in project |
| Learning pipeline | ✓ | Lessons/ADRs in project |
| Stack assumptions | — | ✓ |
| Business invariants | — | ✓ |
| Deploy/DB specialists | — | ✓ |
| MCP integrations | — | ✓ |

---

## 7. Project bootstrap flow

**Existing project (e.g. Speed Flexy dry-run verified):**

```text
Audit → Preserve knowledge → Propose .agent-os/project.yaml → Map capabilities
→ Wire .cursor/hooks.json → Report gaps/contradictions
```

Non-destructive by default (`--dry-run` produces plan only).

**New project:**

```text
Initialize → Minimal .agent-os/project.yaml → Task skeleton → Registry stub → Ready
```

No stack assumptions.

---

## 8. Security model

```text
Effective = Global baseline ∩ Project restrictions ∩ Agent permissions ∩ Task scope ∩ Approval
```

- Unknown tools → deny
- Malformed state → fail closed
- Protected paths → deny without `agent_os_config_write`
- Tier 3 → task-scoped approval only
- Cross-task approval → denied
- Ephemeral agents → cannot modify registry/hooks/policy/own spec

---

## 9. Ephemeral-agent model

```text
Gap → Architect → Spec (docs/agents/ephemeral/) → Policy validate → Human approval
→ .cursor/agents/<ephemeral-id>.md (flat) → Invoke → Verify → Retire → Remove .md
```

Default max tier 2. No silent permanent promotion.

---

## 10. Learning model

| Global | Project |
|--------|---------|
| Schema, types, thresholds | Lessons in `docs/runbooks/lessons/` |
| Proposal pipeline | ADRs in `docs/adr/` |
| Protected-target guards | Playbook changes |
| Review risk classification | Capability evolution signals |

---

## 11. Versioning/update model

- Agent OS version: **1.0.0** (`policy/rules.json`)
- Projects declare: `agent_os.version: ">=1.0 <2.0"`
- Incompatible major versions detected (tested)
- Global updates improve all projects; adapters unchanged unless migration proposed

---

## 12. Multi-project isolation

**Result: PASS**

| Test | Result |
|------|--------|
| Project A `postgres-specialist` ≠ Project B `sqlite-specialist` | PASS |
| No cross-project agent leakage | PASS |
| Learning proposals project-scoped | PASS |
| Independent task prefixes (PROJA vs PROJB) | PASS |

---

## 13. Cursor installation test

**Partially verified:**

| Check | Status |
|-------|--------|
| Plugin manifest valid (`.cursor-plugin/plugin.json`) | ✓ |
| Global agents/skills/hooks present | ✓ |
| Policy engine runs | ✓ |
| Bootstrap dry-run on Speed Flexy | ✓ (read-only) |
| Actual user-scope plugin install in Cursor UI | Not executed — requires manual install |

After install, bootstrap writes project `.cursor/hooks.json` pointing to plugin policy scripts.

---

## 14. Speed Flexy leakage scan

**No project-specific leakage found** (except intentional generic examples):

| Term | Occurrences |
|------|-------------|
| `speed-flexy` | 0 |
| `fly.io` | 0 |
| `supabase` | 1 — orchestrator "MUST NOT assume... Supabase" |
| `flexy` | 0 |
| `ledger` | 0 |
| `tenant_id` | 0 |
| `mobile/gateway` | 0 |
| `Untitled UI` | 0 (1 unrelated `Untitled learning proposal` in factory) |

---

## 15. Test results

```text
Universal test matrix: 13/13 PASS
Policy dry-run:         5/5 PASS
npm test:               PASS
```

Scenarios covered: existing project, new project, multi-project, project override, global safety, Tier 3, ephemeral, learning isolation, versioning, migration dry-run.

---

## 16. Files created

54 files under `C:\Apps\cursor-agent-os\` including:

- `.cursor-plugin/plugin.json`
- `agents/` (6 files)
- `skills/` (3 skills)
- `policy/` (engine, adapter, factories, hooks, rules, tests)
- `hooks/hooks.json`
- `rules/` (2 rules)
- `schemas/` (6 schemas)
- `bootstrap/` (2 scripts)
- `templates/` (4 templates)
- `docs/` (8 docs + RUNTIME_LAW)
- `tests/` (fixtures + run-universal.mjs)
- `README.md`, `package.json`, `.gitignore`

---

## 17. Reference project integrity

`C:\Apps\speed-flexy-server` was **not modified** by this extraction.

- Only read-only access and a `--dry-run` bootstrap simulation were performed
- `git status` shows pre-existing modifications unrelated to this session

---

## 18. Limitations

1. Full Cursor plugin user-scope install not executed in IDE
2. YAML parser is minimal — complex manifests should use `.agent-os/project.json` for nested structures
3. Speed Flexy adapter not materialized (dry-run only; creating `.agent-os/project.yaml` there is a separate user action)
4. Live orchestrator E2E in Cursor chat not re-run (harness-only, matching Phase 9 limitation from reference)
5. Project hook paths in bootstrap use absolute paths to plugin location — may need adjustment per install method

---

## 19. Recommended next action

Install the plugin locally in Cursor, then run on Speed Flexy:

```bash
node C:\Apps\cursor-agent-os\bootstrap\initialize.mjs --dry-run --project-dir C:\Apps\speed-flexy-server
```

Review the plan, then apply with user confirmation to create the Speed Flexy project adapter without touching application code. Map Speed Flexy specialists into `.agent-os/project.yaml` `agents:` and `policy.tier3_operations` from the reference `rules.json`.
