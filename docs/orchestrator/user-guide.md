# Orchestrator User Guide

## What Is the Orchestrator?

The `@orchestrator` is the single recommended entry point for all complex work in projects using Instruction Engine. It replaces Executive (v1), Executive2, Executive2.5, and Executive2-Fast with one unified agent.

You invoke `@orchestrator` and describe what you need. It handles everything — understanding your request, planning, delegating implementation to specialists, running reviews, and proposing follow-ups.

## Quick Start

1. **Invoke**: Type `@orchestrator` followed by your request.
2. **Answer any clarifications**: The orchestrator may ask about ambiguities.
3. **Review the plan** (for non-trivial work): Approve, revise, or cancel.
4. **Watch it execute**: Work units are delegated to specialist agents.
5. **Pick follow-ups or stop**: After completion, choose next actions or stop.

## How Requests Are Routed

The orchestrator classifies every request by complexity:

| Complexity | What happens | Example |
|---|---|---|
| **Trivial** | Direct execution, no plan | "Fix the typo in README.md" |
| **Standard** | Plan → execute → verify | "Add a new API endpoint for user profiles" |
| **Complex** | Discuss → research → plan → execute → review → verify | "Redesign the authentication system" |

You don't choose the complexity — the orchestrator's `@o-reframer` subagent analyzes your request and classifies it automatically. If uncertain, it defaults to "standard" and may ask you to confirm scope.

## The Lifecycle

### Phase 0: Bootstrap
Every invocation loads project context (architecture, conventions, constraints) and checks for in-progress sessions to resume.

### Phase 1: Understand
Your request is analyzed by `@o-reframer`, which produces a structured brief: classification, scope, risks, ambiguities. For complex requests, the orchestrator may ask you to resolve ambiguities and may run research/exploration first.

### Phase 2: Plan (standard/complex only)
`@o-planner` produces a plan pack — a 2-file Markdown state containing work units, dependencies, and acceptance criteria. You review and approve (or request changes) before execution begins.

### Phase 3: Execute
Work units are delegated to `@work-unit-runner` (one at a time or in groups). The orchestrator gathers context for each WU, delegates execution, and tracks progress. Testing checkpoints run after each group.

### Phase 4: Verify
Final code review via `@code-reviewer`. For important changes, a cross-model review may run (e.g., GPT reviews Claude's work and vice versa).

### Phase 5: Follow-Up
The orchestrator proposes 2-4 concrete next actions (tests, docs, refactors). Pick one to continue, or choose "Stop — all done."

## Key Subagents

| Agent | Role |
|---|---|
| `@o-reframer` | Analyzes requests, classifies complexity |
| `@o-planner` | Produces plan packs from enriched briefs |
| `@work-unit-runner` | Implements individual work units |
| `@code-explorer` | Read-only codebase analysis |
| `@code-architect` | Design decisions and blueprints |
| `@code-reviewer` | Quality gates (APPROVED/NEEDS_REVISION/FAILED) |
| `@research-ideation` | Web + codebase research |
| `@context-curator` | Condenses project memory |
| `@unit-test-runner` | Unit test execution |
| `@integration-test-runner` | Integration tests (user-confirmed) |

## Plan Packs

For standard and complex work, the orchestrator manages state via plan packs:

- **Plan pack**: `.instructions/artefacts/x-PLANPACK-<SESSION_ID>.md` — contains goal, work units, dependencies, specs
- **Progress tracker**: `.instructions/artefacts/x-PLANPACK-PROGRESS-<SESSION_ID>.md` — execution status, checkpoints, log

Plan packs are human-readable Markdown. You can inspect them at any time. The progress tracker shows what's done, what's next, and what's blocked.

### Resuming Sessions
If a session is interrupted, the orchestrator detects the in-progress plan pack on next invocation and offers to resume.

## Seamless Agent Integration

If you have the [Seamless Agent extension](https://marketplace.visualstudio.com/items?itemName=jraylan.seamless-agent) installed, the orchestrator uses its tools for richer interaction:

- **`planReview`**: Inline comments on plan sections
- **`askUser`**: Rich confirmations with file references
- **`walkthroughReview`**: Step-by-step guided UAT

Without the extension, everything falls back to standard `vscode/askQuestions` — no functionality is lost, just UI richness.

## Migration from Old Executives

| Old Agent | Action |
|---|---|
| `@executive` | Use `@orchestrator` instead |
| `@executive2` / `@executive2-planner` | Use `@orchestrator` instead |
| `@executive2p5` / `@executive2p5-planner` | Use `@orchestrator` instead |
| `@executive2-fast` | Use `@orchestrator` instead (trivial requests use fast path) |

The older agents remain functional with deprecation notices but are no longer recommended.

### What changed
- **Single entry point**: No more choosing between 5+ executive variants.
- **Automatic complexity routing**: The orchestrator decides the right approach.
- **Fast path**: Trivial requests execute directly without planning overhead.
- **Context curation**: Each subagent gets only what it needs, keeping context clean.
- **Follow-up loop**: The orchestrator never auto-stops — it always proposes next actions.

## Tips

- **Be specific**: "Add a Wolverine HTTP endpoint for creating users" is better than "Add user stuff."
- **Trust the routing**: You don't need to specify whether work is trivial or complex.
- **Review plan packs**: For important work, take time to review the plan before approving.
- **Use follow-ups**: After completion, the orchestrator's follow-up proposals are often valuable (tests, docs, related refactors).
- **Resume interrupted work**: Just invoke `@orchestrator` again — it detects and offers to resume.
