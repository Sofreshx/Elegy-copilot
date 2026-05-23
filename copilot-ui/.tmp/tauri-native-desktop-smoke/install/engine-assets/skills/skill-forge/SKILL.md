---
name: skill-forge
description: "Guidance for creating and updating repo-managed skills, including frontmatter, triggers, and metadata sync. Triggers on: create skill, author skill, skill template, forge skill, project skill, runtime skill."
---

# Skill Forge

## Purpose

Create or update repo-managed skills without relying on external generators. Use this skill when you
need a clean skill skeleton, a metadata checklist, or a reminder of the minimum governance bar for a
new skill.

## When to Use

- Authoring a new skill under `engine-assets/skills/<name>/SKILL.md`
- Reworking an existing skill's frontmatter or usage guidance
- Syncing skill descriptions with `engine-assets/skills/skill-metadata-index.json`

## Required Shape

Every repo-managed skill should include:

1. Frontmatter with at least:
   - `name`
   - `description`
2. A clear `# <Skill Name>` heading
3. Purpose / when-to-use guidance
4. "When NOT to Use" guidance when misuse is likely
5. Any required output format or operating rules

## Minimal Template

```md
---
name: my-skill
description: "What this skill does. Triggers on: phrase one, phrase two."
---

# My Skill

## Purpose
One paragraph describing the problem this skill solves.

## When to Use
- Trigger signal 1
- Trigger signal 2

## When NOT to Use
- Cases that should route elsewhere

## Workflow
1. Step one
2. Step two

## Output
- Required headings, fields, or constraints
```

## Checklist Before Finishing

- Keep the directory name kebab-case and aligned with the frontmatter `name`.
- Make the trigger phrases discoverable in the `description`.
- If the skill is shipped, update `engine-assets/skills/skill-metadata-index.json` so catalog and
  discovery surfaces stay in sync.
- Prefer concise, operational guidance over narrative background.
