---
name: agents-md-authoring
description: "Create or refine per-harness instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md) that follow the open AGENTS.md standard. Use when adding a new instruction file, layering repo-specific overrides, or auditing which instruction files an agent will load. Triggers on: create AGENTS.md, write CLAUDE.md, instruction file, override, AGENTS.override.md, repo instructions."
license: Apache-2.0
metadata: {"author":"elegy-copilot","source":"https://developers.openai.com/codex/guides/agents-md","version":"1.1","aliasKeys":["create AGENTS.md","write CLAUDE.md","instruction file","override","AGENTS.override.md","repo instructions"]}
---

# AGENTS.md Authoring

## Purpose

Create and maintain per-harness instruction files (`AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`, `.github/copilot-instructions.md`) that follow the open
[AGENTS.md standard](https://agents.md). These files give coding agents
project-specific instructions and conventions.

The [AGENTS.md open format](https://agents.md) is supported by OpenAI Codex,
Cursor, Google Jules, Roo Code, and other agents. The same authoring rules
apply to Claude Code's `CLAUDE.md`, Antigravity's `GEMINI.md`, and GitHub
Copilot's `copilot-instructions.md` — they are all the same concept under
different filenames.

## When to Create an Instruction File

Create a per-harness instruction file when:

- The repo has stable conventions the agent should always follow
- Build, test, or lint commands are not obvious
- There are known pitfalls specific to this codebase
- The team has a specific code review or commit style expectation
- The project has a setup or bootstrap procedure beyond `git clone`

Do not create an instruction file when:

- The repo has no stable conventions yet
- The instructions only apply to one ad-hoc task
- The content is already covered by the harness's global instructions
- A canonical doc (see harness instructions' repo discovery chain) is the right
  place for the policy

## Discovery Precedence

Agents build an instruction chain at startup by walking a directory tree and
concatenating matching files. Codex's discovery order is:

1. **Global scope** — `~/.codex/AGENTS.override.md` (if present) or
   `~/.codex/AGENTS.md`. Only one file loads at this level.
2. **Project scope** — from the repo root (typically the Git root) down to
   the current working directory. In each directory, the agent checks
   `AGENTS.override.md` first, then `AGENTS.md`, then any filenames in
   `project_doc_fallback_filenames`.
3. **Merge order** — files are concatenated from root down with blank lines
   between. Files closer to the current directory override earlier guidance
   because they appear later.

The agent stops adding files once the combined size reaches
`project_doc_max_bytes` (32 KiB by default). Raise the limit or split across
nested directories when the cap is hit.

Equivalent per-harness behavior:

- **Claude Code** reads `CLAUDE.md` (from each directory in the tree walk) and `CLAUDE.local.md`
  (personal project-specific preferences; add to `.gitignore`). Both load from each directory as
  Claude walks up the tree from cwd, concatenated root-to-cwd. Unlike Codex where
  `AGENTS.override.md` replaces `AGENTS.md` at each level, `CLAUDE.local.md` is appended
  after `CLAUDE.md` at each directory level. Claude Code also supports importing `AGENTS.md`
  via the `@AGENTS.md` directive placed at the top of `CLAUDE.md`.
- **Antigravity** reads `GEMINI.md` with the same precedence
- **GitHub Copilot** reads `.github/copilot-instructions.md` (single file, not layered),
  path-specific `.github/instructions/**/*.instructions.md` files, and `AGENTS.md` in
  some surfaces.
- **OpenCode** reads `AGENTS.md` from the same layered sources

## Authoring Rules

### Keep It Small and Scoped

Each instruction file should be focused. The agent loads the full chain on
every run; verbose global files slow every task.

- Root `AGENTS.md`: project overview, key commands, top-level conventions
- Nested `AGENTS.override.md`: subtree-specific overrides only
- Push detail to canonical docs and link them rather than copying

### State What the Agent Cannot Guess

Put content in `AGENTS.md` that the agent would not know without it:

- Exact build, test, lint commands
- Path conventions specific to the project
- Known pitfalls and gotchas
- Commit message format, branch naming, or PR conventions
- Setup steps beyond `git clone` and `npm install`

Do not restate:

- General programming best practices
- Documentation of standard tools
- Long prose explanations of how the project works (link a doc instead)

### Use a Consistent Structure

Recommended sections for a root `AGENTS.md`:

```markdown
# AGENTS.md

## Build and test
- [exact commands]

## Code conventions
- [project-specific rules]

## Pitfalls
- [known gotchas]

## Pointers
- [links to canonical docs, specs, ADRs]
```

### Use Overrides for Subtree Specifics

Inside a specialized subtree (e.g. `services/payments/`), create an
`AGENTS.override.md` with rules that differ from the root. The override
replaces the regular file in that directory.

```markdown
# services/payments/AGENTS.override.md

## Payments service rules
- Use `make test-payments` instead of `npm test`.
- Never rotate API keys without notifying the security channel.
```

The agent reads the override as a complete replacement of the base file at
that level. Keep overrides short and focused.

### Customize Fallback Filenames

If the repo already uses a different filename (e.g. `TEAM_GUIDE.md`), add it
to the fallback list so the agent treats it as an instruction file.

```toml
# ~/.codex/config.toml
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]
```

After updating, restart the agent so the new configuration loads.

## Distinguishing Surfaces

| Surface | Use for | Authority |
|---------|---------|-----------|
| `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` | Repo-wide agent conventions and commands | High — agent reads on every run |
| `AGENTS.override.md` (per-harness equivalent) | Subtree-specific overrides | Higher than root — replaces at that level |
| Canonical docs (`docs/system/**`, or repo equivalent) | Durable policy, governance, architecture | Highest — override agent instructions when conflicting |
| Per-task instructions in the prompt | One-off task guidance | Highest within that task |

When a canonical doc and an instruction file conflict, the canonical doc
wins. Surface the conflict in the agent's output and ask the user how to
reconcile.

## Verification

After creating or editing an instruction file, verify the agent picks it up:

1. From the repo root, run the agent with auto-approval:
   ```bash
   codex --ask-for-approval never "Summarize the current instructions."
   ```
2. Confirm the agent quotes items from the expected files in precedence order.
3. From a subdirectory, run the same command and confirm the nested override
   replaces the root.

For other harnesses:

- **Claude Code** — use `/memory` slash command to view loaded instructions
- **OpenCode** — use `/help` to see active context
- **Antigravity** — use the `memories` panel

## Common Mistakes

- **Copying policy from canonical docs** — `AGENTS.md` should point to the
  canonical doc, not duplicate its content.
- **Writing a single huge file** — split across nested directories or push
  detail to a canonical doc.
- **Forgetting the override pattern** — use `AGENTS.override.md` for
  subtree rules, not a different filename.
- **Vague instructions** — agents need exact commands, paths, and rules.
- **Restating the agent's general knowledge** — do not explain what
  TypeScript, Git, or HTTP is.

## Canonical References

- [AGENTS.md open standard](https://agents.md) — the open format
- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
  — Codex-specific discovery, layering, override behavior
- [Codex config reference](https://developers.openai.com/codex/config-reference)
  — `project_doc_fallback_filenames`, `project_doc_max_bytes`
- [Claude Code memory documentation](https://docs.claude.com/en/docs/claude-code/memory)
  — Claude Code's `CLAUDE.md` behavior

## When This Skill Loads

Load this skill when:

- The user asks to create, write, edit, or audit an instruction file
  (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `copilot-instructions.md`)
- The user asks how instruction discovery or layering works
- The user wants to add a subtree override
- The user asks why the agent is loading a specific instruction file

Do NOT load this skill when:

- The user just wants to ask a coding question inline
- The instructions are task-specific and should go in the prompt
- The right surface is a canonical doc, not an instruction file
