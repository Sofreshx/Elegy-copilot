---
name: check-running
description: "Run local checks with elegy-checks and preserve run evidence."
tags: [checks, test, validation, run]
---

# Check Running

Use `elegy-checks run` for local proof.

## Commands

```bash
elegy-checks run --repo <root> --profile commit --json
elegy-checks run --repo <root> --profile ci-local --json
elegy-checks run --repo <root> --check <check-id> --json
```

## Reporting

Report:

- profile or check run
- run id
- pass/fail
- blocking failures
- failing command summary
- log retrieval command when failures need inspection

Do not claim validation confidence when no checks ran.
