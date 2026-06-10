---
name: skill-discovery
description: "Vault-first skill routing for the search/execute pattern. Use this to resolve the smallest matching on-demand skill, apply the deterministic resolver chain, and load only the skills needed for the current step."
metadata: {"aliasKeys":["search-execute"],"stacks":["orchestration"],"tags":["catalog","discovery","routing","workflow"]}
---

# Skill Discovery

## Purpose

Most domain-specific skills still live in the **skill vault** (`~/.elegy/skills-vault/`) and stay unloaded by default. The planning/spec/review shared lane is the main exception: it is installed on `~/.elegy/skills/` across shipped harnesses so those workflows are always available without extra materialization steps.

In the first-class Instruction Engine workflow, `@search` handles capability discovery and `@execute` handles capability application. This skill is the always-installed routing contract they rely on for selecting the smallest correct skill.

## Deterministic resolver chain

Use this exact order unless the caller already named the exact skill:
1. Direct load for an explicit skill name
2. Stack detection for project/framework clues
3. Catalog-backed metadata search/resolution
4. Semantic fallback as the last resort

Rules:
- Stop at the first step that yields a confident match.
- Keep selection deterministic: on ties, choose lexical order by skill name.
- Prefer the narrowest domain fit over broader/general skills.

## Multi-Skill Orchestration Policy

- Select one **primary skill** that directly matches the core task domain.
- Add **supporting skills** only for concrete cross-cutting needs (testing, risk review, deployment checks, audit formatting).
- Cap loaded skills per turn at 3 total: 1 primary + up to 2 supporting.
- Budget context intentionally: load primary first, then add supporting skills only when the current step needs them.
- If unsure, load fewer skills and re-evaluate after reading the primary one.

## When to stop and load

Load the resolved `SKILL.md` as soon as one of these is true:

- The user, caller, or task already names the exact skill.
- Stack detection returns a clear relevant skill for the current work.
- Catalog-backed search produces a confident top match.
- Only one narrow candidate remains after deterministic tie-breaking.

If no confident match exists, return the best candidate plus the ambiguity instead of speculatively loading multiple broad skills.

## Source of truth

- Runtime skill metadata index: `engine-assets/skills/skill-metadata-index.json`
- Skill manifest metadata: `engine-assets/manifest.json`
- Canonical workflow and routing policy: `docs/system/search-execute-workflow.md`
- Skills governance: `docs/system/skills-governance.md`
- System docs index: `docs/system/index.md`

## Reference discipline

Keep detailed behavior in the canonical docs, the runtime skill metadata index, and the individual skills themselves.

- Do not treat this file as a correctness-critical catalog of first-party exact skill names.
- Resolve names, aliases, load modes, and targeting metadata from the runtime index and manifest-backed metadata instead of duplicating them here.
- When examples are needed, keep them schematic, such as `<resolved-skill>`, rather than embedding exhaustive name inventories that can drift.
