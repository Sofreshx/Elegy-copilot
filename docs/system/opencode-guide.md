---
created: 2026-05-11
updated: 2026-05-11
category: system
status: current
doc_kind: node
id: opencode-guide
summary: Native-first operating model and supported instruction-engine additions for OpenCode.
tags: [opencode, provider, agents, skills]
related: [skills-governance, search-execute-workflow, planning-backlog-roadmap-contract]
---

# OpenCode Guide

## Purpose

Define the supported OpenCode operating model for instruction-engine.

## Install Or Refresh

Install or refresh the shipped OpenCode surface with the repo scripts:

```powershell
# Windows
pwsh -File scripts/opencode-install.ps1

# macOS / Linux
bash scripts/opencode-install.sh

# Refresh managed assets
pwsh -File scripts/opencode-install.ps1 --force
```

Add `--dry-run` to preview the write set.

The installer updates the shared global `AGENTS.md`, curated OpenCode skills, and transition compatibility aliases under `~/.config/opencode/`.
It does not modify `opencode.json` for you.

## Native-First Posture

OpenCode already ships the core agent harness that instruction-engine needs.

- Use the built-in primary agents `Build` and `Plan` as the default execution and planning surfaces.
- Use the built-in subagents `General`, `Explore`, and `Scout` before creating more custom OpenCode agents.
- Configure models, permissions, and instructions through `opencode.json` instead of recreating Copilot's orchestration topology.
- Keep the instruction-engine OpenCode surface lean and skill-heavy.

## Supported Instruction-Engine Additions

Instruction-engine supports this OpenCode skill set as the primary add-on surface:

- `rubberduck-plan-review`
- `roadmap-planning`
- `implementation-review`
- `implementation-handoff`
- `security`
- `project-conventions-governance`
- `stack-detector`

These skills fill the gaps that matter for OpenCode: adversarial plan critique, durable roadmap framing, implementation review, executor-ready handoff, governance, and focused safety checks.

Compatibility-only surfaces remain available during the transition:

- `code-review`
- `refactor`
- custom `code-explorer`
- custom `web-searcher`

Keep them for compatibility, not as the primary recommendation.

## Recommended OpenCode Config

Prefer model overrides for the built-in OpenCode agents and subagents over maintaining more custom instruction-engine agents.

Recommended baseline:

```json
{
	"$schema": "https://opencode.ai/config.json",
	"instructions": ["~/.config/opencode/AGENTS.md"],
	"agent": {
		"plan": {
			"model": "anthropic/claude-sonnet-4-5",
			"temperature": 0.1
		},
		"explore": {
			"model": "deepseek/deepseek-chat",
			"temperature": 0.1
		},
		"scout": {
			"model": "deepseek/deepseek-chat",
			"temperature": 0.1
		}
	}
}
```

If you still rely on the compatibility aliases, you may also assign models to `code-explorer` and `web-searcher`, but the preferred direction is to use `Explore` and `Scout`.

## Preferred Workflow

Use this baseline workflow:

1. Use `Plan` to shape non-trivial work before edits.
2. Use `Explore` for read-only codebase discovery.
3. Use `Scout` for external docs, dependency research, and upstream comparisons.
4. Load `rubberduck-plan-review` before complex implementation or structural changes.
5. Load `roadmap-planning` when the work spans multiple sessions or needs durable phased sequencing.
6. Load `implementation-handoff` when a plan needs to be handed to another session or weaker executor.
7. Load `implementation-review` after substantial edits or before handoff.

Load skills when they change the outcome.
Do not load them just because they are available.

## Unsupported OpenCode Expansion

Do not treat OpenCode as a second Copilot fleet.

- Do not bulk-install Copilot orchestration agents.
- Do not port plan-pack or session-state authoring lanes into OpenCode.
- Do not add a parallel custom exploration or research fleet when the built-in agents already cover that role.
- Do not port Codex-only bootstrap surfaces when OpenCode's native `/init` and project `AGENTS.md` workflow already cover the repo-local guidance path.

## Repo-Local Guidance

For persistent repo guidance in OpenCode:

- use committed project `AGENTS.md` files
- use the OpenCode `/init` flow only when repo-local guidance actually needs to be created or refreshed
- keep shared global OpenCode instructions thin and workflow-specific

## Troubleshooting

### Skills not showing up

1. Verify `SKILL.md` is all-caps.
2. Check YAML frontmatter includes `name` and `description`.
3. Run `opencode debug config` to inspect resolved skill paths.
4. Check skill permissions in `opencode.json`; `deny` hides skills from agents.

### Built-in agent overrides not applying

1. Check the agent names in `opencode.json`: `plan`, `explore`, and `scout`.
2. Restart OpenCode after changing config.
3. Run `/models` to confirm the configured provider model is available.

### Compatibility aliases missing

1. Re-run the installer with `--force`.
2. Confirm the files exist under `~/.config/opencode/agents/`.
3. Prefer the built-in `Explore` and `Scout` agents if you do not need the compatibility aliases.

## See Also

- [[skills-governance]] [docs/system/skills-governance.md](docs/system/skills-governance.md)
- [[search-execute-workflow]] [docs/system/search-execute-workflow.md](docs/system/search-execute-workflow.md)
- [[planning-backlog-roadmap-contract]] [docs/system/planning-backlog-roadmap-contract.md](docs/system/planning-backlog-roadmap-contract.md)