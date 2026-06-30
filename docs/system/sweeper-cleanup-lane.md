---
created: 2026-06-30
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: sweeper-cleanup-lane
summary: Contract for the managed sweeper cleanup lane, including install surfaces, usage, deletion gates, and validation.
tags: [skills, agents, cleanup, codex, opencode]
related: [skills-governance, opencode-guide, harness-asset-flow]
---

# Sweeper Cleanup Lane

## Purpose

Define the managed cleanup lane for dead-weight removal.

```text
cleanup request
  -> sweeper-cleanup skill
    -> advisory candidate finder
      -> candidate classification
        -> bounded deletion
          -> repo-local validation
```

## Install Surfaces

| Harness | Managed asset | Install path |
|---|---|---|
| Codex | `sweeper` agent | `~/.codex/agents/sweeper.toml` |
| Codex | `sweeper-cleanup` skill | `~/.codex/skills/sweeper-cleanup/` |
| OpenCode | `sweeper` subagent | `~/.config/opencode/agents/sweeper.md` |
| OpenCode | `sweeper-cleanup` skill | `~/.config/opencode/skills/sweeper-cleanup/` |

Refresh managed assets with the normal installer:

```powershell
pwsh -File scripts/codex-install.ps1 --force
pwsh -File scripts/opencode-install.ps1 --force
```

## When To Use

Use sweeper when the user asks to:

- remove dead code
- find unused dependencies
- prune stale managed assets
- unship a feature
- cut dead-weight workflow, UI, docs, or harness behavior

Do not use sweeper for normal refactors where the target change is already
known and no deletion triage is needed.

## How To Use

Codex prompt:

```text
Use the sweeper lane. Find dead-weight candidates in this repo, classify them,
remove only mechanical candidates, and run focused validation.
```

OpenCode route:

```text
@project use sweeper for this cleanup slice
```

Candidate finder:

```powershell
node ~/.codex/skills/sweeper-cleanup/scripts/find-sweeper-candidates.mjs --repo-root .
node ~/.config/opencode/skills/sweeper-cleanup/scripts/find-sweeper-candidates.mjs --repo-root .
```

The finder is advisory. It never deletes files.

## Candidate Classes

| Class | Meaning | Action |
|---|---|---|
| `mechanical` | Strong evidence and low external risk | May remove in the current cleanup slice |
| `review-required` | Public API, user-visible behavior, weak evidence, or compatibility risk | Ask or produce a review plan before deletion |
| `blocked` | No validation path, unclear owner, data/security risk, or external contract risk | Do not delete |

## Validation

Use the narrowest repo-local proof.

| Repo type | Checks |
|---|---|
| Any repo | targeted tests, lint, typecheck, build, `git diff` |
| npm repo with commit checks | `npm run commit-check:discover` |
| Elegy Copilot asset repo | `node scripts/validate-manifest.js`, `node scripts/validate-codex-assets.js`, `node scripts/validate-opencode-agent-topology.js`, `node scripts/validate-skills.mjs` |
| Elegy Copilot docs change | `node scripts/validate-doc-graph.js` |

## Output

Sweeper work returns:

```text
SWEEPER_RESULT
- status: done|needs-review|blocked
- candidates:
- removed:
- validation:
- residual_risks:
```

## References

- [[skills-governance]] [skills-governance.md](docs/system/skills-governance.md)
- [[opencode-guide]] [opencode-guide.md](docs/system/opencode-guide.md)
- [[harness-asset-flow]] [harness-asset-flow.md](docs/system/harness-asset-flow.md)
