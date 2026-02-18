---
created: 2024-01-15
updated: 2024-12-19
category: planning
status: archived
tags: [copilot-cli, q-and-a, reference]
related: [copilot-cli-playbook-new.md]
---

# Copilot CLI vs VS Code: Q&A Reference (Archived)

> **⚠️ This document has been superseded by the comprehensive playbook.**  
> **See: [Copilot CLI Adoption Playbook](./copilot-cli-playbook-new.md)**

This file contains the original Q&A-style documentation for Copilot CLI adoption. It's preserved for reference but is no longer the primary team guide.

For the current team playbook covering:
- **Default operating model:** plan-first → fleet mode → custom agents as subagents  
- **Remote control:** Discord integration with ACP-based approve/deny permissions
- **MCP decision guide:** Default posture is "none unless use case" with short decision flow
- **Testing readiness:** E2E and integration test workflows, known-safe commands, hang prevention
- **Safety posture:** Allow basic commands, deny dangerous operations (conceptual baseline)

**→ Primary Playbook: [copilot-cli-playbook-new.md](./copilot-cli-playbook-new.md)**

---

## Original Q&A Content (For Reference)

## Why you might switch to Copilot CLI

If your goal is **lower local UI overhead**, **better parallelization**, and a **terminal-first workflow**, Copilot CLI is a legitimate alternative to running Copilot agent mode inside VS Code.

Copilot CLI is not “just chat in a terminal” — it can:
- read/modify files (in trusted directories)
- run shell tools (with permission gating)
- create plans before coding
- run multiple tools in parallel
- delegate long-running work to Copilot coding agent on GitHub

Sources:
- Using Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli
- CLI best practices: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- CLI command reference: https://docs.github.com/en/copilot/reference/cli-command-reference

---

## Feature + quality differences (CLI vs VS Code)

### What’s broadly “better” in VS Code agent mode

VS Code agent mode typically wins when you want:
- rich IDE context (open editors, diagnostics panel, quick-fix UI)
- interactive refactors driven by the language server (rename, find refs, etc.)
- tight edit/preview loops for UI work
- a single place to edit + run + debug

### What’s broadly “better” in Copilot CLI

Copilot CLI often wins when you want:
- terminal-native workflows (build/test/lint/git/containers)
- permissioned tool execution with explicit approvals (or allowlists)
- easier “multi-repo” work by starting from a parent folder or adding dirs
- fast plan-driven workflows
- lighter weight than a full IDE for many tasks

Sources:
- Plan mode and workflows: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- Multi-repo patterns: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

### Quality differences: what to expect

Quality is less about “CLI vs VS Code” and more about:
- the model you select (`/model`)
- how well your instructions are written
- whether you run “explore → plan → code → verify”

Copilot CLI explicitly supports:
- plan mode (`/plan` or Shift+Tab)
- code review agent (`/review`)
- a task agent for builds/tests
- skills injection
- fleet mode (`/fleet`) for parallel subagent execution

Sources:
- `/model`, `/plan`, `/review`: https://docs.github.com/en/copilot/reference/cli-command-reference
- Best-practice workflow: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

---

## Your specific questions

### 1) “Create a custom Copilot instruction for SaaSTools (/init)”

Copilot CLI has an init flow:
- command: `copilot init`
- slash command: `/init`

This initializes custom instructions + agentic features for the repository.

Source: https://docs.github.com/en/copilot/reference/cli-command-reference

#### Suggested `.github/copilot-instructions.md` template for “SaaSTools”

Use this as a starting point, then tailor build/test commands.

```md
## Repo goals
- Prefer small, verifiable changes.
- Avoid unrelated refactors.

## Workflow
- Before coding: restate the goal and identify the minimal files to touch.
- After coding: run the narrowest relevant validation (lint/tests/build).
- If a decision affects architecture, ask a targeted question.

## Safety
- Never introduce secrets into the repo.
- Avoid destructive commands unless explicitly requested.

## Style
- Keep code consistent with existing patterns.
- No new dependencies unless clearly justified.

## Validation commands (edit these)
- `npm test`
- `npm run lint`
- `npm run build`
```

If you want path-specific instructions, add files under `.github/instructions/**/*.instructions.md`.

Sources:
- Custom instructions (repo + path-specific): https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions

---

### 2) “Add main instruction into the Copilot file on the PC as user instead of repo”

Copilot CLI supports **global (user) instructions**:
- file: `$HOME/.copilot/copilot-instructions.md`

This applies across projects (unless overridden/augmented by repo instructions).

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions

Notes:
- Repository instructions are still valuable for team-shared standards.
- Copilot CLI caches instructions; restart or use session resume if you need to force reload.

Source (cache behavior): https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions

---

