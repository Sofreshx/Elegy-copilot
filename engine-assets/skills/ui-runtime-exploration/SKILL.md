---
name: ui-runtime-exploration
description: "Route Tauri/browser UI work to the right runtime lane: Playwright CLI, agent browser, tauri-driver/WebDriver, or Rust mock tests. Triggers on: tauri ui, hot reload, HMR, agent-browser, playwright, webdriver, selenium, desktop E2E, tauri-driver, browser ui validation, ui runtime."
tags: [ui, tauri, testing, browser, webdriver, playwright, runtime]
---

# Tauri UI Runtime Exploration

## Purpose

Route browser/Tauri UI investigation and test decisions to the correct runtime lane. Prevents agents from choosing the wrong tool (e.g. agent browser for CI gates, Playwright for native WebView behavior) and avoids interactive/watch-mode anti-patterns in deterministic contexts.

This skill is a decision router. It does not execute tests — it resolves the correct lane and surfaces the tool, command pattern, and caveats for the active scenario.

## When To Use

Use when the task involves:

- deciding how to validate or investigate a Tauri UI surface
- choosing between Playwright, agent browser, tauri-driver, or Rust mock tests
- setting up or debugging browser-mode UI tests for a Tauri app
- investigating a UI bug in a Tauri desktop or browser context
- determining the right CI validation lane for UI changes
- questions about hot reload / HMR behavior in Tauri
- desktop E2E or WebDriver routing decisions

## Decision Matrix

| Scenario | Tool | Why |
|---|---|---|
| Fast UI regression in browser mode | Playwright CLI (`npx playwright test`) | Deterministic, CI-compatible, headless |
| AI bug investigation / agent-driven exploration | Agent browser | Snapshot-first, exploratory, not CI-gated |
| Real Tauri desktop app behavior | tauri-driver + Selenium/WebDriverIO | Native WebView, real IPC, desktop context |
| Rust/Tauri command proof | cargo test + Tauri mock runtime | No UI needed, deterministic |
| Stable CI signal | Deterministic tests (not agent-browser) | Must not hang, must be reproducible |

## Lane Details

### Playwright (Browser Mode)

Use for fast, deterministic browser-mode UI regression. Runs headless via `npx playwright test`.

```bash
# Run all browser-mode tests
npx playwright test --project=browser

# Run a specific spec file
npx playwright test tests/ui/login.spec.ts --project=browser

# Run with trace on failure
npx playwright test --project=browser --trace on
```

**Anti-patterns:**
- Do NOT use `--headed` or `--ui` (watch mode) in CI or automated sessions — those are interactive only.
- Do NOT use Playwright to test native Tauri WebView behavior — Playwright drives a real browser, not the Tauri runtime.
- Do NOT run full suites without `--project=browser` — Playwright may default to a non-browser project that cannot launch.

### Agent Browser (Browser Mode)

Use for AI-driven exploratory investigation. Snapshot-first, interactive, not CI-gated.

- Acceptable for: finding selectors, inspecting DOM state, reproducing flaky failures.
- NOT acceptable for: CI gates, regression suites, deterministic pass/fail signals.
- Prefer single-page or focused-component snapshots over multi-step flows.

**Anti-patterns:**
- Do NOT add agent-browser tests to CI pipelines — they may hang or produce non-reproducible results.
- Do NOT use agent browser when a deterministic Playwright test would suffice — agent browser is for exploration, not coverage.

### tauri-driver / WebDriver (Desktop)

Use for testing real Tauri desktop application behavior: native WebView, real IPC, file system dialogs, window management, and OS integration.

```bash
# Start tauri-driver (separate terminal or background process)
cargo tauri driver

# Run WebDriverIO test suite (example)
npx wdio run wdio.conf.ts
```

**Preconditions:**
- `tauri-driver` must be installed (`cargo install tauri-driver`).
- The Tauri app must be built and available at the expected binary path.
- WebDriverIO or Selenium client must be configured with `tauri-driver` capabilities.

**Anti-patterns:**
- Do NOT use tauri-driver for browser-only behavior (use Playwright).
- Do NOT run in headed/watch mode for automated suites.
- macOS desktop E2E via tauri-driver is experimental — prefer Windows for reliable native testing.

### Rust / Tauri Mock Tests

Use for proving Rust-side Tauri command logic without launching any UI.

```bash
# Run all tests with Tauri mock runtime
cargo test --features mock-runtime

# Run a specific command test
cargo test --features mock-runtime cmd::handle_login
```

**Guidance:**
- Use `tauri::test::mock_context()` or `tauri::test::mock_app()` to simulate the Tauri runtime.
- Test command handlers, state mutations, and IPC response shapes.
- No UI, no browser, no WebView needed — fastest feedback loop for command logic.

**Anti-patterns:**
- Do NOT use Rust mock tests to verify UI rendering or CSS — those belong in Playwright or WebDriver lanes.
- Do NOT skip mock tests for command logic even when E2E tests exist — mock tests are faster and more deterministic.

### CI Validation (Deterministic Tests)

Use for stable CI signal that must not hang, must be reproducible, and must produce clear pass/fail output.

