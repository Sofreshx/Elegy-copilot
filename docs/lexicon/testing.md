---
created: 2026-06-03
updated: 2026-06-30
category: lexicon
status: current
doc_kind: node
id: testing-glossary
summary: Glossary of software testing types, quality concepts, and verification approaches.
tags: [lexicon, testing, quality]
---

# Testing & Quality

## Test Types

### Unit Test
**Definition:** A test that verifies the smallest testable part of a system (a function, method, or class) in isolation, with external dependencies mocked or stubbed.
**Usage:** Use for fast, deterministic feedback on individual units of code. Should run in milliseconds and be the largest category in the test pyramid. Distinguish from Integration Test (verifies interactions between units).
**Related:** Integration Test (multiple units), Test Double (mock/stub), Test Pyramid (test distribution), FIRST Principles (Fast, Isolated, Repeatable, Self-validating, Timely)
**Tags:** testing, unit-test

### Integration Test
**Definition:** A test that verifies how multiple units or modules work together, often involving real dependencies (database, network, file system).
**Usage:** Use to catch interface mismatches, integration errors, and contract violations between components. Slower than unit tests, fewer in number. Distinguish from E2E Test (full system, production-like) and Unit Test (single unit, isolated).
**Related:** Unit Test (single unit, isolated), E2E Test (full system), Contract Test (API boundaries), Spring Integration Test (framework)
**Tags:** testing, integration-test

### End-to-End (E2E) Test
**Definition:** A test that exercises the complete system from the user's perspective — UI, API, database, external services — in a production-like environment.
**Usage:** Use for critical user journeys that must work end-to-end. Slowest and most fragile test type. Smallest count in the test pyramid. Distinguish from Integration Test (subset of system) — E2E covers the full stack.
**Related:** Integration Test (partial), UI Test (E2E sub-type), Test Pyramid (at the top), Cypress/Playwright (E2E tools)
**Tags:** testing, e2e

### Snapshot Test
**Definition:** A test that captures the output of a component or function and compares future runs against the stored snapshot, flagging unexpected changes.
**Usage:** Use for detecting unintended UI changes or function output changes. Useful for regression detection but fragile — snapshots need careful review. Distinguish from Visual Regression Test (pixel-level, rendering-based).
**Related:** Visual Regression (pixel comparison), Golden Test (expected file), Approval Test (human-approved snapshot)
**Tags:** testing, snapshot-test

### Visual Regression Test
**Definition:** A test that compares screenshots of UI components pixel-by-pixel against baseline images, detecting visual differences.
**Usage:** Use for catching unintended visual changes in UI. Requires a baseline image per component/test. More reliable than Snapshot Tests for visual content but slower and infrastructure-heavy.
**Related:** Snapshot Test (DOM/text comparison), Visual Diff (the comparison), Percy/Chromatic (visual testing tools)
**Tags:** testing, visual-regression

### Contract Test
**Definition:** A test that verifies an API or service adheres to its contract (expected request/response shapes), ensuring compatibility between consumers and providers.
**Usage:** Use for microservice boundaries and third-party API integrations. Each service tests that it can produce/consume the shared contract. Distinguish from Integration Test (runtime interop) — Contract Test validates interface agreement.
**Related:** Consumer-Driven Contract (CDC), Pact (contract testing tool), OpenAPI (contract format), API Gateway (contract enforcement)
**Tags:** testing, contract-test

### Performance Test
**Definition:** A test that measures system speed, responsiveness, and stability under a specific workload — often categorized as load, stress, endurance, or spike testing.
**Usage:** Use to validate performance requirements, find bottlenecks, and ensure the system handles expected traffic. Distinguish from Load Test (expected load) and Stress Test (beyond expected).
**Related:** Load Test (expected traffic), Stress Test (breaking point), Endurance Test (sustained load), Spike Test (sudden traffic burst)
**Tags:** testing, performance-test

### Smoke Test
**Definition:** A minimal set of tests that verify the most critical functionality works after a deployment, providing quick confidence before deeper testing.
**Usage:** Run as the first step in deployment validation. If smoke tests fail, abort the deployment. Distinguish from Sanity Test (narrower, more focused) — Smoke tests are broad but shallow.
**Related:** Sanity Test (narrower focus), Health Check (system alive), Deployment Validation (smoke as gate)
**Tags:** testing, smoke-test

