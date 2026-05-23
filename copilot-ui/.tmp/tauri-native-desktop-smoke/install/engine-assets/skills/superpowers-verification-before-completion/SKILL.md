---
name: superpowers-verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

**Lane-aware rule:** Fresh verification evidence is mandatory in every lane. Validation-specific lanes own proving test/lint/build execution and may run the narrowest relevant command directly. All other lanes must delegate proving execution to the appropriate runner lane and inspect its returned output before making any success claim.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you do not have fresh verification output from this work cycle—either from the active validation lane or from the appropriate runner lane—you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim, and is the current lane the validation lane allowed to own that proof?
2. RUN/DELEGATE: If yes, run the narrowest relevant proving command in this validation lane; otherwise delegate to the appropriate runner lane
3. READ: Full returned output, check exit code, count failures
4. INSPECT: If tests changed, did the proof stay as strong as before?
   - If a hard test was deleted, narrowed, or relaxed, green is not enough
   - If behavior changed intentionally, confirm stronger replacement coverage exists
5. VERIFY: Does output confirm the claim?
    - If NO: State actual status with evidence
    - If YES: State claim WITH evidence
6. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Fresh test output from the validation lane or runner lane: 0 failures | Previous run, "should pass" |
| Linter clean | Fresh lint output from the validation lane or runner lane: 0 errors | Partial check, extrapolation |
| Build succeeds | Fresh build output from the validation lane or runner lane: exit 0 | Linter passing, logs look good |
| Bug fixed | Fresh evidence that the original symptom test passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified with fresh failure/pass evidence | Test passes once |
| Tests still prove the behavior | Hard case retained or stronger replacement added | Green output after weakening/deleting the test |
| Agent completed | VCS diff plus fresh verification evidence | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Use validation-lane output or request runner lane execution] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Tests changed while fixing a failure:**
```
✅ Keep the hard assertion OR replace it with stronger coverage for the new contract, then get fresh test evidence from the validation lane or appropriate runner lane
❌ Delete the edge-case test, loosen the assertion, rerun, then say "all green"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Get fresh RED evidence (fail) → Implement/restore fix → Get fresh GREEN evidence (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Use validation-lane output or request runner lane execution] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Runner-lane delegation:**
```
✅ Implementation lane requests the appropriate runner lane → Inspect returned command/output/exit status → Report actual state
❌ Skip verification because execution was delegated
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Accepting delegated execution as proof of success

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command only when you are already in the validation lane that owns it; otherwise obtain the runner lane's fresh output. Read the output. Confirm the tests did not get easier. THEN claim the result.

This is non-negotiable.

For the full testing-specific contract, see [Testing Quality Governance](../../../docs/system/testing-quality-governance.md).
