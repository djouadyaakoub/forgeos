# ForgeOS contributor guidance

This is the existing ForgeOS repository, not a new project. Inspect current code,
package scripts, Git status and the latest authorized stage report before editing.
Preserve pre-existing dirty/untracked work; do not reset, clean or stash it.

- Capability != Agent. Hosts are adapters, not permanent specialist agents.
- ForgeOS owns Policy, scope and approval. A host cannot override DENY.
- Verification is ForgeOS-owned; host/runtime completion is not verification PASS.
- Canvas is derived from verified evidence, not an authority or approval source.
- Keep host-native work in the same project/workspace. Do not launch another host.
- Do not commit, merge, tag, push, publish or create releases without explicit authorization.
- Produce one report per authorized stage; do not start future stages without authorization.

Canonical references (do not duplicate their architecture here):

- [Host architecture](docs/architecture/HOST-NATIVE-INTELLIGENCE.md)
- [Policy authority](docs/architecture/POLICY-AUTHORITY.md)
- [Verification and evidence](docs/architecture/VERIFICATION-AND-EVIDENCE.md)
- [Framework invariants](scripts/release/invariants.json)

Use package.json for real test commands. Run the invariant tests, relevant host/
governance regressions and canonical release validation for boundary changes.
Release validation rebuilds local artifacts; it is not permission to publish them.
