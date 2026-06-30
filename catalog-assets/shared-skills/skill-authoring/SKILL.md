---
name: skill-authoring
description: "Create or refine portable Agent Skills (SKILL.md) that work across Codex, Claude Code, OpenCode, Cursor, and compatible tools. Use when designing a new skill, fixing a skill that triggers at the wrong time, or packaging instructions as a reusable workflow. Triggers on: create skill, write SKILL.md, refine skill, skill frontmatter, skill description, agent skill."
license: Apache-2.0
metadata: {"author":"elegy-copilot","source":"https://agentskills.io/specification","version":"1.2","aliasKeys":["create skill","write SKILL.md","refine skill","skill frontmatter","skill description","agent skill"]}
---

# Skill Authoring

## Purpose

Create portable Agent Skills that follow the open standard at
[agentskills.io](https://agentskills.io/specification) and load correctly in
Agent Skills-compatible runtimes (Codex, Claude Code, OpenCode, Cursor, and others);
verify harness-specific extensions before deployment.

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

## Core Principles

### Concise is Key

The context window is a public good. Skills share the context window with everything else the agent needs: system prompt, conversation history, other skills' metadata, and the actual user request.

Default assumption: the agent is already very smart. Only add context it doesn't already have. Challenge each piece: "Does the agent really need this explanation?" and "Does this paragraph justify its token cost?"

Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom

Match specificity to the task's fragility and variability:

- **High freedom** (text-based instructions): Use when multiple approaches are valid, decisions depend on context, or heuristics guide the approach.
- **Medium freedom** (pseudocode or scripts with parameters): Use when a preferred pattern exists, some variation is acceptable, or configuration affects behavior.
- **Low freedom** (specific scripts, few parameters): Use when operations are fragile and error-prone, consistency is critical, or a specific sequence must be followed.

Think of the agent exploring a path: a narrow bridge with cliffs needs specific guardrails (low freedom), while an open field allows many routes (high freedom).

### Protect Validation Integrity

You may use subagents during iteration to validate whether a skill works on realistic tasks or whether a suspected problem is real. This is most useful when you want an independent pass on the skill's behavior, outputs, or failure modes after a revision.

When using subagents for validation, treat that as an evaluation surface. The goal is to learn whether the skill generalizes, not whether another agent can reconstruct the answer from leaked context.

Prefer raw artifacts such as example prompts, outputs, diffs, logs, or traces. Give the minimum task-local context needed to perform the validation. Avoid passing the intended answer, suspected bug, intended fix, or your prior conclusions unless the validation explicitly requires them.

## Skill Naming

Use lowercase letters, digits, and hyphens only. Normalize user-provided titles to hyphen-case (e.g., "Plan Mode" → `plan-mode`).

- Generate a name under 64 characters
- Prefer short, verb-led phrases that describe the action
- Namespace by tool when it improves clarity or triggering (e.g., `gh-address-comments`, `linear-address-issue`)
- Name the skill folder exactly after the skill name

## What to Not Include in a Skill

A skill should only contain essential files that directly support its functionality. Do NOT create extraneous documentation or auxiliary files, including:

- `README.md`
- `INSTALLATION_GUIDE.md`
- `QUICK_REFERENCE.md`
- `CHANGELOG.md`
- etc.

The skill should only contain the information needed for an agent to do the job at hand. It should not contain auxiliary context about the process that went into creating it, setup and testing procedures, or user-facing documentation.

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
| `metadata` | No | Arbitrary string map for additional context (use plain YAML mapping; keep values as simple strings unless the target harness explicitly supports richer values) |
| `allowed-tools` | No | Space-separated pre-approved tools (experimental); verify target harness support before relying on this field |

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

## Skill Creation Process

Follow these steps in order. Skip a step only when there is a clear reason it does not apply.

### Step 1: Understand the Skill with Concrete Examples

Skip only when the skill's usage patterns are already clearly understood.

Understand concrete examples of how the skill will be used. Relevant questions include:

- "What functionality should the skill support?"
- "What would a user say that should trigger this skill?"
- "Where should the skill be created?"

Conclude when there is a clear sense of the functionality the skill should support.

### Step 2: Plan Reusable Skill Contents

Analyze each concrete example by:

- Considering how to execute on the example from scratch
- Identifying what scripts, references, and assets would be helpful when executing these workflows repeatedly

For example, rotating PDFs requires rewriting the same code each time → bundle a `scripts/rotate_pdf.py`. Querying BigQuery requires re-discovering table schemas → bundle a `references/schema.md`.

Establish a list of reusable resources: scripts, references, and assets.

### Step 3: Initialize the Skill

Skip only if the skill already exists.

Create the skill using:

```
scripts/init_skill.py <skill-name> --path <output-directory> [--resources scripts,references,assets] [--examples]
```

If the user does not specify a location, default to the harness skills directory (e.g., `~/.config/opencode/skills` for OpenCode).

The script creates the directory, generates `SKILL.md` with proper frontmatter, creates `agents/openai.yaml` from `--interface` values, and optionally creates resource directories.

### Step 4: Edit the Skill

Start with reusable resources (scripts, references, assets), then update `SKILL.md`.

Remember: the skill is being created for another agent instance to use. Include information that would be beneficial and non-obvious. Consider what procedural knowledge, domain-specific details, or reusable assets would help another agent execute these tasks more effectively.

Added scripts must be tested by actually running them. If there are many similar scripts, test a representative sample.

After substantial revisions, forward-test the skill on realistic tasks.

### Step 5: Validate the Skill

Run validation to catch basic issues:

```
scripts/quick_validate.py <path/to/skill-folder>
```

The validation script checks YAML frontmatter format, required fields, and naming rules. Fix any reported issues and re-run.

### Step 6: Iterate

After testing the skill, you may detect the skill is complex enough that it requires forward-testing, or users may request improvements.

Iteration workflow:

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Identify how `SKILL.md` or bundled resources should be updated
4. Implement changes and test again
5. Forward-test if reasonable and appropriate

### agents/openai.yaml Metadata

UI-facing metadata for Codex skill lists and chips. Generate deterministically by reading the skill and passing values to `init_skill.py`:

```
scripts/init_skill.py <skill-name> --interface display_name="My Skill" --interface short_description="..." --interface default_prompt="..."
```

Or regenerate on an existing skill:

```
scripts/generate_openai_yaml.py <path/to/skill-folder> --interface display_name="My Skill"
```

Required fields: `display_name`, `short_description`, `default_prompt`. Only include other optional fields (icons, brand color) when explicitly provided.

### Forward-testing

To forward-test, launch subagents to stress-test the skill with minimal context. Subagents should not know they are being asked to test the skill — treat them as agents asked to perform a task.

Example prompt to a subagent:

```
Use <skill-x> at /path/to/skill-x to solve problem <y>
```

Not:

```
Review the skill at /path/to/skill-x; pretend a user asks you to...
```

Decision rule for forward-testing: err on the side of forward-testing. Ask for approval if forward-testing would take a long time, require additional approvals, or modify production systems.

Considerations:

- Use fresh threads for independent passes
- Pass the skill and a request similar to how the user would
- Pass raw artifacts, not your conclusions
- Avoid showing expected answers or intended fixes
- Rebuild context from source artifacts after each iteration
- Review the subagent's output, reasoning, and emitted artifacts
- Clean up subagents' artifacts between iterations to avoid contamination

If forward-testing only succeeds when subagents see leaked context, tighten the skill or the forward-testing setup before trusting the result.

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
