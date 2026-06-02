---
created: 2026-03-28
updated: 2026-04-10
category: research
status: stale
doc_kind: node
id: ui-runtime-overlay-research
summary: Historical research framing for an attach-first UI Runtime Overlay; current runtime behavior authority lives in the canonical copilot-ui docs.
tags: [research, copilot-ui, runtime, overlay, planning]
related: [copilot-ui-guide, copilot-ui-information-architecture-freeze, e2e-setup-guide, planning-backlog-roadmap-contract, workflow-planning-contract]
---

# UI Runtime Overlay Research

This is a historical research note, not the current-state authority. For current runtime and overlay
behavior, use [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md). The repo-local roadmap for this work has been removed — these are old non-accurate goals. Canonical planning lives at `~/.copilot/backlogs/`.

This note is **research, not canonical design**. It turns the original broader idea into a more realistic v1 shape based on the repo's current runtime, planning, and evidence contracts.

## Context and problem statement

The original idea combines several desirable behaviors into one concept: attach to a running UI, annotate what should change, spin up isolated previews, and export planning notes or TODOs. In this repo, that idea is broader than a realistic first implementation.

In practice, it splits into at least three separate product concerns:

1. **Live attach and annotate** against an already running app.
2. **Isolated preview or canvas** for changes that should not hit the main running environment.
3. **Planning and note export** into repo-backed planning or external note surfaces.

Treating those as one product from day one would blur authority boundaries, overload runtime setup, and make evidence collection harder to keep deterministic. A pragmatic v1 should therefore start with the narrowest useful slice: attach to a real hot-reloadable local app, annotate a specific UI element, generate a narrow fix request, validate the change, and optionally emit a planning suggestion.

## Repo constraints that shape the design

Several existing repo decisions strongly shape what is realistic here:

- [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md) defines `copilot-ui` as the current local UI and control plane. That makes a separate standalone "elegy-ui meta app" the wrong default direction.
- [docs/system/copilot-ui-information-architecture-freeze.md](../system/copilot-ui-information-architecture-freeze.md) already consolidates runtime work under `Home / Runtime`, with `Sessions` and `Executor` as the active runtime seams.
- [docs/system/workflow-planning-contract.md](../system/workflow-planning-contract.md) and [docs/system/session-state-artifacts.md](../system/session-state-artifacts.md) keep execution state and plan-pack state distinct from durable planning authority.
- [docs/system/planning-backlog-roadmap-contract.md](../system/planning-backlog-roadmap-contract.md) makes external Obsidian notes explicitly additive and non-canonical.
- [docs/system/e2e-setup-guide.md](../system/e2e-setup-guide.md) and [docs/system/agent-architecture-simplicity.md](../system/agent-architecture-simplicity.md) establish snapshot-first evidence, with screenshots as fallback or explicit-request artifacts.
- Current runtime docs treat sandboxing as an execution context, not a separate primary product frame.

These constraints push the design toward reuse, bounded runtime assumptions, and explicit authority boundaries.

## Option comparison: separate meta app vs copilot-ui-integrated overlay

### Option A: separate "elegy-ui meta app"

Pros:

- Could isolate UI overlay experiments from the current `copilot-ui` shell.
- Could pursue a more canvas-like brand and interaction model.

Cons:

- Duplicates runtime control-plane concerns that `copilot-ui` already owns.
- Introduces another launcher, navigation model, and persistence surface.
- Makes planning handoff, executor reuse, and session evidence harder to keep coherent.
- Encourages over-scoping toward full canvas/builder behavior too early.

Assessment: not recommended for v1.

### Option B: integrate an overlay feature into `copilot-ui`

Pros:

- Reuses the existing runtime shell, route groups, session APIs, executor flows, and planning seams already documented in [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md).
- Fits the current information architecture, where runtime interaction belongs under `Home / Runtime` instead of a separate product.
- Keeps repo selection, session inspection, planning suggestions, and runtime evidence in one control plane.
- Supports later sandbox-backed or preview-backed execution without redefining the product around sandboxing.

Cons:

- Requires careful scoping so the overlay does not bloat `copilot-ui`'s runtime surface.
- Needs a clear contract for what kinds of target apps can be attached in v1.

Assessment: recommended.

## Recommended product framing

The recommended feature name is **UI Runtime Overlay**.

The recommended framing is: a `copilot-ui` runtime capability that can either attach to a live local app or, later, launch an explicitly defined preview environment. It should not be framed as a general-purpose visual builder, a standalone meta app, or a sandbox-first product.

