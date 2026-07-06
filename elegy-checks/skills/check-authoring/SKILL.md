---
name: check-authoring
description: "Register or improve local check definitions through `.elegy/checks.json` and the elegy-checks CLI."
tags: [checks, validation, authoring]
---

# Check Authoring

Use this skill when a repo needs a new local check or a better check definition.

## Workflow

1. Read `.elegy/checks.json` when it exists.
2. If only `.copilot/commit-checks.json` exists, run `elegy-checks init --repo <root> --import-copilot`.
3. Add simple checks with:

```bash
elegy-checks register --repo <root> --check <id> --command "<command>" --profile <profile>
```

4. For complex metadata, edit `.elegy/checks.json` directly.
5. Run `elegy-checks validate --repo <root> --json`.

## Rules

- Keep commands local and deterministic.
- Put expensive checks outside the default `commit` profile.
- Map CI jobs with `ciWorkflow` and `ciJob` when local parity exists.
- Use `ciRemoteOnly` only with a concrete reason.
