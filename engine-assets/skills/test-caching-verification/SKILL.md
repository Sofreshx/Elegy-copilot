---
name: test-caching-verification
description: "Anti-hallucination verification for test execution. Mandates extraction and validation of evidence files produced by the test ledger wrapper. Use this whenever running unit or integration tests via the ledger wrapper."
---

# Test Caching & Verification Skill

## When to Use (LLM Routing Guide)
- Running unit tests via the test ledger wrapper (`npm test`, `npm run test`)
- Verifying test execution actually occurred (anti-hallucination)
- Interpreting cached vs executed test results
- Using `--force` to bypass test caching

## When NOT to Use
- Running tests outside the ledger wrapper (e.g., direct `dotnet test`)
- Writing or modifying test code (use `testing-dotnet-unit` or `testing-frontend-unit`)
- Debugging test failures (use `debug`)

## Hard Rules (Non-Negotiable)

### 1. Evidence Marker Extraction
After every test run, the wrapper prints exactly one marker to stdout:
```
[TEST-LEDGER-EVIDENCE] /absolute/path/to/evidence.json
```

You MUST:
1. Search the terminal output for this exact marker prefix.
2. Verify **exactly one** marker exists. If zero or more than one, treat it as a failed run.
3. Extract the absolute file path from the marker.

### 2. Evidence Path Validation
Before reading the evidence file, validate:
- The path uses forward slashes only (no backslashes).
- The path resides strictly within `.tmp/llm-output/` (under the workspace root).
- The filename matches the prefix `test-run-evidence-`.
- The path matches the current run ID if available.

If any validation fails, do NOT read the file. Report the run as unverifiable.

### 3. Evidence File Reading
Use the `read_file` tool to read the evidence JSON file at the exact extracted path. Never guess, infer, or fabricate the file contents.

The evidence file contains:
```json
{
  "schemaVersion": "v1",
  "runId": "run-<timestamp>-<random>",
  "testFilePath": "/absolute/path/to/test.js",
  "cacheDecisionReason": "cache hit | cache miss: no valid cache entry | cache miss: uncacheable (fail-safe)",
  "wasCached": true | false,
  "result": { "success": true | false, "durationMs": 123 },
  "timestamp": 1234567890
}
```

### 4. Result Interpretation
- `wasCached: true` + `result.success: true` → Test was skipped because it passed previously and nothing changed.
- `wasCached: false` + `result.success: true` → Test was actually executed and passed.
- `wasCached: false` + `result.success: false` → Test was actually executed and failed.
- Missing result or malformed evidence → Treat as unverifiable. Report failure.

### 5. Evidence Cleanup (TMP-CTRL-004)
After reading and verifying the evidence file, you MUST delete it to comply with the temp file safety controls. Use the terminal to remove it:
```
rm <evidence-path>
```

### 6. Exit Code Precedence
The wrapper enforces this exit code precedence:
1. If evidence generation itself fails → exit 255 (hard failure, regardless of test outcome).
2. Otherwise → propagates the underlying test runner's exit code (0 = pass, non-zero = fail).

A zero exit code alone is NOT sufficient proof of test success. You must corroborate with the evidence file.

## Force Flag
To bypass the cache entirely and run all tests:
```
npm test -- --force
```

Use `--force` when:
- Global config files changed (tsconfig, jest.config, etc.)
- Lock files changed (package-lock.json)
- You suspect stale cache entries
- Running on CI main/nightly builds

## Workspace Test Commands

| Workspace | Command | Runner |
|-----------|---------|--------|
| RannIA | `cd RannIA && npm test` | Mocha (VS Code extension host) |
| local-tracker | `cd local-tracker && npm test` | Jest |
| copilot-ui | `cd copilot-ui && npm test` | Node.js (custom) |
| scripts | `cd scripts && npm test` | Node.js (custom) |

## Workflow Summary
1. Run the test command.
2. Find the `[TEST-LEDGER-EVIDENCE]` marker in stdout.
3. Validate the path (within `.tmp/llm-output/`, correct prefix).
4. Read the evidence file with `read_file`.
5. Interpret the results.
6. Delete the evidence file.
7. Report pass/fail with evidence-backed data.
