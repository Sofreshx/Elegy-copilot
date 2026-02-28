---
name: core-guardrails
description: "Non-negotiable execution safety guardrails for all tasks. Triggers on: run_in_terminal, terminal command, isBackground, branch switch, instruction conflict, askQuestions."
---

# Core Guardrails

## Purpose

Provide an always-available backstop for high-impact workflow rules that must remain true even when repo-level instructions are customized.

## Non-Negotiable Rules

1. Never run `run_in_terminal` with `isBackground: true`.
2. Always set `isBackground: false` for all terminal commands.
3. Never change git branches unless the user explicitly asks.
4. When instructions conflict, choose the safer interpretation and state that choice.
5. Use `vscode/askQuestions` for targeted clarification when ambiguity materially affects outcomes.

## Terminal Safety Canonical Examples

**Never do this:**

```js
run_in_terminal(command: "make build", isBackground: true)
run_in_terminal(command: "git commit", isBackground: true)
```

**Always do this:**

```js
run_in_terminal(command: "make build", isBackground: false)
run_in_terminal(command: "git commit", isBackground: false)
```

## Validation Checklist

- Any new terminal call uses `isBackground: false`.
- No branch-switch command is introduced unless explicitly requested by the user.
- If uncertainty exists, a single focused `vscode/askQuestions` clarification is used.