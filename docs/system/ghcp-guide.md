---
created: 2026-06-26
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: ghcp-guide
summary: Guide for the GitHub Copilot CLI (ghcp) harness — BYOK model routing, lane agents, and wrapper script.
tags: [ghcp, copilot-cli, harness, guide]
related: [opencode-guide, harness-asset-flow]
---

# GHCP Guide

GitHub Copilot CLI (`copilot` binary) harness for Elegy Copilot with BYOK model routing.

## Quick Start

```bash
# 1. Install copilot CLI
brew install copilot-cli          # macOS
npm i -g @github/copilot          # cross-platform
winget install GitHub.Copilot     # Windows

# 2. Install Elegy Copilot ghcp harness
node scripts/ghcp-install.mjs

# 3. Set your API key
export DEEPSEEK_API_KEY=sk-...

# 4. Use the wrapper
ghcp quick "fix the typo in README.md"
ghcp project "implement the auth refactor"
```

## Architecture

```
ghcp-assets/
├── manifest.json          # Asset manifest
├── profiles.json          # 5 profiles (same as opencode, adapted for env vars)
├── home/
│   └── AGENTS-appendix.md # Harness-specific instructions
├── agents/
│   ├── quick.agent.md     # Lane: small model, 1-2 files
│   ├── project.agent.md   # Lane: big model, roadmap work
│   ├── impl.agent.md      # Subagent: implementation
│   ├── explorer.agent.md  # Subagent: code discovery
│   ├── reviewer.agent.md  # Subagent: review gate
│   └── scout.agent.md     # Subagent: external research
└── wrapper/
    ├── ghcp               # Bash wrapper
    ├── ghcp.ps1           # PowerShell wrapper
    └── ghcp.cmd           # CMD shim (Windows)
```

## How It Works

Copilot CLI uses **BYOK** (Bring Your Own Key) — custom model providers via environment variables:

| Variable | Purpose |
|---|---|
| `COPILOT_PROVIDER_TYPE` | `openai`, `azure`, or `anthropic` |
| `COPILOT_PROVIDER_BASE_URL` | Provider endpoint URL |
| `COPILOT_PROVIDER_API_KEY` | API key (not needed for local Ollama) |
| `COPILOT_MODEL` | Model name |

The `ghcp` wrapper script reads `ghcp-assets/profiles.json`, resolves the active profile, sets the right env vars, and invokes `copilot --agent <lane>`.

## Lanes

| Command | Model | Use case |
|---|---|---|
| `ghcp quick <prompt>` | Flash (small) | 1-2 file tweaks, <5 min |
| `ghcp project <prompt>` | Pro (big) | Multi-session roadmap work |
| `ghcp impl <prompt>` | Flash | Bounded implementation |
| `ghcp explorer <prompt>` | Flash | Code discovery |
| `ghcp reviewer <prompt>` | Pro | Review gate |
| `ghcp scout <prompt>` | Pro | External research |

## Profiles

```bash
ghcp profile list        # Show all profiles
ghcp profile current     # Show active profile
ghcp profile switch deepseek-direct  # Switch profile
```

Available profiles:
- `opencode-go-balanced` — Go provider with DeepSeek defaults
- `opencode-go-fast` — Go provider with cheaper exploration models
- `opencode-zen-free` — Free-tier models (best-effort)
- `opencode-zen-mixed` — Free for exploration, stronger for planning
- `deepseek-direct` — Direct DeepSeek API (default)

## Install Commands

```bash
node scripts/ghcp-install.mjs                  # Install to ~/.copilot/
node scripts/ghcp-install.mjs --dry-run        # Preview what would be installed
node scripts/ghcp-install.mjs --force          # Overwrite existing files
node scripts/ghcp-install.mjs --copilot-home /custom/path  # Custom home

node scripts/ghcp-profile-switch.mjs deepseek-direct  # Switch profile
node scripts/ghcp-profile-switch.mjs --list           # List profiles
node scripts/ghcp-profile-switch.mjs --current        # Show active
```

## Differences from OpenCode

| Dimension | OpenCode | GHCP |
|---|---|---|
| Agent format | `.md` frontmatter | `.agent.md` frontmatter |
| Model routing | Agent `model:` field | `COPILOT_PROVIDER_*` env vars |
| Lane selection | TUI Tab selector | `ghcp <lane>` command |
| Config dir | `~/.config/opencode/` | `~/.copilot/` |
| Settings | `opencode.jsonc` | `settings.json` |
| Plugin system | JS plugins | MCP servers + hooks |
| Auth | API keys in config | BYOK env vars |

## Model Requirements

Models used with BYOK must support:
- **Tool calling (function calling)** — required for agent capabilities
- **Streaming** — required for real-time output
- **Context window ≥ 128k tokens** — recommended

DeepSeek V4 Pro and Flash both meet these requirements.

## npm Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "install:ghcp": "node scripts/ghcp-install.mjs",
    "ghcp:profile:switch": "node scripts/ghcp-profile-switch.mjs",
    "ghcp:profile:list": "node scripts/ghcp-profile-switch.mjs --list",
    "ghcp:profile:current": "node scripts/ghcp-profile-switch.mjs --current"
  }
}
```
