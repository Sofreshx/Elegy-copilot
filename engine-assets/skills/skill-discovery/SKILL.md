---
name: skill-discovery
description: "Dynamic skill discovery and resolution for the search/execute pattern. Teaches agents how to find, search, and load domain-specific skills from the vault instead of relying on always-loaded context. Use this when you need to find which skill applies to a task, resolve a pointer skill, or search the skill vault by keyword. Triggers on: find skill, which skill, search skills, discover skill, load skill, skill vault, pointer skill, resolve skill, skill for this task."
---

# Skill Discovery

## Purpose

Most domain-specific skills are stored in the **skill vault** (`~/.copilot/skills-vault/`) and are NOT loaded into agent context by default. This keeps token usage low. When you need domain-specific knowledge, use this skill's patterns to find and load the right skill on demand.

In the first-class Instruction Engine workflow, `@search` is the preferred capability-discovery layer and `@execute` is the preferred capability-application layer. This skill remains the always-loaded meta-skill that those agents, and any direct callers, use for vault routing.

## Related docs

- System docs index: `docs/system/index.md`
- Skills governance: `docs/system/skills-governance.md`
- Skills governance MOC: `docs/system/mocs/skills-governance.md`
- Research promotion checklist: `docs/system/research-promotion-checklist.md`

## Architecture

```
~/.copilot/
├── skills/                    ← VS Code scans this (always-loaded, few items)
│   ├── skill-discovery/       ← THIS skill (meta)
│   ├── core-guardrails/       ← Safety rules
│   ├── implementation-friction/← Code quality feedback
│   └── stack-detector/        ← Project tech detection
│
└── skills-vault/              ← NOT scanned by VS Code (on-demand, many items)
    ├── firebase-auth/SKILL.md
    ├── wolverine-core/SKILL.md
    ├── marten-documents/SKILL.md
    └── ... (30+ domain skills)
```

## Deterministic Resolver Chain

Use this exact order when the right skill is not already known:

1. Stack detection
2. Keyword map
3. Skill metadata search (generated index first)
4. Semantic fallback

Rules:
- Stop at the first step that yields a confident match.
- If the user or task already names a specific skill, skip the chain and use direct load.
- Keep selection deterministic: on ties, choose lexical order by skill name.

## Discovery Patterns

### Pattern 1: Stack Detection (project-wide)

When starting work on a new project or when the tech stack is unclear, use stack detector:

1. Load and follow stack detector (always available in `~/.copilot/skills/`)
2. It scans project files (`.csproj`, `package.json`, `*.tf`, etc.)
3. Returns a list of relevant skill names
4. Load each skill from the vault using Pattern 3

### Pattern 2: Keyword Search (task-specific)

When you know what domain you need (e.g., "I need to write a Wolverine endpoint"):

1. Identify keywords from the task: `wolverine`, `endpoint`, `HTTP handler`
2. Look for a matching skill in `~/.copilot/skills-vault/` by listing the directory
3. Read the target `SKILL.md`: `~/.copilot/skills-vault/{skill-name}/SKILL.md`

Common keyword → skill mappings:
- Auth alias, backward-compatible auth guidance → `auth`
- Firebase, auth, ID token → `firebase-auth`
- Wolverine, message handler, CQRS → `wolverine-core`
- Wolverine endpoint, HTTP handler → `wolverine-http`
- Marten, document store → `marten-documents`
- Marten, event sourcing → `marten-events`
- Marten, LINQ → `marten-linq-querying`
- Orleans, grain, virtual actor → `orleans`
- SignalR, real-time, WebSocket → `signalr`
- Aspire, AppHost → `aspire-apphost`
- Aspire, deploy → `aspire-deployment`
- React Query, useQuery → `react-query`
- Terraform, IaC → `terraform`
- Docker, compose → `deployment-compose`
- xUnit, NSubstitute, unit test (.NET) → `testing-dotnet-unit`
- Vitest, React Testing Library → `testing-frontend-unit`
- Alba, integration test → `alba-integration-tests`
- OpenTelemetry, logging, Grafana → `logging-observability`
- OpenAI, GPT, chat completion → `openai-compatible`
- Semantic Kernel, SK agents → `microsoft-agent-framework`
- Microsoft Agent Framework → `microsoft-agent-framework`
- C#, .NET, ASP.NET → `csharp-expert`
- React, Vue, frontend UI → `frontend`
- Security, OWASP, vulnerability → `security`
- Code review, PR review → `code-review`
- Refactor, restructure → `refactor`
- Debug, investigate → `debug`
- Architecture, design, ADR → `planning-feature`
- Plan feature, break down → `planning-feature`
- Plan pack, plan authoring → `planpack-authoring`
- Audit report, finding format → `audit-report-formats`
- Stack audit, pattern check → `stack-audit-patterns`
- Critic mode, challenge assumptions, devil's advocate → `critic`
- System cleanup, archive completed tasks, cleanup tasks → `system-cleanup`
- E2E, browser automation → `e2e-workflow`
- Agent browser CLI → `agent-browser`
- Playwright MCP → `agent-browser`
- Instruction quality → `instruction-quality`
- Test caching → `test-caching-verification`
- Friction review, friction analysis, friction cluster, refactor priority, friction feedback → `friction-feedback`
- Create skill, author skill, skill template, forge skill → `skill-forge`
- Doc conflict, source of truth, stale docs, truth hierarchy, code vs docs → `truth-sync`

