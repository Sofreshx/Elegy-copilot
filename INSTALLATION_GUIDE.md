# Installation & Onboarding Guide

This guide explains how to add the **Agentic Pattern** to an existing repository.

## The Concept
We do not just "copy files". We **inject an intelligence layer**. The system scans your codebase, writes tailored instructions to match your style, flags inconsistencies, and wires a pipeline so tasks can spawn follow-up work automatically.

## Installation Steps

### 1. Bootstrap
Copy the seed files into your repository root (or `.github` folder):
*   `.github/copilot.instructions.md` (Kernel/router)
*   `agents/` folder with all agent templates
*   `contexts/` folder with context templates
*   `architecture.md`, `warnings.md`, `raw.tasks.md`, `tasks.md`, `failed.tasks.md`
*   `docs/` folder (example-session.md, instruction-changelog.md)

### 2. Onboarding Scan (Auto-tailor)
Run the **Onboarding Agent** via Copilot.

**Prompt:**
> "Run the onboarding agent. Scan this repository. Identify our tech stack, patterns, and testing strategies. Generate/update `architecture.md`, populate `warnings.md` with inconsistencies, and generate tailored Domain Agents/Contexts for all detected stacks."

**What happens:**
1.  **Analysis**: Reads manifests (`package.json`, `.csproj`, Docker, IaC) and code samples.
2.  **Stack Detection**: Uses the **Stack Detection Matrix** in `onboarding.agent.md` to map signals to agents/contexts.
3.  **Merge Strategy**: Preserves your customizations using Git-style conflict markers—see below.
4.  **Backup**: Creates `.backup/` copies before modifying existing files.
5.  **Warnings**: Logs mixed patterns or drift into `warnings.md`.
6.  **Follow-ups**: Adds clarification or fix requests to `raw.tasks.md` if gaps are found.

### 3. Override & Customization Behavior
The system is designed to **adapt to your project**, not overwrite it.

**For Agent Files (`agents/*.agent.md`):**
- Backups created in `agents/.backup/` before changes
- Custom sections (marked `## Custom` or `## Project-Specific`) are **never overwritten**
- Conflicts use Git-style markers:
  ```markdown
  <<<<<<< EXISTING (customized)
  [your content]
  =======
  [new generated content]
  >>>>>>> GENERATED
  ```

**For Context Files (`contexts/*.md`):**
- Filled fields are preserved; only empty fields are populated
- New fields added with `(NEW)` marker

**For Task Files:**
- Append-only—existing entries never deleted
- Duplicate detection prevents redundant entries

**Rollback:** If something goes wrong, restore from `.backup/` folders.

### 4. Review & Refine
1.  **Check `warnings.md`** and decide what to address now.
2.  **Resolve conflict markers** in any files that have them.
3.  **Review Agents**: Adjust with `instruction-editor.agent.md` if needed.
4.  **Check contexts**: Ensure patterns accurately describe your conventions.

### 5. Operational Handoff

#### Task Pipeline (Structured Work)
```
User idea → raw.tasks.md
     ↓ (run task-creator)
tasks.md (structured)
     ↓ (run task-priority-planner)
tasks.md (ordered/batched)
     ↓ (run task-runner + domain agent)
Code changes + session summary
     ↓
If blocked → new raw.tasks.md entry → loop back
If done → mark task done, suggest next
If failed → failed.tasks.md entry → retry with deep mode
```

**Key commands:**
- `"Run task creator"` → Process `raw.tasks.md` into structured tasks
- `"Run task priority planner"` → Reorder and batch tasks
- `"Execute T-001"` → Run specific task with appropriate agent
- `"Continue"` → Follow agent's suggested next action

#### Free-form Mode (Ad-hoc Help)
Just ask naturally—no task overhead needed:
- `"Review this design"` → Routes to design.agent
- `"Check this code"` → Routes to code-review.agent
- `"Why is this failing?"` → Routes to debug.agent
- `"How does X work?"` → Routes to assistant.agent
- `"Is this secure?"` → Routes to security.agent
- `"Optimize this"` → Routes to performance.agent

