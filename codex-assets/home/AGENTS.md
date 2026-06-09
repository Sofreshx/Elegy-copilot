# Codex Session Defaults

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime. Treat this
file as the global Codex baseline installed to `~/.codex/AGENTS.md`; keep
project-specific commands and conventions in the target repo's own `AGENTS.md`
or canonical docs.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Concise Instruction Contract

Concise, precise instruction is required.

Write to transfer decisions, not to sound complete. Prefer exact terms, diagrams, tables, checklists, contracts, and examples over prose.

| Use | Avoid |
|---|---|
| Named term | Repeating the same idea in new words |
| Diagram | Long system description |
| Table | Paragraph comparing options |
| Checklist | Requirement paragraph |
| Contract | Vague guidance |
| Example | Abstract explanation |
| Link | Copied policy text |

Rules:

- Start with the point.
- Use active voice.
- Use short sentences by default.
- Use exact vocabulary.
- Define key terms once.
- Reuse defined terms consistently.
- Replace vague nouns with named concepts.
- Replace long explanation with a diagram, table, checklist, or example.
- Delete ceremonial openings and closings.
- Delete restatement.
- Delete throat-clearing.
- Delete empty emphasis.

Bad:

```text
This system provides a robust and flexible way to manage documentation across multiple workflows.
```

Good:

```text
Documentation authority:
README -> canonical entrypoint -> canonical node
```

A section must answer at least one question:

- What is the purpose?
- What is the contract?
- Who owns it?
- When is it used?
- What can fail?
- How is it verified?
- What is the next link?

If it answers none, remove it.

## Clarification Contract

Never implement through ambiguity.

If user intent is unclear, clarify before planning or implementation. Use available question tools when the environment provides them. Ask few questions, but make them decision-changing.

Clarify when uncertainty affects:

- scope
- architecture
- data handling
- destructive action
- external cost
- user-visible behavior
- acceptance criteria
- validation
- ownership
- security or privacy

Do not ask when the answer is discoverable from files, docs, tests, config, or current state. Investigate first.

Good clarification:

```text
Which source should be authoritative for this change?
- Repo-local canonical docs: durable repo policy
- Harness instructions only: local entrypoint
```

Bad clarification:

```text
Can you clarify what you want?
```

If two steps depend on an unstated assumption, stop and clarify before crossing that boundary.

## Planning Contract

Do not jump from intent to edits.

Before implementation:

1. Read the relevant local sources.
2. Identify the authority path.
3. State the goal and success criteria.
4. Separate facts from assumptions.
5. Resolve blocking ambiguity.
6. Choose the smallest implementation path.
7. Define validation.

Do not assume unclear parts will work out during implementation.

Use plan-first for non-trivial work. A plan is ready only when another implementer can execute it without making product or architecture decisions.

## Documentation Shape

Default shape:

```text
Point
Contract, diagram, or table
Operational details
Validation or next link
```

Documentation should route downward:

```text
README / harness instructions
  -> repo-local canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Do not duplicate canonical policy.

## Review Rule

Review must flag instruction drift.

Flag:

- vague abstractions without definitions
- long prose where structure fits better
- duplicated policy
- unclear authority
- missing clarification before implementation
- assumptions treated as facts
- sections with no purpose, contract, usage, failure mode, validation, or next link
- harness files copying policy instead of pointing to it
- UI copy that explains instead of naming state and action

## Validation Rule

Run the narrowest relevant check after changes.

Use repo-local validators when present. Do not invent global commands.

When documentation or instruction surfaces change, validate relevant links and references.

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load harness instructions, then repo-local canonical entrypoint, then the smallest relevant canonical node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make the plan decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.

## Skills

Instruction Engine installs curated skills under Codex. Skills are loaded on-demand
and should be used only when they materially improve the result.

Primary skills available:
- `elegy-planning` — Durable planning authority via Elegy CLI. Use for goals, roadmaps,
  plans, todos, issues, review points, and validation backed by SQLite.
- `skill-discovery` — Skill resolver for on-demand capability routing.
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work.
- `implementation-review` — Post-edit review before handoff.
- `implementation-handoff` — Executor-ready brief for another session or model.
- `spec-dev` — Spec-driven router for spec-first and spec-anchored work.
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`.
- `spec-review` — Adversarial spec review before implementation planning.
- `commit-check-setup` — Bootstrap or update commit-check infrastructure in a repo. Copies scripts, generates `.copilot/commit-checks.json` config, runs smoke test.
- `ui-system` — Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; treat Figma / Storybook MCP data as context, not authority.

### elegy-planning Availability

Before starting planning work, check whether `elegy-planning` is available on PATH.
If the binary is found, prefer it for durable planning state (goals, roadmaps, plans).
The shared planning database is located at the path in the
`INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH` environment variable (defaults to
`~/.copilot/elegy-planning.db`).

To initialize a Codex-side planning session:
```
elegy-planning session init
```

If `elegy-planning` is not available, fall back to markdown
roadmap work under `docs/roadmaps/<roadmap-slug>.md`.

## Native Codex Tools

- To install or refresh the shared Codex agents and skills from this repo, run:
  - Windows: `pwsh -File scripts/codex-install.ps1 --force`
  - macOS/Linux: `bash scripts/codex-install.sh --force`
- To refresh all supported Instruction Engine surfaces from this repo, run:
  - Windows: `pwsh -File scripts/install-all.ps1 --force`
  - macOS/Linux: `bash scripts/install-all.sh --force`
- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` only when a repository needs persistent repo-local Codex instructions or bootstrap files; do not use it for routine shared asset installation or refresh.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.
- Use `$elegy-planning` for persisted multi-session goals, roadmaps, and plans backed by SQLite. Fall back to markdown roadmaps under `docs/roadmaps/<roadmap-slug>.md` only when the elegy-planning CLI is not available.
- Use `$spec-dev` when the task needs spec-first clarification, a durable repo spec under `docs/specs/<spec-slug>/spec.md`, or a narrow spec-as-source flow.
- Use `$spec-authoring` to create or refine durable specs under `docs/specs/`, then `$spec-review` before implementation planning when the spec will drive the work.
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.
- Use `$skill-discovery` when the right shared skill is still ambiguous.
- Treat a Roadmap as durable multi-session planning above a session plan: it records goals, non-goals, targets, sequencing, progress, evidence, and reevaluation notes, while the current session implements one selected slice.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.

For the Instruction Engine repo itself, the current identity and delivery model are:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into the Copilot home install.
- `codex-assets/`, `opencode-assets/`, and `antigravity-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.

For spec-driven work, use the current repo contract in `docs/system/spec-driven-development.md`:
durable specs live at `docs/specs/<spec-slug>/spec.md`, with optional `docs/specs/index.md`, and should be
validated with `node scripts/validate-specs.js <spec-root>` when the target repo has that validator.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Keep global Codex agents minimal. Prefer the built-in main agent plus a read-only reviewer; put domain behavior in repo-local `AGENTS.md` or repo-local skills.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
