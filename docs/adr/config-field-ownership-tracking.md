# ADR: Config Field Ownership Tracking via Content Hashing

**Status:** Draft
**Date:** 2026-06-28
**Deciders:** Spec team

## Context

Shared config files (`opencode.jsonc`) contain both user-managed and Elegy-managed fields. Elegy needs to track which fields it manages without conflicts when users manually edit the same fields.

## Decision

Use SHA-256 content hashing. Elegy stores a `_managedPrompts` map in the sidecar file (`_state.json`), keyed by agent name with a SHA-256 hash of the prompt text it last wrote. Before overwriting a managed field, Elegy compares the current hash against the stored hash:

- **Hash matches**: Elegy owns the field → safe to overwrite.
- **Hash differs or key missing**: User or another tool modified the field → skip, don't auto-claim.

## Tradeoffs

| Option | Collision Risk | Complexity | User Surprise |
|--------|---------------|-----------|--------------|
| Content hash (chosen) | Low (user writes same text) | Low | Low |
| Nonce marker in config | None | Medium | Low (visible in config) |
| Separate sidecar per agent | None | High | Low |

## Reuse

This pattern applies to any Elegy-managed field in a shared config:
- Managed permission rules
- Custom agent config overrides
- Any `agent.<name>.*` field written by Elegy

## Links

- `docs/specs/opencode-custom-prompts/spec.md` — original spec
- `opencode-assets/prompts/` — prompt skill catalog
