---
created: 2026-06-04
updated: 2026-06-04
category: system
status: current
doc_kind: node
id: ci-conventions
summary: Canonical guidance for CI workflow conventions, local validation, and troubleshooting.
tags: [ci, conventions, validation, troubleshooting]
related: [doc-graph-spec, system-docs-index]
---

# CI Conventions

## Action version pinning

Pin GitHub Actions to **major versions** only (`@v4`), never specific patches
(`@v4.4.6`).  Major-version pins auto-update with deprecation warnings and are
the canonical form for this repo.  Specific patch pins break silently when
the upstream release numbering skips or restructures.

An audit of `.github/workflows/*.yml` should show only `@v<N>` patterns:

```yaml
# Correct
uses: actions/checkout@v4
uses: actions/setup-node@v4
uses: actions/upload-artifact@v4

# Avoid — may fail at runtime
uses: actions/checkout@v4.2.2
uses: actions/setup-node@v4.1.0
```

## Local install discipline

**Use `npm ci`, not `npm install`, on local machines.**  `npm ci` installs
exactly what the lockfile declares, which keeps transitive-dependency hoisting
stable.  `npm install` reconciles a potentially stale tree and can leave
packages in unexpected locations.

If `vitepress build` fails with `Rollup failed to resolve import "X" from
"node_modules/Y"` for a transitive dep (e.g. `vscode-jsonrpc` pulled in by
`langium` via `mermaid`), the fix is:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

Do **not** add the unresolving dep to `package.json` — it is already correctly
declared in the lockfile; the local tree was simply out of date.

## Adding or moving docs

New or relocated markdown files under `docs/` must include valid YAML
frontmatter before the body.  The doc-graph validator (`validate-doc-graph.js`)
enforces this; run it after creating any doc:

```powershell
node scripts/validate-doc-graph.js
```

The fastest workflow:

1. Create the file with frontmatter already in place.
2. Run `node scripts/validate-doc-graph.js` — passes in <1s.
3. Add the body content.
4. Run `node scripts/check-docs-dead-links.mjs` to catch intra-doc broken links.
5. Run `npm run docs:build` to confirm the full VitePress build.

## Refactoring shell components

When a shell-level component (e.g. a sidebar tab view) is renamed, **all
import and usage sites must be updated in the same commit.**  The smoke tests
in `copilot-ui/tests/ui-react-smoke.test.js` check that `App.tsx` imports the
correct view components, but they cannot detect stale imports in other files.

## CI failure timing as a diagnostic signal

| Time window | Most likely cause |
|---|---|
| <10s | Workflow-config issue (action not found, YAML parse, runner, concurrency) |
| 30–60s | First validator or `npm ci` (lockfile, manifest, doc-graph) |
| >60s | Build or test step (UI build, tauri, vitest, runtime contracts) |

## Local validation before push

Run `npm run ci:local` to mirror the `Repo CI / build` job on Linux without
Tauri.  This runs all validators, the UI build, the local-tracker build, and
the three inline test files:

```powershell
npm run ci:local
```

On machines with the Rust toolchain, add the Tauri preflight and docs build:

```powershell
npm run ci:local:full
```

Both scripts exit non-zero on the first failure, so they double as pre-push
gates when run manually.

## Related

- [Doc graph spec](doc-graph-spec.md) — validation contract for `validate-doc-graph.js`
- System docs: [index](index.md)
