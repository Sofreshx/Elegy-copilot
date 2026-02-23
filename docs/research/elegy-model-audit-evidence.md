---
created: 2026-02-23
updated: 2026-02-23
category: research
status: draft
doc_kind: node
id: elegy-model-audit-evidence
summary: Empirical evidence for VS Code Copilot model-pinning behavior via agent frontmatter.
tags: [elegy, model-pinning, evidence]
---

# Model-Pinning Verification — Empirical Evidence

## Test Environment
- **Date**: _TODO_
- **VS Code Version**: _TODO_
- **Copilot Extension Version**: _TODO_
- **OS**: Windows

## Agent Files Under Test
| Agent | File | `model:` Value (original) |
|-------|------|--------------------------|
| reviewer-opus-4-6 | `engine-assets/agents/reviewer-opus-4-6.agent.md` | `Claude Opus 4.6 (copilot)` |
| reviewer-gpt-5-3-codex | `engine-assets/agents/reviewer-gpt-5-3-codex.agent.md` | `GPT-5.3-Codex` |

## Test Protocol

### Test A: Controlled Negative (Invalid Model)
1. Edit `reviewer-opus-4-6.agent.md` line 7: `model: INVALID-MODEL-12345`
2. Reload VS Code window (`Ctrl+Shift+P → Developer: Reload Window`)
3. Invoke `@reviewer-opus-4-6` with trivial prompt: "Review this: `const x = 1;`"
4. Check Extension Host output (`Help → Toggle Developer Tools → Console`) for model-resolution errors
5. Record observation below
6. Restore original file immediately
7. Repeat steps 1-6 for `reviewer-gpt-5-3-codex.agent.md`

### Test B: Valid-but-Different Model (Triangulation)
1. Edit `reviewer-opus-4-6.agent.md` line 7: `model: gpt-5-mini`
2. Reload VS Code window
3. Invoke `@reviewer-opus-4-6` with same trivial prompt
4. Compare response style/capabilities against Opus-class output
5. Record observation below
6. Restore original file immediately

## Observations

### Test A — Invalid Model: reviewer-opus-4-6
- **Modified value**: `INVALID-MODEL-12345`
- **Behavior**: _TODO_
- **Extension Host output**: _TODO_
- **Signal type**: _model-specific error / generic failure / silent success_

### Test A — Invalid Model: reviewer-gpt-5-3-codex
- **Modified value**: `INVALID-MODEL-12345`
- **Behavior**: _TODO_
- **Extension Host output**: _TODO_
- **Signal type**: _model-specific error / generic failure / silent success_

### Test B — Valid-but-Different: reviewer-opus-4-6 → gpt-5-mini
- **Modified value**: `gpt-5-mini`
- **Behavior**: _TODO_
- **Response comparison**: _TODO_
- **Signal type**: _different response style / identical to ambient / inconclusive_

## Conclusion
- **Verdict**: _CONFIRMED_FUNCTIONAL / CONFIRMED_NON_FUNCTIONAL / INCONCLUSIVE_
- **Rationale**: _TODO_
- **Recommendation**: _TODO_

## Restoration Verification
- `git diff engine-assets/agents/reviewer-opus-4-6.agent.md` → _zero changes expected_
- `git diff engine-assets/agents/reviewer-gpt-5-3-codex.agent.md` → _zero changes expected_