### 3) “Update instruction-engine so it can install/refresh skills and agents on the computer (user-level) instead of needing the repo in the workspace”

Copilot CLI supports both **user-level custom agents** and **user-level skills**:

**User-level custom agents**
- directory: `~/.copilot/agents`

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli

**User-level skills**
- directory: `~/.copilot/skills/<skill-name>/SKILL.md`

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills

#### What this implies for instruction-engine

A practical direction is:
- Treat `instruction-engine/.github/agents/*` as the source of truth for agent profiles
- Treat `instruction-engine/.github/skills/*` as the source of truth for skills
- Add an installer that copies (or syncs) those into `~/.copilot/agents` and `~/.copilot/skills`

Also consider using `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` to point Copilot CLI at a shared folder containing:
- `AGENTS.md`
- `.github/instructions/**/*.instructions.md`

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions

This would let you “install once”, then keep instruction-engine out of your workspace unless you’re actively developing the instruction-engine itself.

---

### 4) “Update our remote worker to be CLI-based instead of VS Code extension-based”

Copilot CLI supports:
- fully interactive mode (`copilot`)
- programmatic mode (`copilot -p "..."`)
- delegation to Copilot coding agent (`/delegate` or `& ...`)
- an Agent Client Protocol (ACP) server mode (`--acp`)
- an IDE bridge command (`/ide`) to connect to an IDE workspace

Source: https://docs.github.com/en/copilot/reference/cli-command-reference

#### A realistic design split

There are two common patterns:

**Pattern A — Remote worker = shell runner + Copilot CLI interactive session**
- You SSH into a beefier box (or a VM) and run `copilot` there.
- You keep the “human-in-the-loop approvals” intact.

**Pattern B — Remote worker = job executor, uses `copilot -p`**
- You run Copilot CLI non-interactively for narrow tasks (summaries, explainers, small code generation), capturing stdout.
- If you want it to freely execute tools in automation you’ll be pushing toward `--allow-all-tools` / `--yolo`.

Warning: “YOLO-mode automation” is powerful, but it is also exactly where you need sandboxing + guardrails.

Sources:
- Programmatic prompt mode and `--yolo`/`--allow-all-tools`: https://docs.github.com/en/copilot/reference/cli-command-reference
- Permissions model (approve tools): https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli

---

### 5) “How do tests work now (especially end-to-end) using the CLI?”

Copilot CLI doesn’t change *how* your tests run — it changes how you *drive* them.

Typical flow:
1. Tell Copilot what test command you want (or ensure it’s in custom instructions).
2. Approve the shell tool execution when prompted.
3. Let Copilot iterate on failures (it can run commands repeatedly).

Best practice workflow includes a dedicated “verify” step.

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

#### E2E testing specifically

E2E usually needs:
- stable, scripted commands (`npm run e2e`, `playwright test`, `cypress run`, etc.)
- deterministic environment setup (services up, ports, test data)

Copilot CLI can be helpful by:
- generating the test scaffolding
- running the E2E command and summarizing failures
- patching files to fix failures

But it will only be as reliable as your underlying E2E scripts and environment.

---

### 6) “Integration for remote work using the CLI”

Copilot CLI runs anywhere you have a terminal and your repo:
- local machine
- SSH to a remote box
- inside a container/devcontainer
- inside GitHub Codespaces (remote compute)

Codespaces is worth considering specifically for the “lighter load on my PC” goal, because it moves compute off-device.

Codespaces overview: https://docs.github.com/en/codespaces

---

### 7) “Integrate into CI/CD using CLI (or SDK)”

Copilot CLI *can* run in programmatic mode (`-p`), but CI/CD introduces constraints:
- authentication must be non-interactive
- you need strict tool/path permissions
- you typically want deterministic behavior (no hidden prompts)

If your CI goal is “AI writes code during the pipeline”, you should treat that as a governance/security problem, not just a tooling problem.

Practical CI uses for Copilot CLI tend to be:
- summarize logs / failures
- generate release notes / changelogs
- produce review feedback

When you truly want autonomous code changes “in the background”, the **supported** workflow is usually delegation to Copilot coding agent (which opens PRs).

Sources:
- `/delegate` and delegation behavior: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli
- Programmatic mode and permissions: https://docs.github.com/en/copilot/reference/cli-command-reference

---

### 8) “Does the CLI have askQuestion tool?”

Copilot CLI has an internal “ask user” interaction mechanism (it can ask you questions during planning/implementation).

The command reference also includes:
- `--no-ask-user` (disable the ask_user tool)

This is not the same thing as VS Code’s `vscode/askQuestions` API, but it serves a similar purpose: interactive clarification.

Source: https://docs.github.com/en/copilot/reference/cli-command-reference

---

### 9) “Make CLI work in background / VM for safety so we can run yolo mode without worry”