### Acceptance Test
**Definition:** A test that verifies the system meets business requirements from the user's perspective, often written in domain language (Given-When-Then).
**Usage:** Use to validate that a feature satisfies its requirements. Acceptance tests serve as living documentation and the definition of done. Distinguish from Unit Test (developer-focused) — Acceptance tests are business-focused.
**Related:** BDD (Given-When-Then format), ATDD (acceptance test driven), User Story (the requirement), Definition of Done (acceptance gate)
**Tags:** testing, acceptance-test

## Methodologies

### TDD (Test-Driven Development)
**Definition:** A development practice where you write a failing test first, then write minimal code to pass it, then refactor — red, green, refactor.
**Usage:** Apply for bug fixes or well-understood features. Produces testable, well-designed code and a regression safety net. Distinguish from BDD (behavior-focused, business-readable) — TDD is developer-focused.
**Related:** Red-Green-Refactor (the cycle), BDD (business-readable), ATDD (acceptance test first), Test Coverage (byproduct)
**Tags:** testing, tdd

### BDD (Behavior-Driven Development)
**Definition:** An extension of TDD using natural language (Given-When-Then) to specify behavior, bridging communication between developers, testers, and domain experts.
**Usage:** Use when collaboration between technical and non-technical stakeholders is critical. Scenarios are executable tests. Distinguish from TDD (developer-focused tests) — BDD uses business-readable scenarios.
**Related:** TDD (developing-focused), Given-When-Then (scenario format), Cucumber (BDD tool), Feature File (scenario file)
**Tags:** testing, bdd

### Test Pyramid
**Definition:** A concept showing the ideal distribution of tests: many unit tests at the base, fewer integration tests in the middle, few E2E tests at the top.
**Usage:** Use as a guideline for test strategy. The pyramid shape reflects speed and cost — unit tests are fast and cheap, E2E tests are slow and expensive. Distinguish from Test Trophy (includes static analysis, smaller E2E focus).
**Related:** Test Trophy (alternative), Unit Test (base), Integration Test (middle), E2E Test (top), Honeycomb (alternative for microservices)
**Tags:** testing, methodology, test-pyramid

### Test Trophy
**Definition:** An alternative to the Test Pyramid, emphasizing static analysis, unit tests, integration tests (largest set), and a small number of E2E tests.
**Usage:** More realistic for modern applications where integration tests are the most valuable category. Integration tests catch real issues (config, data, contract) that unit tests miss.
**Related:** Test Pyramid (the original), Static Analysis (lint, types), Integration Test (largest in Trophy), E2E Test (smallest)
**Tags:** testing, methodology, test-trophy

## Coverage

### Code Coverage
**Definition:** A metric measuring which lines, branches, or paths in code are executed during testing, expressed as a percentage.
**Usage:** Use to find untested code, not as a quality target. 100% coverage doesn't mean good tests — it means every line was executed, not that every scenario was verified. Distinguish from Mutation Testing (tests the tests).
**Related:** Line Coverage (simplest), Branch Coverage (decisions tested), Path Coverage (all paths), Mutation Testing (tests the tests)
**Tags:** testing, coverage

### Mutation Testing
**Definition:** A technique that introduces small changes (mutations) to code and checks whether tests detect the change — surviving mutations indicate untested behaviors.
**Usage:** Use to evaluate test quality, not just coverage. A test suite that passes with mutations has weak assertions. Distinguish from Code Coverage (lines executed) — Mutation tests whether tests actually catch faults.
**Related:** Mutant (changed code), Killed (test caught it), Survived (test missed it), Coverage (narrower metric)
**Tags:** testing, mutation-testing

## Test Doubles

### Mock
**Definition:** A test double that verifies interactions — whether a method was called, with what arguments, how many times — using pre-programmed expectations.
**Usage:** Use for behavior verification (was X called?). Distinguish from Stub (returns predefined data, no interaction verification) — Mocks assert on calls; Stubs provide values.
**Related:** Stub (data provider), Fake (working implementation), Spy (wraps real object), Expectation (what mock verifies)
**Tags:** testing, test-doubles, mock