```yaml
# Example CI step (GitHub Actions)
- name: UI regression tests
  run: npx playwright test --project=browser --reporter=github

- name: Rust command tests
  run: cargo test --features mock-runtime
```

**Rules:**
- CI lanes must use deterministic tests only — no agent browser, no interactive mode.
- Prefer Playwright browser-mode tests for UI signal.
- Prefer `cargo test` for Tauri command signal.
- CI must fail closed on test failure, timeout, or infrastructure error.

**Anti-patterns:**
- Do NOT add agent-browser or interactive Playwright to CI.
- Do NOT run full desktop E2E suites as required CI gates — they are too slow and fragile. Reserve them for nightly or pre-release.
- Do NOT use `--headed`, `--ui`, or `--watch` flags in CI commands.

## Do Not Use

- **Component building or UI creation** — use `ui-system` skill instead. This skill does not help build components, choose design tokens, or navigate the component tree.
- **Spec-driven development** — use `spec-dev` / `spec-authoring` for spec-first contract work.
- **Security review** — use `security` for vulnerability assessment.
- **Backend, CLI, schema, or pure data work** with no UI surface.
- **General testing strategy** outside Tauri/browser UI contexts.

## Routing Rule

Preserved verbatim from the canonical decision contract:

```
Fast UI regression        -> Playwright in browser mode
AI bug investigation      -> agent browser in browser mode
Real Tauri app behavior   -> tauri-driver + Selenium/WebdriverIO
Rust/Tauri command proof  -> cargo test + Tauri mock runtime
Stable CI signal          -> deterministic tests, not agent-browser
```

## Operating Rules

1. Identify the UI scenario from the routing rule — classify the task into exactly one of the five lanes.
2. If unsure whether a scenario is "fast regression" or "real Tauri behavior", default to the browser vs. desktop distinction: does the test need native WebView / real IPC?
3. Load the lane guidance under ## Lane Details for the classified lane.
4. For Playwright and tauri-driver lanes, check preconditions (binaries, config, build artifacts) before running commands.
5. For agent browser lane, confirm the task is exploratory and not a CI gate before proceeding.
6. For CI validation lane, verify the selected test tool supports the `--reporter`, `--json`, or equivalent non-interactive output format.
7. Output a `UI_RUNTIME_ROUTE` block with the decision and evidence.
8. If no lane fits cleanly, surface the ambiguity — do not force-fit.

## Output Contract

Return this exact structure:

```text
UI_RUNTIME_ROUTE
- decision: "playwright" | "agent-browser" | "tauri-driver" | "rust-mock" | "ci-deterministic"
- tool: <tool name and version if known>
- rationale: <which routing rule matched and why>
- caveats:
  - <precondition or limitation>
- estimated_feedback_time: <seconds or minutes>
```

If a caveats item is not applicable, write `- none` rather than omitting the section.

## Acceptance Checks

- [ ] Every UI investigation task is assigned to exactly one of the five routing lanes
- [ ] Agent browser is never used for CI gates
- [ ] Playwright is never used for native Tauri WebView behavior
- [ ] tauri-driver/WebDriver decisions include desktop preconditions check
- [ ] Rust mock test decisions include a note that no UI is tested
- [ ] CI validation lane decisions reference a deterministic tool and non-interactive output format
- [ ] The "do not displace ui-system" constraint is respected — component building flows to ui-system, not here

## Limitations

- Does **not** provide app-specific Playwright configs, page objects, or test fixtures.
- Does **not** set up or configure WebDriverIO / Selenium suites — only routes to the lane.
- Does **not** include HMR or hot-reload debugging scripts — those are app-specific.
- Does **not** enforce test-id coverage or accessibility rules — those belong in the test suite itself.
- Does **not** replace the `ui-system` skill for component identification, design-token decisions, or story creation.
- Windows-first Tauri behavior is the default. macOS desktop E2E via tauri-driver is experimental.
- Does **not** change copilot-ui runtime behavior. See ## Follow-Up Pilot Boundaries for deferred items.
- The routing decision is a recommendation. The agent must verify preconditions before executing.

## Follow-Up Pilot Boundaries

This first setup slice is deliberately minimal. These items are deferred to later, repo-specific work points:

| Deferred Item | Why Deferred | Recommended Approach |
|---|---|---|
| copilot-ui dev/HMR improvements | App-specific hot reload behavior | Use this skill to route, then implement per-app |
| Real WebDriver smoke setup | Requires tauri-driver + WebDriver dependencies | `cargo install tauri-driver` + WebDriverIO/Selenium project |
| Stable test-id coverage | Needs `data-testid` audit of copilot-ui components | Add test-ids incrementally, validate with Playwright |
| Third-party Tauri automation evaluation | cargo-tauri-mock, tauri-automation, etc. | Evaluate against routing matrix before adopting |
| macOS desktop E2E | Experimental until separately proven | Windows-first Tauri behavior is the default |

## Canonical References

- `docs/system/e2e-setup-guide.md`
- `docs/system/mocs/testing-and-e2e.md`

Base directory for this skill: file:///C:/Users/lolzi/Documents/GitHub/instruction-engine/engine-assets/skills/ui-runtime-exploration