Copilot CLI supports:
- `/yolo` or `--yolo` to enable all permissions
- granular allow/deny lists for tools and URLs
- trusted directories + explicit directory grants

Sources:
- `/yolo` and permissions flags: https://docs.github.com/en/copilot/reference/cli-command-reference
- Trust directories and approvals: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli

#### Safety strategy that actually reduces risk

If you want “YOLO mode” but lower blast radius, combine it with a sandbox:
- run inside a disposable VM, container, or Codespace
- keep secrets out of the filesystem
- restrict repo access scopes
- prefer allowlists (e.g., allow `git`, allow `npm run test:*`, deny `git push`)

Example from best practices:

```bash
copilot --allow-tool 'shell(git:*)' --deny-tool 'shell(git push)'
```

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

---

### 10) “GitHub Fleet preview in the CLI (/fleet) — parallel execution”

Your current Copilot CLI build exposes a `/fleet [prompt]` command described as:

> Enable fleet mode for parallel subagent execution

This appears to be a **Copilot CLI feature** (not necessarily the older “GitHub Fleet” remote dev product), and it may be experimental/preview.

Practical ways to explore it safely:
- In the CLI, run `/help` and `/experimental show` to see what’s enabled.
- Create a plan (`/plan ...`) with multiple independent workstreams, then run `/fleet ...` to execute them.
- Use `/tasks` to monitor and manage background tasks.
- If you need to compare behavior, the CLI has a `--disable-parallel-tools-execution` option (forces sequential tool execution even if the model asks for parallelism).

Notes:
- Because `/fleet` isn’t currently covered in the public docs, treat its behavior as **subject to change** and validate it empirically in a sandbox repo/VM.
- If you intend to combine `/fleet` + `/yolo`, the blast radius grows quickly; prefer running inside an isolated workspace (VM/container/Codespace) and start with allowlists.

Sources:
- `/fleet`, `/tasks`, `/experimental`: `copilot help commands` (local CLI help)
- Parallel tools execution flag: https://docs.github.com/en/copilot/reference/cli-command-reference

---

### 11) “How do my custom agents / subagents integrate into the CLI workflow?”

In Copilot CLI, **custom agents** are defined by `.agent.md` files (agent profiles). When Copilot decides to use one (or you explicitly select one), the work is executed by a **subagent**: a temporary agent with its **own context window**. This is the main reason agents help quality and scalability: they let the main session stay focused while offloading work.

Source (subagents + their separate context): https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli

#### Where your agent profiles live

- Repo-level agents: `.github/agents/*.agent.md`
- User-level agents: under your Copilot CLI config directory (the CLI supports user-level custom agents; the exact folder can vary by platform/config, but the command reference lists `~/.copilot` as the default config dir).

Sources:
- Repo-level `.github/agents` and user-level agents: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli
- Default config dir + `--config-dir`: https://docs.github.com/en/copilot/reference/cli-command-reference

Important behavior:
- If an agent with the same name exists at user-level and repo-level, **the user-level one wins**.

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli

#### How to use your custom agents in practice

Copilot CLI supports four ways to “activate” your agent:

1) **Select it in interactive mode**
- Run `/agent` and pick one from the list, then type your prompt.

2) **Explicitly instruct Copilot to use it**

```text
Use the security-auditor agent to review all files under src/
```

3) **Let Copilot infer the right agent**
- If your agent description defines when it should be used (and optional trigger words), Copilot can pick it automatically.

4) **Programmatic / scripted usage**

```bash
copilot --agent security-auditor --prompt "Check src/app/validator.go"
```

Source (all four usage modes + `--agent`): https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli

#### How this relates to “subagents” and `/fleet`

- When a custom agent runs, it runs as a **subagent** (separate context, temporary).
- `/fleet` (in your current CLI build) appears to run **multiple subagents in parallel**, and `/tasks` lets you monitor them.

Sources:
- Subagents concept: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
- `/fleet` + `/tasks`: `copilot help commands` (local CLI help)

---

## Suggested adoption path (practical)

1. Install Copilot CLI and try it in a single repo.
2. Add repo-level instructions via `copilot init` and refine `.github/copilot-instructions.md`.
3. Add global user instructions at `$HOME/.copilot/copilot-instructions.md` for cross-repo defaults.
4. Migrate instruction-engine assets into user-level locations:
   - `~/.copilot/agents`
   - `~/.copilot/skills`
5. For heavy tasks, use `/delegate` to Copilot coding agent to offload work.

---

## Open items / items needing follow-up research

- **Fleet in Copilot CLI**: `/fleet` exists in current CLI builds as “fleet mode for parallel subagent execution”, but it’s not currently described in the public docs. Treat as preview/experimental and verify behavior via CLI help + sandbox testing.
- **CI/CD**: confirm whether your intended CI usage is “assist humans” (summaries/review) or “autonomous code writing in pipeline”, because the security posture and design are very different.

