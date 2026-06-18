---
name: skill-authoring
description: "Create or refine portable Agent Skills (SKILL.md) that work across Codex, Claude Code, OpenCode, Cursor, and 30+ tools. Use when designing a new skill, fixing a skill that triggers at the wrong time, or packaging instructions as a reusable workflow. Triggers on: create skill, write SKILL.md, refine skill, skill frontmatter, skill description, agent skill."
license: Apache-2.0
metadata: {"author":"elegy-copilot","source":"https://agentskills.io/specification","version":"1.0","aliasKeys":["create skill","write SKILL.md","refine skill","skill frontmatter","skill description","agent skill"]}
---

# Skill Authoring

## Purpose

Create portable Agent Skills that follow the open standard at
[agentskills.io](https://agentskills.io/specification) and load correctly in Codex,
Claude Code, OpenCode, Cursor, and any other skills-compatible agent.

A skill packages instructions, scripts, and resources so an agent can perform a
specific task reliably. Skills use **progressive disclosure**: agents load only
the skill name and description at startup, then read the full `SKILL.md` body
only when the skill triggers.

## When to Create a Skill

Create a skill when:

- A workflow repeats across sessions and the agent keeps getting it wrong
- The task requires project-specific conventions, edge cases, or commands the
  base model would not know
- The same instructions need to apply across multiple repos or harnesses
- You have a deterministic procedure (with or without scripts) that an agent
  should follow exactly

Do not create a skill when:

- The task is generic and the base model handles it well
- The instructions only apply to one ad-hoc session (put them in the prompt)
- The content is a one-line preference (put it in `AGENTS.md` or harness
  instructions)

## Format

A skill is a directory containing a `SKILL.md` file plus optional subdirectories.

```text
my-skill/
├── SKILL.md          Required: metadata + instructions
├── scripts/          Optional: executable code
├── references/       Optional: documentation loaded on demand
├── assets/           Optional: templates, resources
└── agents/
    └── openai.yaml   Optional: Codex UI metadata and tool dependencies
```

### SKILL.md Frontmatter

The first lines of `SKILL.md` MUST be YAML frontmatter with at minimum:

```yaml
---
name: my-skill
description: One-sentence summary of what the skill does and when to use it.
---
```

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | 1-64 chars, lowercase letters/digits/hyphens, no leading/trailing or consecutive hyphens, must match parent directory name |
| `description` | Yes | 1-1024 chars, must describe what the skill does AND when to use it, front-load trigger keywords |
| `license` | No | License name or reference to bundled license file |
| `compatibility` | No | Max 500 chars. Use only if the skill needs specific tools, packages, or network access |
| `metadata` | No | Arbitrary string map for additional context (must be a same-line JSON object) |
| `allowed-tools` | No | Space-separated pre-approved tools (experimental) |

### Body Content

After the frontmatter, write the skill instructions as Markdown. There is no
required section structure, but recommended sections are:

1. **Purpose** — one paragraph explaining what the skill does
2. **When to use** — explicit triggers, both for the agent and for the user
3. **Steps** — the procedure the agent should follow
4. **Examples** — minimal but realistic inputs and outputs
5. **Edge cases** — known gotchas and how to handle them

Keep `SKILL.md` under 500 lines. Move detailed reference material to files in
`references/` and tell the agent when to load them.

## Writing Good Descriptions

The `description` field is the single most important part of a skill. The agent
sees only the name, description, and file path at startup. The description
determines whether the skill triggers.

### Good Description

```yaml
description: Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

### Poor Description

```yaml
description: Helps with PDFs.
```

Rules:

- Front-load the key use case and trigger words
- State both what the skill does and when to use it
- Include specific keywords the user is likely to say
- Note explicit boundaries (when NOT to use)
- Stay under 1024 characters

Some agents shorten descriptions when the skills list is large. Front-load the
critical information so the skill still triggers correctly when shortened.

## Progressive Disclosure

Skills load in three stages:

1. **Metadata** (~100 tokens) — name, description, file path. Loaded at startup.
2. **Instructions** (< 5000 tokens recommended) — full `SKILL.md` body. Loaded
   when the skill triggers.
3. **Resources** (as needed) — files in `scripts/`, `references/`, `assets/`.
   Loaded only when the agent determines it needs them.

Structure your skill to take advantage of this:

- Put core instructions in `SKILL.md`
- Move detailed reference material to `references/<topic>.md`
- Tell the agent in `SKILL.md` *when* to load each reference file
- Keep file references one level deep from `SKILL.md`

## Patterns

### Gotchas Section

The highest-value content in many skills is a list of gotchas — environment
specific facts that defy reasonable assumptions.

```markdown
## Gotchas

- The `users` table uses soft deletes. Queries must include
  `WHERE deleted_at IS NULL` or results include deactivated accounts.
- The user ID is `user_id` in the database, `uid` in the auth service,
  and `accountId` in the billing API. All three refer to the same value.
```

### Output Templates

When the agent should produce a specific output format, provide a template.
Agents pattern-match well against concrete structures.

```markdown
## Report structure

Use this template:

```markdown
# [Title]

## Executive summary
[One-paragraph overview]

## Key findings
- Finding 1
- Finding 2

## Recommendations
1. Specific actionable item
```
```

### Validation Loops

Instruct the agent to validate its own work before moving on.

```markdown
## Editing workflow

1. Make your edits
2. Run validation: `python scripts/validate.py output/`
3. If validation fails, fix and re-run
4. Only proceed when validation passes
```

### Plan-Validate-Execute

For batch or destructive operations, have the agent produce a plan, validate it
against a source of truth, then execute.

```markdown
## PDF form filling

1. Extract form fields: `python scripts/analyze_form.py input.pdf` → `form_fields.json`
2. Create `field_values.json` mapping each field to its intended value
3. Validate: `python scripts/validate_fields.py form_fields.json field_values.json`
4. If validation fails, revise `field_values.json` and re-validate
5. Fill the form: `python scripts/fill_form.py input.pdf field_values.json output.pdf`
```

### Bundled Scripts

When the agent independently reinvents the same logic across runs — building
charts, parsing a format, validating output — bundle a tested script in
`scripts/` instead of relying on the agent to write it each time.

## Calibration

Match the specificity of instructions to the fragility of the task.

- **Give the agent freedom** when multiple approaches are valid. Explain *why*,
  not just *what*. Example: a code review skill that lists what to look for
  without prescribing exact steps.
- **Be prescriptive** when operations are fragile or a specific sequence must
  be followed. Example: a database migration that must run exactly this command
  in exactly this order.

Most skills mix both. Calibrate each section independently.

## Distribution

- **Direct folder install** — copy or symlink the skill into the harness's
  skills directory. Best for local authoring and repo-scoped workflows.
- **Plugin** — package one or more skills together with app mappings, MCP server
  config, and presentation assets. Best for distribution to other developers.

For most cases, direct folder install is enough. Use plugins only when
distributing to users who do not share your filesystem.

## Validation

Before shipping a new skill, verify:

1. `SKILL.md` exists and starts with valid YAML frontmatter
2. `name` matches the parent directory name
3. `name` matches `^[a-z0-9-]+$`, length 1-64, no leading/trailing/consecutive hyphens
4. `description` is 1-1024 chars, non-empty, front-loads triggers
5. `SKILL.md` is under 500 lines
6. Any referenced files (`references/`, `scripts/`, `assets/`) exist
7. Description triggers correctly on a test prompt

## Canonical References

- [Agent Skills Open Standard](https://agentskills.io/specification) — the
  shared format
- [Skill Best Practices](https://agentskills.io/skill-creation/best-practices)
  — authoring patterns
- [Codex Agent Skills](https://developers.openai.com/codex/skills) — Codex
  implementation
- [openai/skills catalog](https://github.com/openai/skills) — reference skills
- [Anthropic skills catalog](https://github.com/anthropics/skills) — additional
  reference skills

## When This Skill Loads

Load this skill when:

- The user asks to create, write, design, refine, or fix a skill
- The user asks for help with `SKILL.md` frontmatter or format
- The user wants to package instructions as a reusable workflow
- The user wants to make instructions work across multiple agents

Do NOT load this skill when:

- The user just wants to run a workflow inline (not package it)
- The user is asking about something unrelated to skill creation
- A more specific skill already covers the workflow
