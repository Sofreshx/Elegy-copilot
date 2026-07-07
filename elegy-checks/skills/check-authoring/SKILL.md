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
3. Run `elegy-checks audit --repo <root> --json` to see check-pack recommendations.
4. Apply selected built-in recommendations with:

```bash
elegy-checks apply --repo <root> --proposal <pack/check> --json
```

5. Add simple custom checks with:

```bash
elegy-checks register --repo <root> --check <id> --command "<command>" --profile <profile>
```

6. For complex metadata, edit `.elegy/checks.json` directly.
7. Run `elegy-checks validate --repo <root> --json`.

## Rules

- Keep commands local and deterministic.
- Put expensive checks outside the default `commit` profile.
- Map CI jobs with `ciWorkflow` and `ciJob` when local parity exists.
- Use `ciRemoteOnly` only with a concrete reason.
- Start governance, docs, specs, and instruction-surface checks as `advisory` unless the repo has an explicit blocking policy.
