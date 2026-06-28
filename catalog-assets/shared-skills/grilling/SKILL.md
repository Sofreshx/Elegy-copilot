---
name: grilling
description: "Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, mentions 'grill', 'grill me', 'interview me', or wants to resolve implementation-blocking decisions in a design. Also reachable from other skills that need a structured questioning loop."
license: Apache-2.0
metadata: {"source":"https://github.com/mattpocock/skills","adapted":true,"originalName":"grilling"}
---

# Grilling

A relentless one-question-at-a-time interview that walks the design tree until every implementation-blocking decision is resolved.

## Precondition

Before grilling about a codebase-specific topic, read the repo's canonical docs so questions use the project's domain vocabulary. Check ADRs for architectural decisions in the area.

## Process

Interview the user relentlessly about every implementation-blocking aspect of the plan or design until reaching a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions **one at a time**, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

## Completion criterion

Every branch of the design tree has been walked. No unanswered questions remain that would block implementation.

## References

- Canonical docs: follow the harness instructions' repo discovery chain
- Architectural decisions: `docs/system/adr/`
- Companion skills: `domain-modeling` (update docs inline during grilling), `rubberduck-plan-review` (adversarial review after grilling)

## Boundaries

This skill asks exploratory questions to build shared understanding. It is not an adversarial review — for that, use `rubberduck-plan-review` after grilling. It is model-invoked so it can be reached by other skills (like `improve-codebase-architecture` or `domain-modeling`) that need a structured interview loop.
