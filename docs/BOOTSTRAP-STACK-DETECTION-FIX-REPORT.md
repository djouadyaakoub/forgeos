# Final Report — Bootstrap Stack Detection Fix

## 1. Root cause

`detectStackIndicators()` in `bootstrap/project-discovery.mjs` only checked markers at the **repository root** via `fs.existsSync(path.join(projectDir, marker))`.

Speed Flexy keeps markers in subdirectories:

| Technology | Actual location | Old check |
|------------|-----------------|-----------|
| Go | `backend/go.mod`, `simulator/go.mod` | root `go.mod` only |
| Flutter | `mobile/gateway/pubspec.yaml` | root `pubspec.yaml` only |
| Node | `app/package.json`, `web/package.json`, etc. | root `package.json` only |
| Docker | `backend/Dockerfile` | root `Dockerfile` only |

Only `dotnet` (`*.csproj`) used recursive `walkFind()`. Path resolution was fine; the bug was detection scope, not paths or executables in PATH.

**Mode confusion:** `mode: INITIALIZED` was set when `AGENTS.md` existed, conflating “existing mature project” with “Agent OS adapter materialized.”

---

## 2. Fix

| File | Change |
|------|--------|
| `bootstrap/project-discovery.mjs` | Recursive repo walk; component stacks; `resolveProjectKind()`; `stack_detection_warning` diagnostics |
| `bootstrap/initialize.mjs` | Richer report (`project_kind`, `stack.repository`, `stack.components`) |
| `tests/bootstrap-stack.test.mjs` | 10-scenario test suite |
| `docs/bootstrap.md` | Detection semantics and project kinds |
| `package.json` | `test:bootstrap` script |

---

## 3. Detection semantics

Detection uses **repository evidence only** (not `go`/`flutter` in PATH):

- Recursive walk (depth 8), skipping `.git`, `node_modules`, `vendor`, etc.
- Marker files: `go.mod`, `package.json`, `pubspec.yaml`, `Dockerfile`, etc.
- Extensions as secondary evidence: `.go`, `.dart`, `.csproj`
- Output: `stack.repository` + `stack.components` (per top-level dir)

---

## 4. Speed Flexy result

**Repository stack:**

```text
go: true | node: true | flutter: true | docker: true | java: true (Android Gradle)
```

**Component stacks:**

| Component | Stack |
|-----------|-------|
| `backend` | Go, Docker |
| `mobile` | Flutter, Java (Gradle) |
| `app`, `web`, `superadmin` | Node |
| `simulator` | Go, Node |
| `tools` | Go |

**Project kind:** `EXISTING_PROJECT` (adapter not yet created; plans `.agent-os/project.yaml`)

---

## 5. Path resolution

| Invocation | `project_dir` | Stack result |
|------------|---------------|--------------|
| `--project-dir "C:\Apps\speed-flexy-server"` | `C:\Apps\speed-flexy-server` | Identical |
| `--project-dir .` (cwd = Speed Flexy) | `C:\Apps\speed-flexy-server` | Identical |

---

## 6. Tests

| # | Scenario | Result |
|---|----------|--------|
| 1 | Speed Flexy reference | PASS |
| 2 | Empty project | PASS |
| 3 | Go fixture (`go.mod`) | PASS |
| 4 | Flutter fixture (`pubspec.yaml`) | PASS |
| 5 | Node fixture (`package.json`) | PASS |
| 6 | Mixed Go+Flutter+Node | PASS |
| 7 | Absolute vs `.` path | PASS |
| 8 | Existing project without adapter | PASS |
| 9 | Agent OS initialized | PASS |
| 10 | Docs without markers → warning | PASS |

```bash
node tests/bootstrap-stack.test.mjs  # 10/10 PASS
npm test                             # 13/13 PASS
```

---

## 7. Corrected dry-run output (summary)

```json
{
  "project_kind": "EXISTING_PROJECT",
  "agent_os_initialized": false,
  "stack": {
    "repository": { "go": true, "node": true, "flutter": true, "docker": true, "java": true },
    "components": {
      "backend": { "go": true, "docker": true },
      "mobile": { "flutter": true, "java": true },
      "app": { "node": true },
      "web": { "node": true },
      "superadmin": { "node": true }
    }
  },
  "planned_actions": [{ "action": "create", "path": ".agent-os/project.yaml" }],
  "dry_run": true
}
```

---

## 8. Speed Flexy integrity

`C:\Apps\speed-flexy-server` was **not modified** by this task. Only `--dry-run` was executed. `git status` shows pre-existing changes unrelated to `.agent-os/`.

---

## 9. Limitations

1. **Java** is inferred from Android Gradle files under `mobile/` — not a standalone Java backend.
2. **Supabase/Postgres** is not a separate stack flag (no `supabase/` migration markers in the generic detector).
3. **YAML parser** for manifests remains minimal.
4. **Evidence summary** may include one representative `.dart`/`.go` path when only extensions match.

---

## 10. Apply readiness

**READY TO APPLY**

Bootstrap dry-run correctly detects Speed Flexy’s stack and plans adapter creation. No adapter was applied to Speed Flexy in this task.