---

## Running agents in “YOLO” mode safely (and observing from your phone)

There’s no such thing as “risk-free YOLO”, because `--yolo` / `/yolo` gives Copilot CLI the same capability set you have (tools, paths, URLs). What you *can* do is **reduce blast radius** and **improve observability**.

Sources:
- `--allow-all` / `--yolo` meaning (tools + paths + URLs): https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli#allowing-all-tools-paths-and-urls
- Risk mitigation recommendation (VM/container/dedicated system): https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#risk-mitigation

### A safe-ish YOLO recipe (blast-radius minimization)

**Goal:** let Copilot run freely *inside a sandbox* where “breaking stuff” is acceptable.

1) **Run in a disposable environment**
- Preferred: a dedicated VM, container, or GitHub Codespaces.
- Keep the sandbox separate from your real repos, SSH keys, cloud credentials, and personal home directory.

Source (explicitly recommends VM/container): https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#risk-mitigation

2) **Scope what Copilot can see (paths)**
- Start Copilot CLI from the specific repo folder you want.
- Avoid starting in your home directory.
- Consider `--disallow-temp-dir` if you want to reduce unexpected reads/writes in temp.

Source (path permissions + `--disallow-temp-dir`): https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli#setting-path-permissions

3) **Allow-all-tools, but still deny the truly dangerous stuff**

Even if you want near-YOLO, you can do a “YOLO minus a few commands” posture:

```bash
copilot --allow-all-tools --deny-tool 'shell(rm)' --deny-tool 'shell(git push)'
```

Source (combining allow/deny): https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#combining-approval-options

4) **Constrain the tool surface when you can**

If you’re doing a narrow job (tests, lint, build), prefer restricting tools instead of YOLO:
- `--available-tools` limits what tools exist at all.

Source (`--available-tools`): https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli#limiting-available-tools

5) **Start with plan mode + review**

Even in a sandbox, plan-first reduces wasted runs:
- `/plan …`
- after implementation: `/diff` + `/review …`

Source (plan mode and workflow): https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

### Observing a session from your phone (practical options)

There isn’t (currently) a first-party “live mobile dashboard” for *local* Copilot CLI sessions. But there are several practical ways to get most of what you want.

#### Option A (best): Delegate to Copilot coding agent, then watch the PR

If your goal is “I want to see progress while I’m away”, delegation is the most straightforward:
- `/delegate …` (or prefix prompt with `&`)

Copilot opens a draft PR and gives you links to the PR + agent session on GitHub. You can monitor and review from GitHub Mobile.

Source (delegate creates draft PR + link): https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli#delegate-tasks-to-copilot-coding-agent

#### Option B: Share the session to a GitHub gist (phone-friendly)

Copilot CLI supports sharing sessions:
- `/share gist` (interactive)

That gives you a URL you can open on your phone (and you can keep resharing as the session progresses).

Source (`/share`): https://docs.github.com/en/copilot/reference/cli-command-reference

#### Option C: Persisted local session files + a “tail to Discord” bridge

Copilot CLI stores session state locally, including `events.jsonl`:

```
~/.copilot/session-state/{session-id}/
├── events.jsonl
├── workspace.yaml
├── plan.md
└── ...
```

Source (session-state layout): https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

Practical idea:
- A small script tails `events.jsonl` and posts new entries to a Discord channel.
- Your phone becomes the observer (Discord).

This is feasible, but it’s “plumbing you maintain” (format churn risk because CLI is preview).

#### Option D: ACP server + your own control/observer UI (closest to the Reddit inspiration)

Copilot CLI can run as an ACP server:

```bash
copilot --acp --port 3000
```

ACP exposes session updates (streaming chunks, tool permission requests, etc.) over a standard protocol. A small service can:
- render a minimal web UI (mobile friendly)
- or relay updates to Discord
- and optionally let you send prompts remotely

Sources:
- ACP server overview + TCP mode: https://docs.github.com/en/copilot/reference/acp-server
- “Use Copilot CLI via ACP”: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#use-copilot-cli-via-acp

Reality check:
- This is absolutely possible, but it’s engineering work.
- You’ll need to decide how to handle permissions (true YOLO vs allowlists vs “refuse tool calls remotely”).
- For safety, this should run inside a sandbox VM/container, and you should assume the ACP endpoint is sensitive (protect it).

### Recommendation

If you want something practical *now*:
- Use `/delegate` for long-running work (watch via PR on phone).
- Use `/share gist` for quick “status snapshots” of local sessions.

If you want the Reddit-style remote control layer:
- Build it on top of `copilot --acp` + Discord/web UI, but do it in a sandbox first and treat it like you’re exposing a remote shell.