Key framing decisions:

- Start attach-first, not canvas-first.
- Keep sandbox as an optional execution context, not the primary narrative.
- Keep planning export secondary to runtime interaction.
- Prefer narrow change requests over direct visual editing.
- Treat "ghost" behavior as assistive hints, not authoritative editing.

Drag/drop builder behavior is not realistic for phase 1. The first usable product is narrower: select an element, attach an annotation, generate a scoped fix request, run a hot-reload validation loop, and optionally emit a TODO or planning suggestion.

## Proposed modes

The feature should expose exactly two mode names:

- **Attach Mode**
- **Preview Mode**

### Attach Mode

Attach Mode connects `copilot-ui` to an already running local application and overlays inspection and annotation affordances on top of that app.

Recommended phase-1 scope:

- JavaScript and React hot-reloadable apps only.
- Prefer Vite + React first, because that is the cleanest likely path to a reliable hot-reload validation loop.
- Operator supplies or selects the target app URL instead of relying on deep auto-discovery.

Minimal usable Attach Mode flow:

1. Operator selects or enters a running local app target.
2. Overlay lets the operator select an element.
3. Operator attaches an annotation or short intent.
4. System generates a narrow fix request.
5. Executor or SDK-backed session runs the change loop.
6. Validation checks the hot-reloaded result.
7. System optionally emits a planning suggestion or additive TODO artifact.

### Preview Mode

Preview Mode is a later phase. It should support isolated preview environments only when a repo declares how those previews are launched and what backend boundary they depend on.

Preview Mode should **not** start as generic automatic mock-backend generation. That surface is too broad for v1 because it mixes frontend launch control, backend simulation, fixture governance, and environment safety.

Instead, Preview Mode should use explicit preview profiles or launch recipes, such as:

- env overrides
- fixture URLs
- stub endpoints
- repo-declared launch commands
- documented seed or reset steps

## Milestone plan and phased rollout

### Phase 0: repo-fit spike

- Prove that `copilot-ui` can register a target runtime URL and open a bounded overlay session.
- Confirm element selection, DOM snapshot capture, and executor handoff shape.
- Limit targets to local JS/React apps with known hot reload.

### Phase 1: Attach Mode only

- Ship Attach Mode for Vite/React-class hot-reloadable apps first.
- Support annotation-driven narrow fix requests.
- Run a validation loop that re-checks semantic snapshots after change application.
- Keep screenshots secondary artifacts used on failure or explicit request.
- Offer optional planning suggestion emission, but keep runtime action primary.

### Phase 2: broader attach support

- Add more JavaScript frontend stacks only after the attach contract is stable.
- Introduce operator-visible capability gating so unsupported runtimes fail clearly.
- Improve ghost hints and selection heuristics.

### Phase 3: Preview Mode with explicit recipes

- Add preview profiles declared by repos or operator configuration.
- Support isolated preview launches with bounded backend seams.
- Reuse sandbox only where it improves execution isolation, not as the main feature identity.

## Concrete architecture seams to reuse

The current repo already has most of the seams this feature should build on:

- **`copilot-ui` shell and runtime navigation**: the overlay should live under the existing runtime surface rather than introducing a new product shell. See [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md) and [docs/system/copilot-ui-information-architecture-freeze.md](../system/copilot-ui-information-architecture-freeze.md).
- **Sessions and SDK routes**: target overlay work should attach to the existing session and SDK surfaces rather than inventing a new conversation runtime.
- **Executor routes and runtime control**: the narrow fix loop belongs with executor-backed run management already described in [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md).
- **Session-state artifacts**: overlay runs should write bounded session artifacts and validation summaries into existing session-state patterns rather than inventing a parallel state store.
- **Planning suggestions and planning records**: optional follow-up work can flow through existing planning suggestion surfaces, not through a special overlay-owned planning system.
- **`planning-obsidian` compatibility surface**: any Obsidian output should reuse the existing non-canonical planning bridge rather than creating a new note export authority.
- **Sandbox execution context**: sandbox can be selected as an execution environment when needed, but the overlay should remain attach-first and executor-centered.

## Evidence model: snapshots, screenshots, and ghost hints

The evidence model should follow current repo guidance:

- **Primary evidence**: semantic snapshots before and after the change.
- **Secondary evidence**: screenshots only on failure or explicit operator request.
- **Tertiary assistive layer**: ghost hints that help frame candidate changes without claiming that the UI has already been edited.

