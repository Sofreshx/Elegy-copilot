---
created: 2026-06-28
updated: 2026-06-29
category: adr
status: draft
doc_kind: node
summary: Draft ADR for tracking ownership of managed config fields with content hashes.
tags: [adr, config, hashing, ownership]
---

# ADR: Config Field Ownership Tracking via Content Hashing

**Status:** Draft
**Date:** 2026-06-28
**Deciders:** Spec team

## Context

Shared config files (`opencode.jsonc`) contain both user-managed and Elegy-managed fields. Elegy
needs to track which fields it manages without conflicts when users manually edit the same fields.

## Decision

Use SHA-256 content hashing. Elegy stores a `_managedPrompts` map in the sidecar file
(`_state.json`), keyed by agent name with a SHA-256 hash of the prompt text it last wrote. Before
overwriting a managed field, Elegy compares the current hash against the stored hash:

- **Hash matches**: Elegy owns the field and may overwrite it.
- **Hash differs or key missing**: User or another tool modified the field, so Elegy skips it.

## Consequences

| Option | Collision Risk | Complexity | User Surprise |
|---|---|---|---|
| Content hash (chosen) | Low (user writes same text) | Low | Low |
| Nonce marker in config | None | Medium | Low (visible in config) |
| Separate sidecar per agent | None | High | Low |

This pattern applies to any Elegy-managed field in a shared config:

- Managed permission rules
- Custom agent config overrides
- Any `agent.<name>.*` field written by Elegy

## References

- `docs/specs/opencode-custom-prompts/spec.md`
- `opencode-assets/prompts/`
