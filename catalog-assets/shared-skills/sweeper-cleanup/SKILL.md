---
name: sweeper-cleanup
description: "Find and remove dead-weight code, unused features, stale managed assets, obsolete dependencies, and cleanup candidates. Use when the user mentions sweeper work, dead code, pruning, unshipping, unused assets, or cutting dead weight."
license: Apache-2.0
metadata: {"author":"elegy-copilot","version":"1.0","aliasKeys":["sweeper","dead code","unused code","unused dependency","prune assets","unship","dead weight","cleanup candidates"]}
---

# Sweeper Cleanup

## Purpose

Use this skill to remove dead weight safely. Treat deletion as a product and
architecture decision unless the target is mechanically proven stale.

## When to use

Use this skill when the task asks to:

- find or remove dead code, unused files, unused dependencies, or stale assets
- cut dead-weight features
- unship code or prune managed harness assets
- turn cleanup candidates into a reviewed implementation slice

Do not use this skill for ordinary refactors where the user already named the
exact implementation change.

## Workflow

1. Load repo instructions and the smallest relevant canonical docs.
2. Resolve the bundled finder script from this skill directory, then run it
   against the active repo:
   ```powershell
   node <sweeper-cleanup-skill-dir>/scripts/find-sweeper-candidates.mjs --repo-root .
   ```
   If the current shell is already at the target repo root, `--repo-root .`
   can be omitted.
3. Classify each candidate:
   - `mechanical`: stale generated output, unreferenced managed asset, or unused dependency with strong evidence
   - `review-required`: public API, user-visible behavior, docs policy, migration, generated source, or weak evidence
   - `blocked`: unclear owner, missing validation path, data risk, or external contract risk
4. Remove only `mechanical` candidates or user-approved `review-required` candidates.
5. Update references, manifests, tests, and docs touched by the deletion.
6. Run the narrowest validation that proves the deletion did not break the active surface.
7. Inspect `git diff` before returning.

## Deletion Rules

- Never delete just because a symbol looks unused in one search result.
- Never delete public APIs, persisted data paths, migrations, generated assets,
  install surfaces, or user-facing behavior without explicit approval.
- Never weaken or delete tests to make cleanup pass.
- Prefer deprecation or hiding before deletion when compatibility is plausible.
- Keep removals small enough to review as one cleanup slice.

## Evidence

Use repo-local validators when present. Do not require Elegy Copilot-specific
validators in unrelated repos.

| Repo condition | Useful checks |
|---|---|
| Any repo | targeted tests, typecheck, lint, build, `git diff` |
| npm repo with commit checks | `npm run commit-check:discover` |
| Elegy Copilot asset repo | `node scripts/validate-manifest.js`, `node scripts/validate-codex-assets.js`, `node scripts/validate-opencode-agent-topology.js`, `node scripts/validate-skills.mjs` |
| Elegy Copilot docs change | `node scripts/validate-doc-graph.js` |

## Output

Return this block:

```text
SWEEPER_RESULT
- status: done|needs-review|blocked
- candidates:
  - <id>: <mechanical|review-required|blocked> - <evidence>
- removed:
  - <path or symbol> - <reason>
- validation:
  - <command> - <pass|fail|not-run> - <summary>
- residual_risks:
  - <risk or none>
```

## Candidate Finder

The bundled finder is advisory. It does not delete files. It works against any
repo passed through `--repo-root`.

Installed skill paths are usually:

| Harness | Finder path |
|---|---|
| Codex | `~/.codex/skills/sweeper-cleanup/scripts/find-sweeper-candidates.mjs` |
| OpenCode | `~/.config/opencode/skills/sweeper-cleanup/scripts/find-sweeper-candidates.mjs` |
| Source repo development | `catalog-assets/shared-skills/sweeper-cleanup/scripts/find-sweeper-candidates.mjs` |

Checks:

- Any repo: package dependencies with no static textual reference outside package metadata
- Elegy Copilot asset repos: managed Codex/OpenCode assets present on disk but
  not referenced by `catalog-assets/shippedAssets.mjs`
- Elegy Copilot asset repos: manifest assets whose source path is missing

Treat results as leads. Confirm with targeted search and validation before
editing.
