---
name: instruction-engine-review
description: High-signal review checklist for changes before commit (/diff + /review).
---

Review the current changeset before commit.

Checklist:
- Correctness: does it do what was asked?
- Scope: no unrelated refactors or new features.
- Safety: no secrets; no destructive behavior added.
- Compatibility: works on Windows + non-Windows where applicable.
- Validation: identify the narrowest relevant commands/tests to run.

Use `/diff` and `/review` style output: summarize issues found (only real issues, avoid noise), then give a short “ready to merge?” verdict.
