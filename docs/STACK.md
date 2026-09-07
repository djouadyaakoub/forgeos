# ForgeOS stack

ForgeOS is a Node.js application using ECMAScript modules (`.mjs`), with Node >=18 declared in `package.json`. The CLI, Policy, assessment, host adapters, bootstrap and release tooling use Node built-ins. Tests use Node's test runner and existing repository test scripts.

The only declared optional dependency is `@babel/parser` 7.29.8 for the JS/TS structural parser path. It is not a mandatory agent runtime. JavaScript/TypeScript analysis and graph evidence remain bounded observations, not proof of application semantics.

Codex, Cursor and Claude Code are interactive host adapters sharing ForgeOS-owned Policy, task scope and verification. Optional runtime adapter code does not imply a live installed vendor service or a proven OSS integration in the current session.

Go (`go.mod`) and Flutter (`pubspec.yaml`) occur in controlled fixtures under `tests/fixtures/`, including mixed-stack and bootstrap tests. Their detection is expected test coverage; neither Go nor Flutter is the implementation language or required runtime of ForgeOS Core.

`package.json` is the canonical source for version, supported Node version, dependencies and runnable validation commands. Local release validation builds/extracts artifacts; it does not publish them.
