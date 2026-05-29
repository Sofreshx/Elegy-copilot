---
name: elegy-skills-discovery
description: "CLI-based governed skill discovery via Elegy. Use to search, resolve, describe, and validate skills from the governed v2 skill catalog with progressive disclosure."
metadata: {"aliasKeys":["skill-discovery","elegy-skills","skills"],"stacks":["orchestration"],"tags":["catalog","discovery","routing","skills","elegy"]}
---

# Elegy Skills Discovery

## Purpose

Discover and resolve governed Elegy skills via the CLI. This replaces generic vault-first routing
with a queryable, metadata-backed skill registry that supports progressive disclosure: compact
index by default, detail on demand.

## Prerequisite

The `elegy-skills` binary (or `elegy skills ...` umbrella command) must be available on PATH.
If not installed, this skill cannot function -- inform the user that Elegy CLI is required.

## Discovery Commands

```text
elegy skills list [--category <name>] [--lifecycle <state>] [--detail]
elegy skills search --query "<task description>"
elegy skills resolve --query "<task description>"
elegy skills describe --skill-id <id-or-alias>
elegy skills capability --capability-id <id>
elegy skills validate --file <path> | --dir <path>
```

All commands accept `--format json` (or `--json`) for structured output.

## Progressive Disclosure

Use this chain to minimize context while maximizing relevance:

1. **Compact index**: `elegy skills list --json` -- returns skill IDs, names, categories, lifecycle state. Use for broad discovery.
2. **Search**: `elegy skills search --query "<task>" --json` -- returns ranked matches with relevance scores. Use when the user describes what they want.
3. **Resolve**: `elegy skills resolve --query "<task>" --json` -- returns the single best match with confidence. Use for automatic routing.
4. **Describe**: `elegy skills describe --skill-id <id> --json` -- returns full metadata, capabilities, and constraints. Use after you've identified the skill.
5. **Capability**: `elegy skills capability --capability-id <id> --json` -- returns one capability's arguments, output schema, and side-effect flags. Use before invoking a command.

## Rules

- Treat v2 skill definitions as authoritative. They live in `contracts/fixtures/skill-definition-v2.*.json`.
- Do not use or recreate v1 `skill-definition.*.json` files.
- Inspect `capabilities[].implementation.arguments` before invoking a command.
- Check `capabilities[].execution.hasSideEffects` before running mutations.
- Prefer stdin-capable commands when `input.stdinFormat` is present.
- Use `elegy run` when an MCP stdio host is needed. Side-effecting MCP tools are blocked by default unless the call is a dry run or the host is started with `--allow-side-effects`.

## Multi-Skill Orchestration

- Select one **primary skill** that directly matches the core task domain.
- Add **supporting skills** only for concrete cross-cutting needs (testing, risk review, deployment checks, audit formatting).
- Cap loaded skills per turn at 3 total: 1 primary + up to 2 supporting.
- Load primary first, then add supporting skills only when the current step needs them.

## Authority Chain

Governed definition: `contracts/fixtures/skill-definition-v2.elegy-skills.json`
Discovery index: `contracts/fixtures/skill-discovery-index.elegy-skills.json`
CLI source: `rust/crates/elegy-skills`
