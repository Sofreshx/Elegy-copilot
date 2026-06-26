# GitHub Copilot CLI Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Harness

This is the GitHub Copilot CLI (`copilot` binary) harness. It uses BYOK
(Bring Your Own Key) to route model inference through custom providers —
no GitHub Copilot subscription required.

### Key Differences from OpenCode

| Dimension | OpenCode | Copilot CLI (ghcp) |
|---|---|---|
| Agent format | `.md` with YAML frontmatter | `.agent.md` with YAML frontmatter |
| Model routing | `profiles.json` → agent `model:` field | `COPILOT_PROVIDER_*` env vars + wrapper |
| Lane selection | TUI lane selector | `ghcp <lane>` wrapper command |
| Config location | `~/.config/opencode/` | `~/.copilot/` (default) |
| Settings file | `opencode.jsonc` | `settings.json` |
| Plugin system | JS plugins (worktree, planning, notify) | MCP servers + hooks |
| Auth | API keys in provider config | BYOK env vars OR GitHub token |

## Lane Agents

Elegy Copilot ships lane agents for the GitHub Copilot CLI.
Use the `ghcp` wrapper script to invoke them:

```
ghcp quick <prompt>     # Small model lane — 1-2 file tweaks
ghcp project <prompt>   # Big model lane — roadmap orchestration
ghcp impl <prompt>      # Implementation subagent
ghcp explorer <prompt>  # Exploration subagent
ghcp reviewer <prompt>  # Review subagent
ghcp scout <prompt>     # External research subagent
```

### Primary Lane Agents

| Agent | Model | Description |
|---|---|---|
| `quick` | Flash (small) | Small UI tweaks and tiny bug fixes (<5 min, 1-2 files, no ambiguity) |
| `project` | Pro (big) | Multi-session roadmap work with elegy-planning, worktree isolation, evidence chains |

### Subagents (invoked by lane primaries)

| Agent | Model | Access | Description |
|---|---|---|---|
| `impl` | Flash | Write-capable | Bounded implementation — file edits, commands, validation |
| `reviewer` | Pro | Read-only | Review gate — code, spec, plan, and evidence review |
| `explorer` | Flash | Read-only | Codebase discovery — patterns, traces, dependencies |
| `scout` | Pro | Read-only (restricted bash) | External docs and dependency research |

### Provider Profiles

Profiles define model+provider routing across five task roles. The wrapper
script resolves the active profile from `ghcp-assets/profiles.json` and sets
`COPILOT_PROVIDER_*` environment variables before invoking `copilot`.

| Role | Default (deepseek-direct) | Agents |
|---|---|---|
| `planning` | `deepseek-v4-pro` | `project` |
| `implementation` | `deepseek-v4-flash` | `impl`, `quick` |
| `exploration` | `deepseek-v4-flash` | `explorer` |
| `review` | `deepseek-v4-pro` | `reviewer` |
| `research` | `deepseek-v4-pro` | `scout` |

**Available profiles:**
- `opencode-go-balanced` — Go provider with DeepSeek defaults
- `opencode-go-fast` — Go provider with cheaper exploration models
- `opencode-zen-free` — Zen provider using free-tier models (best-effort)
- `opencode-zen-mixed` — Zen free models for exploration/research, stronger models for planning/review
- `deepseek-direct` — DeepSeek models via direct API (active profile)

Switch profiles:
```
ghcp profile switch <profile-id>
ghcp profile list
ghcp profile current
```

## BYOK Configuration

The Copilot CLI uses these environment variables for custom model routing:

| Variable | Purpose |
|---|---|
| `COPILOT_PROVIDER_TYPE` | `openai`, `azure`, or `anthropic` |
| `COPILOT_PROVIDER_BASE_URL` | Base URL of the model provider |
| `COPILOT_PROVIDER_API_KEY` | API key (not needed for local Ollama) |
| `COPILOT_MODEL` | Model name |
| `COPILOT_HOME` | Override config directory (default: `~/.copilot/`) |

The `ghcp` wrapper script sets these automatically based on the active profile.

## Model Requirements

Models used with Copilot CLI BYOK must support:
- **Tool calling (function calling)** — required for agent capabilities
- **Streaming** — required for real-time output
- **Context window ≥ 128k tokens** — recommended for best results

DeepSeek V4 Pro and Flash both support tool calling and streaming.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local AGENTS.md only when a repo actually needs them.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.

## Permission Pre-Allow

The following paths are pre-allowed for ghcp operations on this machine:

### Elegy planning state
- `~/.elegy/planning.db` — Durable planning database
- `~/.elegy/planning-session.json` — Active planning session sidecar
- `~/.elegy/managed-cli/planning/` — Managed elegy-planning CLI binary

### Shared worktree registry
- `~/.elegy/repo-state/` — Durable worktree records

Do not block directory access prompts for these paths during normal work.
