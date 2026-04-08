---
created: 2026-04-08
updated: 2026-04-08
category: system
status: current
doc_kind: node
id: testing-quality-governance
summary: Canonical contract for preserving meaningful test coverage and resisting confidence-reducing test weakening.
tags: [testing, quality, governance, validation]
related: [validation-governance, reviewer-lane-governance, testing-and-e2e]
---

# Testing Quality Governance

## Purpose

Define the canonical contract for test quality across validation lanes.

## Core Rules

1. Passing tests are evidence, not the objective.
2. Tests must cover real behavior plus meaningful failure paths, edge cases, and regression-prone boundaries.
3. Do not weaken, narrow, or remove tests merely to make the suite pass.
4. Removing or relaxing an assertion requires replacement coverage that preserves or improves confidence.
5. When product behavior legitimately changes, update tests to match the new contract, but preserve the original hard-case intent or explain the new boundary explicitly.
6. Shallow green-only coverage is not sufficient when the changed behavior has meaningful failure modes or edge conditions.

## What Counts As Weakening

Treat these as confidence-reducing changes unless replacement coverage clearly restores the lost intent:

- deleting a test that covered a real risk
- removing assertions without adding equivalent or stronger checks
- narrowing fixtures or inputs so the hard case is no longer exercised
- converting behavioral assertions into implementation-detail checks that no longer prove the user-visible or contract-visible outcome
- updating snapshots, baselines, or expected values without checking whether the prior failure exposed a real regression

## Acceptable Test Updates

Test updates are expected when:

- the product contract changed intentionally
- the previous test encoded the wrong expectation
- coverage is being rewritten into a more direct or more durable form

In those cases, keep or replace the prior confidence target:

- preserve hard-case coverage when the risk still exists
- if the boundary truly changed, state what is no longer in scope and what now proves correctness
- prefer stronger behavioral coverage over easier-to-maintain but weaker checks

## Lane Applicability

This policy applies across:

- unit validation
- integration validation
- browser/E2E validation
- reviewer lanes evaluating test adequacy or confidence
- implementation lanes changing product code together with tests

## Review Expectations

When a change touches tests, reviewers and implementers should ask:

- does this still prove the intended behavior?
- did any meaningful failure or edge-case coverage disappear?
- was any assertion relaxed, and if so, what replaced that confidence?
- does the updated suite reflect the real product contract rather than only producing green results?

## References

- `docs/system/validation-governance.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/mocs/testing-and-e2e.md`
