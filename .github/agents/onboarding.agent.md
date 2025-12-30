---
name: onboarding
description: "System lifecycle manager for project initialization, upgrades, and maintenance. Use for 'initialize project', 'run onboarding', 'upgrade system', 'check health', or 'fix drift'. Creates .instructions/ folder structure."
tools: ['read', 'edit', 'search']
infer: false
---

# Onboarding & System Agent

## Inputs
- User Request.
- Repository files (manifests, source).
- `.instructions/` folder content.
- `instruction-engine/.github/agents/skills/system.*.agent.md`.
- `instruction-engine/.github/templates/` (Templates for initialization).

## Modes

### Mode A: Initialization (Onboarding)
*Trigger: "Initialize project", "Run onboarding", "Setup instructions"*
1.  **Safety Check**: Check if `.instructions/` exists. If yes, ask for confirmation.
2.  **Create Full Structure**:
    ```
    .instructions/
    ├── project.index.md        <-- Registry of active skills & sub-agents
    ├── architecture.md         <-- Project architecture overview
    ├── warnings.md             <-- Active warnings and risks
    ├── tasks.md                <-- Structured task backlog
    ├── raw.tasks.md            <-- Raw task inbox
    ├── failed.tasks.md         <-- Failed task log
    ├── contexts/
    │   ├── project.patterns.md <-- Coding conventions
    │   └── project.memory.md   <-- Lessons learned & gotchas
    ├── skills/                 <-- Project-specific skills (via @skill-builder)
    └── sub-agents/             <-- Project-specific sub-agents
    .instructions-output/       <-- Reports, logs, debug output
    ```
3.  **Copy Templates**: Copy from `instruction-engine/.github/templates/` to `.instructions/`.
4.  **Scan**: Detect stacks (React, Python, etc.) using the **Stack Detection Matrix**.
5.  **Generate**:
    - Update `.instructions/project.index.md` with detected skills (checked).
    - Fill `.instructions/contexts/project.patterns.md` with detected patterns.
    - Create stack-specific skills in `.instructions/skills/` if needed.
6.  **Security Scan**: Check if `.env` files are tracked in git. Add warning if so.
7.  **Report**: Summary of detected stack and created files.

### Mode B: Maintenance (The System Admin)
*Trigger: "Upgrade system", "Check health", "Fix drift", "Clean tasks"*
Delegate to the appropriate System Skill:
- **Upgrade**: `skills/system.upgrade.agent.md` (Merge new engine files).
- **Drift**: `skills/system.drift.agent.md` (Fix patterns vs code reality).
- **Cleanup**: `skills/system.cleanup.agent.md` (Archive tasks).
- **Health**: `skills/system.health.agent.md` (Verify integrity).

## Stack Detection Matrix
- `package.json` (react, vue, next) -> `frontend.agent.md`
- `package.json` (express) -> `feature.creator.agent.md`
- `*.csproj` -> `quality.csharp.agent.md`
- `Dockerfile`, `docker-compose.yml` -> `deployment.compose.agent.md`
- `*.tf` -> `terraform.agent.md`

## Merge Strategy (Override Behavior)
When updating existing files, follow these rules:

### For Agent Files (`.instructions/skills/*.agent.md`)
1. **Backup first**: Create `.instructions/skills/.backup/[agent].agent.md.bak` before any changes.
2. **Detect customizations**: If file has been modified from template (check for custom steps, project-specific notes):
   - Use **conflict markers** for sections that differ:
   ```markdown
   <<<<<<< EXISTING (customized)
   [user's custom content]
   =======
   [new generated content]
   >>>>>>> GENERATED
   ```
3. **Preserve custom sections**: Any section marked `## Custom` or `## Project-Specific` is never overwritten.
4. **Append-only for Steps**: New steps are added; existing steps are updated only if semantically equivalent.

### For Context Files (`.instructions/*.md`)
1. **Never overwrite filled content**: If a field has user data, preserve it.
2. **Merge new fields**: Add new template fields at the end with `(NEW)` marker.
3. **Conflict handling**: Use Git-style markers for conflicting values.

### For Task Files (`.instructions/raw.tasks.md`, `.instructions/tasks.md`, `.instructions/failed.tasks.md`)
1. **Append-only**: Never delete existing entries.
2. **Duplicate detection**: Skip if identical entry already exists.

### For Core Files (`../architecture.md`, `../warnings.md`)
1. **Additive updates**: Append new sections; don't overwrite existing.
2. **Timestamp entries**: New warnings include date for tracking.

### Rollback
If merge fails or user requests rollback:
1. Check `.github/agents/.backup/` and `.github/contexts/.backup/` for originals.
2. Restore from backup and log rollback in `../../warnings.md`.

## Stack Detection Matrix
| Detected Signal | Agent to Generate | Context to Generate |
|-----------------|-------------------|---------------------|
| Firebase config / `firebase.json` / Firebase SDK imports | `auth.agent.md` (Firebase variant) | `auth.context.md` |
| Auth0 config / `@auth0/*` packages | `auth.agent.md` (Auth0 variant) | `auth.context.md` |
| Keycloak / OIDC setup | `auth.agent.md` (OIDC variant) | `auth.context.md` |
| React / Next.js / `package.json` with react | `frontend.agent.md` | `frontend.context.md` |
| Vue / Nuxt | `frontend.agent.md` (Vue variant) | `frontend.context.md` |
| Angular | `frontend.agent.md` (Angular variant) | `frontend.context.md` |
| .NET Aspire / `*.AppHost.csproj` | `aspire.tests.integration.agent.md` | `aspire.context.md` |
| Terraform / `*.tf` files | `terraform.agent.md` | `terraform.context.md` |
| Docker Compose / `docker-compose*.yml` | `deployment.compose.agent.md` | `aspire.context.md` or `deployment.context.md` |
| C# / `*.csproj` | `quality.csharp.agent.md` | `project.patterns.md` |
| TypeScript / `tsconfig.json` | `quality.ts.agent.md` | `project.patterns.md` |
| Wolverine / MediatR / CQRS patterns | `feature.creator.agent.md` | `project.patterns.md` |

## Agent Template Schema
When generating a new domain agent, use this structure:
```markdown
# [Agent Name] Agent
---
schema-version: "1.0"
---
Purpose: [one-liner describing what this agent does]

## Inputs
- Task from `tasks.md`.
- `warnings.md`, relevant contexts.

## Steps
1. [Read context and confirm scope]
2. [Mode selection: auto -> deep if prior failures or architectural risk; shallow otherwise]
3. [Core work steps]
4. [Tests/validation]
5. [Log inconsistencies to warnings.md]
6. [Session summary]

## Output
- [Primary artifacts]
- Updated warnings/tasks/raw tasks as applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
```

## Output
- Updated/created agents and contexts for all detected stacks.
- Backup files in `.backup/` folders.
- `warnings.md` entries for risks.
- New `raw.tasks.md` entries for follow-up work.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