This aligns with [docs/system/e2e-setup-guide.md](../system/e2e-setup-guide.md) and [docs/system/agent-architecture-simplicity.md](../system/agent-architecture-simplicity.md), which already prefer snapshot-first workflows.

"Ghost" functionality should start as lightweight overlay hints or proposed bounding boxes. It should not start as direct WYSIWYG editing, drag handles, or authoritative visual mutation. That keeps the feature honest about what the system can actually validate.

## Isolation strategy: preview profiles and mocked backend boundary

Preview isolation should be explicit and opt-in.

Recommended rule:

- no generic automatic mocked-backend generation in v1

Recommended alternative:

- repo-declared preview profiles or launch recipes
- env overrides for known preview modes
- fixture URLs for stable read paths
- documented stub endpoints where the repo already supports them
- optional sandbox-backed execution only when the repo or operator deliberately chooses it

This keeps the backend boundary legible and avoids pretending the system can safely infer how to mock arbitrary application dependencies.

## Suggested operator and developer entrypoints

The primary contract should be an explicit opt-in recipe model, not a universal magic command.

Recommended entrypoints:

- register a local runtime URL in `copilot-ui`
- select a repo-declared attach target or preview profile
- launch an overlay session from `Home / Runtime`
- hand a selected annotation into executor-backed change flow

Possible helper commands can still exist, but they should be wrappers around explicit configuration. For example, a repo might offer a convenience script that starts its preview profile and then opens the overlay, but `npm run dev --canvas` should not become the primary universal contract.

Why not overload `npm run dev --canvas` as the main interface:

- many repos do not share one dev command shape
- preview isolation often depends on backend-specific setup, not just frontend launch
- wrapper commands hide the durable contract that operators actually need to inspect and debug

The more realistic contract is an opt-in recipe, profile, or manifest entry that `copilot-ui` can read and present.

## Obsidian handoff boundaries

Obsidian TODO or note output should remain additive and non-canonical.

Recommended boundary:

- overlay sessions may emit a planning suggestion or accepted task proposal
- accepted tasks or planning suggestions may later generate Obsidian TODOs or notes
- Obsidian output must not become the primary authority for runtime work, backlog state, or overlay annotations

This follows the current repo direction in [docs/system/planning-backlog-roadmap-contract.md](../system/planning-backlog-roadmap-contract.md) and [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md): external notes and deterministic mirrors are compatibility surfaces, not the system of record.

## Non-goals

- A standalone "elegy-ui meta app" for v1.
- Full drag/drop builder behavior.
- Direct WYSIWYG editing of the running DOM.
- Automatic mock-backend generation for arbitrary repos.
- Broad non-JavaScript or non-hot-reload runtime support in phase 1.
- Treating sandbox as the primary product identity.
- Making Obsidian TODO output the source of truth.

## Open questions and decision gates

- What is the smallest stable attach contract for target runtimes: URL only, or URL plus repo-declared metadata?
- Which hot-reload signal is reliable enough for phase-1 validation across Vite/React apps?
- Should overlay selection operate through browser tooling snapshots only, or also store lightweight DOM locator metadata in session artifacts?
- What executor payload shape best preserves a narrow fix request without turning the overlay into a general prompt composer?
- How should unsupported repos declare that they have no preview profile yet?
- When Preview Mode arrives, what is the minimum preview-profile schema that stays explicit without becoming another large manifest system?

## Recommended next experiments

1. Prototype Attach Mode against one Vite/React sample and one repo-local hot-reload target, proving element selection, annotation capture, executor handoff, and snapshot-based validation.
2. Define a tiny preview-profile research schema with only launch command, base URL, env overrides, and optional fixture or stub metadata.
3. Test whether overlay ghost hints can be generated as bounding-box proposals from semantic snapshots before any attempt at richer visual manipulation.
4. Verify that planning suggestion output can flow into existing planning APIs without making Obsidian or legacy planning-record notes the primary authority.

## Bottom line

The realistic v1 is an attach-first **UI Runtime Overlay** inside `copilot-ui`, starting with **Attach Mode** for JavaScript/React hot-reloadable apps and leaving **Preview Mode** for later explicit preview profiles. That keeps the feature aligned with current repo architecture, preserves planning authority boundaries, and avoids overcommitting to builder, sandbox, or auto-mocking promises the repo does not yet support.
