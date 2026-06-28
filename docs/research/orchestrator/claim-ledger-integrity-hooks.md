---
created: 2026-06-28
updated: 2026-06-28
category: research
status: current
doc_kind: node
id: claim-ledger-integrity-hooks
summary: Research note on harness-level claim-vs-ledger integrity hooks as a future improvement for Codex and OpenCode.
tags: [research, codex, opencode, hooks, integrity, evidence]
related: [agent-hooks, search-execute-workflow, orchestrator-architecture-adr]
---

# Claim-ledger integrity hooks

## Point

Interesting future direction: verify the agent against its own recorded tool ledger, not against
world truth.

This is the useful part of the Makoto-style idea. The hook checks whether a closing claim such as
"tests pass", "done", or "created X" is supported by the current session's recorded tool activity
and resulting filesystem state.

## Why it has merit

This is narrower than general hallucination detection and more mechanically checkable.

| Check type | Evidence source | Example |
|---|---|---|
| Claimed command ran | tool ledger | agent says it ran tests, but no test tool call exists |
| Claimed success | tool result ledger | agent says "green" after a recorded failing test run |
| Claimed artifact exists | filesystem + write ledger | agent says "created `foo.md`" but file is absent |
| Claimed phase advanced | local completion ledger | agent says "done" while required prior evidence is missing |

The pattern fits the repo's current trust posture:

- worker-reported claims are useful but not authoritative until independently checked
- hook enforcement belongs to the harness, not to this meta-harness
- future guardrails should prefer deterministic evidence over prompt-only instruction

## Host fit

### Codex

Best fit for a first slice.

- Codex exposes `PreToolUse`, `PostToolUse`, `Stop`, and `SubagentStop` hooks.
- `PostToolUse` can append to a local ledger: command kind, exit status, touched files, test result.
- `Stop` and `SubagentStop` can block or continue the loop when a closing claim is unsupported.

Good Codex-first gates:

1. "tests pass" with no recorded test run
2. "done" when the last relevant validation failed
3. "created X" when `X` does not exist
4. "implemented Y" when no relevant write/edit tool ran

### OpenCode

Partial fit.

- OpenCode plugins expose `tool.execute.before` and `tool.execute.after`.
- These are good for prevention and ledger capture.
- The documented surface is weaker than Codex for an end-of-turn retry gate.

OpenCode should therefore use a lighter version first:

- record tool outcomes in `tool.execute.after`
- deny obvious verifier-weakening patterns in `tool.execute.before`
- emit diagnostics when claims appear unsupported, even if the host cannot yet force a retry turn

## Repo boundary

Do not restore repo-global hook policy in canonical docs.

This remains a harness-local or plugin-local improvement. Canonical repo policy should stay:

- `docs/system/agent-hooks.md` is retired
- hook enforcement is owned by the host harness
- research notes may shape future Codex/OpenCode assets without becoming repo-wide authority

## Small future slices

1. Codex research plugin that records a minimal session ledger and blocks unsupported "done/green/created" claims.
2. OpenCode plugin experiment that records the same ledger and reports unsupported claims without claiming full parity.
3. Shared evidence schema for "claim", "supporting tool events", and "observed file state" so both hosts use the same vocabulary.

## Risks

- false positives if claim parsing is too semantic instead of staying mechanical
- weak guarantees if the hook path fails open on storage or parsing errors
- host mismatch: OpenCode may not support the same end-of-turn control loop as Codex

## Sources

- [Makoto](https://github.com/Clear-Sights/Makoto)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [OpenCode plugins](https://opencode.ai/docs/plugins)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