### Stub
**Definition:** A test double that returns predefined data in response to calls, without verifying how many times or how it was called.
**Usage:** Use when you need a dependency to return specific values for the test scenario. Distinguish from Mock (verifies interactions) — Stubs only provide data; Mocks verify behavior.
**Related:** Mock (behavior verification), Fake (working implementation), Spy (record calls), Fixture (static test data)
**Tags:** testing, test-doubles, stub

### Fake
**Definition:** A test double with a working (but simplified) implementation — an in-memory database instead of a real one, a `HashMap` instead of a real cache.
**Usage:** Use when a real dependency is too slow, unavailable, or unreliable for testing. A fake behaves like the real thing but is simpler. Distinguish from Mock/Stub (no real behavior) — Fake has actual working logic.
**Related:** Mock (no real behavior), Stub (no real behavior), In-Memory Database (common fake), Test Environment (broader)
**Tags:** testing, test-doubles, fake

### Test Double
**Definition:** A generic term for any object used in place of a real dependency during testing — includes mocks, stubs, fakes, spies, and dummies.
**Usage:** Use as the umbrella term when discussing testing techniques. Distinguish between types based on whether they provide data (stub), verify calls (mock), or have working logic (fake).
**Related:** Mock (interaction verification), Stub (data provision), Fake (working implementation), Spy (call recording)
**Tags:** testing, test-doubles

## Quality

### Linting
**Definition:** Automated static analysis that checks code for style violations, potential bugs, and anti-patterns without executing it.
**Usage:** Use to enforce code style consistency and catch common errors before code review. Should run on every commit. Distinguish from Formatting (whitespace, indentation) and Type Checking (type errors).
**Related:** Formatting (auto-fixable style), Static Analysis (broader analysis), Linter (the tool: ESLint, Pylint), Pre-commit Hook (enforcement)
**Tags:** testing, quality, linting

### Static Analysis
**Definition:** Analysis of source code without executing it, detecting potential bugs, security vulnerabilities, and maintainability issues.
**Usage:** Use for catching issues that dynamic testing might miss — null pointer dereferences, resource leaks, type mismatches, security vulnerabilities. Run in CI.
**Related:** Linting (style-focused static analysis), Type Checking (static type analysis), Dataflow Analysis (runtime path analysis), Soundness (no false negatives)
**Tags:** testing, quality, static-analysis

### Code Review
**Definition:** The practice of having other team members examine code changes before merging, catching issues and sharing knowledge.
**Usage:** Use for quality assurance and knowledge sharing. Every change should be reviewed. Best practices: small, focused PRs; constructive comments; automated checks before human review.
**Related:** Pull Request (review mechanism), Pair Programming (real-time alternative), Review Gate (blocking review), Ship/Show/Ask (review type)
**Tags:** testing, quality, code-review

### Technical Debt
**Definition:** The implied cost of choosing an easy, quick solution now instead of a better approach that would take longer — analogous to financial debt with interest.
**Usage:** Use to describe code quality shortcuts and their consequences. Technical debt accrues interest (harder maintenance, slower development) and must be paid down. Distinguish from Tech Lead (intentional vs accidental).
**Related:** Refactoring (paying down debt), Code Smell (debt indicator), Accidental Debt (unintentional), Intentional Debt (strategic choice)
**Tags:** testing, quality, technical-debt

### Code Smell
**Definition:** A surface-level indicator of deeper code quality problems — long methods, large classes, too many parameters, duplicated code — suggesting the need for refactoring.
**Usage:** Use to identify code that may need refactoring. A smell is not a bug but a warning sign. Distinguish from Anti-pattern (proven wrong solution) — Code Smell is a symptom; Anti-pattern is the wrong pattern itself.
**Related:** Technical Debt (the cost), Refactoring (the fix), Anti-pattern (the wrong solution), Cyclomatic Complexity (complexity metric)
**Tags:** testing, quality, code-smell

### Cyclomatic Complexity
**Definition:** A metric measuring the number of linearly independent paths through source code, calculated from decisions (if, while, case).
**Usage:** Use to identify overly complex code. Higher cyclomatic complexity means harder to test, understand, and maintain. Aim for <10 per function. Distinguish from Cognitive Complexity (how hard humans find it).
**Related:** Cognitive Complexity (human readability), Code Coverage (test completeness), McCabe Metric (the original name)
**Tags:** testing, quality, cyclomatic-complexity
