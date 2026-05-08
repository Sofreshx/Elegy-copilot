# OpenCode Usage Guide

How to use instruction-engine assets with [OpenCode](https://opencode.ai) — the terminal-native AI coding agent.

## Philosophy: Keep the harness light

OpenCode ships with a solid built-in harness: primary agents (Build, Plan), subagents (General, Explore), and native skill loading. The instruction-engine OpenCode assets add only what's missing:

- **Light exploration agents** — `@code-explorer` and `@web-searcher` optimized for a fast/cheap model (e.g. DeepSeek V4 Flash)
- **Curated skills** — code review, security, refactoring, conventions, and stack detection
- **Global instructions** — workflow defaults that keep sessions consistent

Don't bulk-install. OpenCode skills load on-demand via the `skill` tool — they cost zero context until explicitly invoked.

## Quick start

### 1. Install instruction-engine assets

```powershell
# Windows
pwsh -File scripts/opencode-install.ps1

# macOS / Linux
bash scripts/opencode-install.sh

# Refresh (re-run any time)
pwsh -File scripts/opencode-install.ps1 --force
```

Add `--dry-run` to preview changes without writing.

### 2. Configure DeepSeek (or your preferred light model)

The custom subagents (`code-explorer`, `web-searcher`) work best with a fast, cheap model. OpenCode natively supports DeepSeek:

```
# In OpenCode TUI
/connect
# -> Search for "DeepSeek"
# -> Paste your DeepSeek API key

# Then configure the agents to use it
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "code-explorer": {
      "model": "deepseek/deepseek-chat",
      "temperature": 0.1
    },
    "web-searcher": {
      "model": "deepseek/deepseek-chat",
      "temperature": 0.1
    }
  }
}
```

If you prefer a different light model, replace `deepseek/deepseek-chat` with your provider's model ID (e.g. `openai/gpt-4o-mini`, `anthropic/claude-haiku-4-5`).

### 3. Restart OpenCode

New agents and skills are discovered at startup.

## Using agents

### @code-explorer

Fast, read-only codebase exploration. Use for:
- Finding files by pattern ("find all React components that use `useAuth`")
- Searching code ("where is authentication middleware defined?")
- Understanding code structure ("how does the error handling pipeline work?")

```
@code-explorer find all API route handlers and list their auth guards
```

Permissions: read-only — cannot edit files, run bash, or fetch web content. Safe to delegate without review.

### @web-searcher

Fast web research and documentation lookup. Use for:
- Checking API references ("what's the latest React useOptimistic API?")
- Package research ("what's the current version of @tanstack/react-query?")
- Documentation lookups ("read the Prisma relations docs")

```
@web-searcher check the latest Next.js 15 middleware documentation
```

Permissions: read-only + webfetch — cannot edit files or run bash.

## Using skills

Skills are loaded on-demand via the `skill` tool. They appear in the tool description automatically.

### Available skills

| Skill | Purpose |
|-------|---------|
| `code-review` | High-precision code review with confidence scoring. Labels issues as Observed Defect or Inferred Risk. |
| `security` | Security review and vulnerability detection. Checks secure coding practices and exposure risks. |
| `refactor` | Safe refactoring guidance — mode selection, pattern alignment, verification steps. |
| `project-conventions-governance` | Repo conventions and governance rules. Authority order, docs structure, naming standards. |
| `stack-detector` | Automatic tech stack detection. Scans project files to identify frameworks, libraries, and classification. |

### Loading a skill

Skills load automatically when the agent determines one is needed. You can also ask explicitly:

```
review this code using the code-review skill
use the security skill to audit this authentication module
```

The agent calls `skill({ name: "code-review" })` which loads the full skill content into context.

## Configuration reference

### Agent config (opencode.json)

```json
{
  "agent": {
    "code-explorer": {
      "description": "Fast read-only code exploration",
      "mode": "subagent",
      "model": "deepseek/deepseek-chat",
      "temperature": 0.1,
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "webfetch": "deny"
      }
    }
  }
}
```

Key fields:
- `mode`: `subagent` (invoked via `@mention` or Task tool)
- `model`: Override the model for this agent. Uses `provider/model-id` format.
- `temperature`: 0.0-1.0. Lower = more deterministic.
- `permission`: Fine-grained tool access control.
- `hidden`: Set `true` to hide from `@` autocomplete (internal agents only).

### Setting a default light model for all subagents

You can also set a `small_model` globally:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "deepseek/deepseek-chat"
}
```

This applies to lightweight tasks like title generation. Subagents that don't specify a model inherit from the primary agent that invoked them.

### Instructions

Load additional instruction files globally:

```json
{
  "instructions": ["~/.config/opencode/AGENTS.md"]
}
```

Or per-project via `opencode.json` in the repo root.

### Permissions

Control which skills agents can access:

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny"
    }
  }
}
```

## Comparison with Copilot / Codex approaches

| Feature | Copilot | Codex | OpenCode |
|---------|---------|-------|----------|
| Agent format | `.agent.md` with Copilot-specific frontmatter | `.toml` with Codex-specific fields | `.md` with YAML frontmatter |
| Skill format | `SKILL.md` (same format!) | `SKILL.md` (same format!) | `SKILL.md` (same format!) |
| Skill loading | Auto (always) or on-demand via vault | On-demand via `$` commands | On-demand via `skill` tool |
| Agent invocation | `@agent` in VS Code Chat or CLI | Built-in `/plan`, `/review` | `@agent` mention or Tab cycling |
| Config location | `~/.copilot/` | `~/.codex/config.toml` | `~/.config/opencode/opencode.json` |
| Instructions | `copilot-instructions.md` | `AGENTS.md` | `AGENTS.md` (via instructions field) |

**Key insight**: SKILL.md files are cross-compatible. Skills created for one platform generally work across all three.

## Troubleshooting

### Skills not showing up

1. Verify `SKILL.md` is all-caps filename
2. Check YAML frontmatter has `name` and `description` fields
3. Run `opencode debug config` to verify skill discovery paths
4. Check skill permissions — `deny` hides skills from agents

### Agents not appearing in @ menu

1. Verify agent `.md` file has valid YAML frontmatter with `description`
2. Ensure `mode: subagent` (primary agents appear via Tab, not @menu)
3. Check `hidden: true` is not set

### DeepSeek model not available

1. Run `/connect` and select DeepSeek to add API key
2. Run `/models` to verify model discovery
3. Verify model ID format: `deepseek/deepseek-chat`

## Best practices

1. **Use @code-explorer liberally** — it's cheap, fast, and keeps your main session context clean
2. **Load skills only when needed** — they cost context. If the built-in agent is handling a task well, don't force skill loading
3. **Keep global AGENTS.md light** — workflow defaults only. Put repo-specific commands in per-project AGENTS.md
4. **Prefer Plan mode for complex work** — hit Tab to switch to Plan mode, design the approach, then switch back to Build
5. **Re-run install to refresh** — `pwsh -File scripts/opencode-install.ps1 --force` pulls latest instruction-engine assets