### Pattern 3: Skill Metadata Search (keyword miss)

When keyword map does not produce a clear match:

1. Read the generated index `engine-assets/skills/skill-metadata-index.json` (deterministic source of `name`/`description`/`triggersOn`, conforms to Elegy `skill-discovery-index.schema.json`)
2. Rank candidates by trigger overlap with task terms
3. Read the top candidate `SKILL.md` only when needed to confirm fit
4. If ties remain, choose lexical order by skill name

### Pattern 4: Semantic Fallback (last resort)

When stack detection, keyword map, and metadata search are inconclusive:

1. Compare task intent against each candidate skill's description and trigger phrases
2. Choose the narrowest domain fit
3. If still ambiguous, pick one skill, load it, and re-evaluate before loading others

### Pattern 5: Direct Load (known skill name)

When you already know the skill name:

```
read_file("~/.copilot/skills-vault/{skill-name}/SKILL.md")
```

Replace `~/.copilot` with the actual Copilot home path if `XDG_CONFIG_HOME` is set.

### Pattern 6: CLI Search/Load (terminal-based)

When you prefer programmatic discovery via terminal (useful for scripting, CI, or when `read_file` is not available):

**Search for skills by query:**
```bash
node scripts/skill-search.mjs "wolverine"           # human-readable output
node scripts/skill-search.mjs --json "auth"          # JSON array with name, description, vaultRef, score
node scripts/skill-search.mjs                        # list all skills (no query)
```

**Load a skill's SKILL.md content:**
```bash
node scripts/skill-load.mjs wolverine-core           # prints SKILL.md to stdout
```

Security: `skill-load.mjs` rejects path traversal (`..`, `.`), symlinks, and paths outside the skills root. Follows the same confinement patterns as `RannIA/src/utils/pathSecurity.ts`.

These scripts read from `engine-assets/skills/skill-metadata-index.json` (search) and `engine-assets/skills/{name}/SKILL.md` (load). They are the CLI equivalent of Patterns 2–5.

## Resolution Rules

1. **Always-loaded skills** (`~/.copilot/skills/`): Already in your context — just follow them.
2. **On-demand skills** (`~/.copilot/skills-vault/`): Must be explicitly loaded via `read_file` when needed.
3. **If a skill doesn't exist in the vault**: The skill is not installed. Proceed with general knowledge — do not hallucinate skill content.
4. **Load skills lazily**: Only load a skill when you actually need its domain-specific guidance for the current task. Don't pre-load everything.
5. **One skill at a time**: Load the most specific skill first. If it references other skills, load those as needed.

## Multi-Skill Orchestration Policy

- Select one **primary skill** that directly matches the core task domain.
- Add **supporting skills** only for concrete cross-cutting needs (testing, security, deployment, audit format).
- Cap loaded skills per turn at 3 total: 1 primary + up to 2 supporting.
- Budget context intentionally: load primary first, then add supporting skills only when the current step needs them.
- If context gets tight, unload in this order: least recently used supporting skill, then lowest relevance supporting skill.

## When to Use This Skill

- **Starting a new task**: Check if the task involves a specific framework/library → search vault
- **Delegating to subagents**: Include the resolved skill content in the subagent prompt
- **Stack detection returned skill names**: Load each from vault before implementing
- **Agent instructions say "load skill X"**: Resolve from vault, not from the always-loaded set
- **Encountering unfamiliar patterns**: Search vault by keyword for relevant guidance
