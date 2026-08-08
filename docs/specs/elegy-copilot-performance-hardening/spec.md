---
spec_id: elegy-copilot-performance-hardening
title: Elegy Copilot Performance Hardening
status: implemented
type: feature
updated: 2026-08-08
---

# Elegy Copilot Performance Hardening

## Intent

Keep the desktop shell responsive while expensive local inventory, CLI, GitHub, and multi-repository work completes, without removing features or weakening fresh-state safety checks.

## Context Evidence

- `docs/system/copilot-ui-guide.md` defines the desktop shell and current UI surfaces.
- `docs/system/ui-development-governance.md` requires rendered evidence for user-visible UI changes.
- `docs/system/repo-operations-safety-adr.md` requires fresh state for repository mutations.
- Planning measurements found synchronous CLI and GitHub probes delaying unrelated health requests by seconds, a 2,993-session Runtime payload, an uncached 60-repository overview, and Mermaid in the initial build graph.

## Requirements

### Responsive backend

- Read and status routes MUST NOT execute blocking subprocesses on the Node event loop.
- Expensive probes MUST use bounded asynchronous processes, output limits, cancellation, in-flight deduplication, and short-lived caches whose keys include repository context when relevant.
- Runtime diagnostics MUST remain local and in-memory and MUST record only methods, registered route templates, counts, and duration aggregates.

### Progressive data surfaces

- Runtime inventory MUST expose summary and snapshot-scoped paginated APIs, default to 100 rows, and retain the legacy full response for compatibility only.
- Git and checks MUST expose completed local sections before remote GitHub work finishes and MUST preserve successful sections when another section fails.
- Repo Operations MUST display a local last-successful snapshot before starting a background fresh scan, while every mutation continues to perform the canonical fresh revalidation.

### Responsive shell

- Lazy routes MUST render an immediate visible fallback rather than a blank content area.
- Mermaid and inactive Settings panels MUST NOT be part of the initial application dependency graph.
- Heavy polling MUST pause while its surface is hidden, prevent overlap, and avoid publishing unchanged state.
- Hashed static assets MAY use immutable browser caching; HTML and unhashed resources MUST remain uncached.

### Performance budgets

- A deterministic slow read probe MUST delay a concurrent `/api/health` request by no more than 500 ms, with a normal target of 250 ms.
- Warm Runtime summary and cached Repo Operations responses MUST complete within 300 ms and 500 ms respectively in deterministic tests.
- Runtime pages MUST contain at most 100 rows by default, at most 200 when requested, and remain below 100 KB for the representative fixture.
- Local Git state MUST become usable before deferred remote GitHub data and within one second in the deterministic cold fixture.

## Non-Goals

- Removing features, redesigning the UI, or broadly restructuring CSS.
- External analytics, persistent request traces, or collection of repository paths in diagnostics.
- Using cached repository state to authorize checkout, pull, merge, repair, deletion, push, or other mutations.
- Breaking existing API response shapes; new routes and fields are additive.

## Acceptance Checks

- Slow CLI and GitHub probes do not block concurrent health requests and honor timeout, cancellation, cache, and deduplication behavior.
  → verify: `node --test copilot-ui/lib/asyncProcess*.test.js copilot-ui/tests/*performance*.test.js`
- Runtime summary and pagination handle a 3,000-session fixture without returning or mounting the full list.
  → verify: `node copilot-ui/routes/dashboard.test.js && npm --prefix copilot-ui run test:vitest`
- Git/checks render local success independently of delayed or failed GitHub data.
  → verify: `npm --prefix copilot-ui run test:vitest`
- Repo Operations restores, refreshes, atomically persists, and rejects incompatible cached snapshots while mutation routes retain fresh-state checks.
  → verify: `node copilot-ui/lib/repoOperationsService.test.js && node copilot-ui/routes/repoOperations.test.js`
- The production entry graph excludes Mermaid, lazy routes show a fallback, and hashed asset responses are immutable.
  → verify: `npm --prefix copilot-ui run ui:build && npm run ui:check`
- Canonical documentation and the integrated repository checks remain valid.
  → verify: `npm run docs:check:links && npm run ci:local`

## Implementation Links

- `docs/specs/elegy-copilot-performance-hardening/plan.md`
- `docs/system/copilot-ui-guide.md`
- `copilot-ui/server.js`
- `copilot-ui/ui/src/App.tsx`

## Validation Evidence

- Async-process, diagnostics, Runtime pagination, quality/checks, and Repo Operations service/route tests pass, including bounded slow-probe responsiveness and cache credential redaction.
- The complete UI suite passes (67 files, 561 tests), the production UI build passes, and the entry HTML contains no Mermaid preload.
- Repository-owned rendered UI checks pass for Settings, Runtime/Repo Operations, Workspace Git, and Workspace Checks; `desktop:check` passes.
- Documentation link/graph validation and `npm run ci:local` pass.

## Drift Notes

- Direct in-app browser inspection of the local adapter was blocked by the client, so repository-owned rendered UI checks and the native desktop validation lane provide the implementation evidence.