## Working with GitHub Copilot

### Copilot Chat Mode
- Use for free-form requests, quick questions, explanations
- Kernel automatically routes to the right agent
- Just ask naturally—"review this code", "help me debug this"

### Copilot Agent Mode
- Ideal for task pipeline execution (multi-step work)
- Say "run task creator" or "execute T-001" to trigger pipeline
- Agent handles file edits, commands, and context gathering

### Plan Mode (Multi-file Changes)
- When Copilot proposes a plan, it's checked against `architecture.md` and `project.patterns.md`
- Conflicts surface in the session summary
- Use "continue" to accept, or specify adjustments

### @workspace Context
- Always available—agents read workspace files as needed
- Contexts in `contexts/*.md` are pre-indexed for efficiency
- Point to specific files/folders for large repos

## Self-Improvement

The instruction system can evolve:

1. **Instruction Editor** (`instruction-editor.agent.md`): Manually update agents/contexts when patterns change.
2. **Instruction Drift** (`instruction-drift.agent.md`): Periodically scans `failed.tasks.md` to detect when instructions need updating.
3. **Changelog** (`docs/instruction-changelog.md`): Tracks all instruction changes for auditability.

Run "check instruction health" to trigger drift detection and improvement proposals.

## Agent Categories

### Meta-Agents (System Management)
| Agent | Purpose |
|-------|---------|
| `onboarding.agent.md` | Scan repo, generate tailored agents/contexts |
| `task-creator.agent.md` | Convert raw tasks to structured tasks |
| `task-priority-planner.agent.md` | Order and batch tasks |
| `task-runner.agent.md` | Execute tasks with domain agents |
| `instruction-editor.agent.md` | Update instructions/contexts |
| `instruction-drift.agent.md` | Detect instruction decay, propose fixes |

### General-Purpose Agents (Ad-hoc Help)
| Agent | Use When |
|-------|----------|
| `assistant.agent.md` | "How does X work?", explanations, Q&A |
| `code-review.agent.md` | "Review this code", PR review |
| `design.agent.md` | "Is this a good pattern?", ADRs |
| `debug.agent.md` | "Why is this failing?", errors |
| `refactor.agent.md` | "Clean up this code", restructuring |
| `docs.agent.md` | "Document this", README, comments |
| `testing.agent.md` | "Write tests", coverage gaps |
| `security.agent.md` | "Is this secure?", vulnerability review |
| `performance.agent.md` | "Optimize this", bottlenecks |
| `migration.agent.md` | "Upgrade to X", breaking changes |

### Domain Agents (Stack-Specific)
| Agent | Stack |
|-------|-------|
| `auth.agent.md` | Firebase, Auth0, OIDC |
| `frontend.agent.md` | React, Vue, Angular |
| `feature.creator.agent.md` | Backend features, APIs |
| `quality.csharp.agent.md` | C# code quality |
| `quality.ts.agent.md` | TypeScript code quality |
| `aspire.tests.integration.agent.md` | .NET Aspire testing |
| `deployment.compose.agent.md` | Docker Compose |
| `terraform.agent.md` | Infrastructure as Code |

## Agent Schema
All agents follow a standardized structure with `schema-version: "1.0"`:
- **Purpose**: One-liner
- **When to Use**: Clear routing guide for LLM
- **When NOT to Use**: Disambiguation from similar agents
- **Inputs**: Files/sources required
- **Steps**: Numbered workflow including mode selection
- **Output**: Artifacts produced
- **Session Summary Format**: 6-field standard (Done, Changes, New tasks.md, New raw.tasks.md, Warnings, Next)

## Manual vs. Scripted
*   **Current State**: Manual copy of the seed folder + run onboarding prompt.
*   **Future State**: `agentic init` CLI to copy seeds and trigger onboarding.
