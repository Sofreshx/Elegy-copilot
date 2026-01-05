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
- `instruction-engine/.github/skills/system-*/SKILL.md`.
- `instruction-engine/.github/templates/` (Templates for initialization).

## Modes

### Mode A: Initialization (Onboarding)
*Trigger: "Initialize project", "Run onboarding", "Setup instructions"*
1.  **Safety Check**: Check if `.instructions/` exists. If yes, ask for confirmation.
2.  **Create Full Structure**:
    ```
    .instructions/
    ├── project.index.md        <-- Registry of active skills & project-local agent wrappers
    ├── architecture.md         <-- Architecture overview + patterns/conventions
    ├── tasks.md                <-- Structured task backlog
    ├── raw.tasks.md            <-- Raw task inbox
    ├── failed.tasks.md         <-- Failed task log
    ├── contexts/
    │   └── project.memory.md   <-- Lessons, gotchas, active warnings/risks
    ├── skills/                 <-- Project-specific skills (via @skill-builder)
    └── sub-agents/             <-- Project-specific agent wrappers
    .instructions-output/       <-- Reports, logs, debug output
    ```
3.  **Copy Templates**: Copy from `instruction-engine/.github/templates/` to `.instructions/`, deleting legacy files if present (`warnings.md`, `contexts/project.patterns.md`).
4.  **Scan**: Detect stacks (React, Python, etc.) using the **Stack Detection Matrix**.
5.  **Generate**:
    - Update `.instructions/project.index.md` with detected skills (checked).
    - Append detected patterns into the `Patterns & Conventions` section of `.instructions/architecture.md`.
    - Create stack-specific skills in `.instructions/skills/` if needed.
6.  **Git Configuration**:
    - Check if `.gitignore` exists.
    - Append `.instructions/` to `.gitignore` (Project-specific context should be private/local by default).
    - Append `.instructions-output/` to `.gitignore`.
    - Append `.github/skills/` to `.gitignore` (if using local skill overrides).
7.  **Security Scan**: Check if `.env` files are tracked in git. Add warning if so.
8.  **Report**: Summary of detected stack and created files.

### Mode B: Maintenance (The System Admin)
*Trigger: "Upgrade system", "Check health", "Fix drift", "Clean tasks"*
Delegate to the appropriate System Skill:
- **Upgrade**: **Missing skill:** `skills/system-upgrade/SKILL.md` not found. Needed guidance: safe merge steps for engine updates (backup, conflict resolution, tests to run, and validation checks). Please add `system-upgrade/SKILL.md` with these procedures.
- **Drift**: `skills/system-drift/SKILL.md` (Fix patterns vs code reality).
- **Cleanup**: `skills/system-cleanup/SKILL.md` (Archive tasks).
- **Health**: `skills/system-health/SKILL.md` (Verify integrity).

## Stack Detection Matrix
- `package.json` (react, vue, next) -> `frontend/SKILL.md`
- `package.json` (express) -> `feature-creator/SKILL.md`
- `*.csproj` -> `csharp-expert/SKILL.md`
- `Dockerfile`, `docker-compose.yml` -> `deployment-compose/SKILL.md`
- `*.tf` -> `terraform/SKILL.md`

## Merge Strategy (Override Behavior)
When updating existing files, follow these rules:

### For Agent Files (`.instructions/skills/*/SKILL.md`)
1. **Backup first**: Create `.instructions/skills/.backup/[skill]/SKILL.md.bak` before any changes.
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
4. **Migrate legacy files**: If `.instructions/warnings.md` exists, append its content under `## ⚠️ Active Warnings` in `.instructions/contexts/project.memory.md` then delete the old file. If `.instructions/contexts/project.patterns.md` exists, append its content under `## Patterns & Conventions` in `.instructions/architecture.md` then delete the old file.

### For Task Files (`.instructions/raw.tasks.md`, `.instructions/tasks.md`, `.instructions/failed.tasks.md`)
1. **Append-only**: Never delete existing entries.
2. **Duplicate detection**: Skip if identical entry already exists.

### For Core Files (`.instructions/architecture.md`, `.instructions/contexts/project.memory.md`)
1. **Additive updates**: Append new sections; don't overwrite existing.
2. **Timestamp entries**: New warnings include date for tracking in the `## ⚠️ Active Warnings` section of `project.memory.md`.

### Rollback
If merge fails or user requests rollback:
1. Check `.instructions/skills/.backup/` for originals.
2. Restore from backup and log rollback in `.instructions/warnings.md`.

## Stack Detection Matrix
| Detected Signal | Skill to Activate | Context to Generate |
|-----------------|-------------------|---------------------|
| Firebase config / `firebase.json` / Firebase SDK imports | `auth/SKILL.md` (Firebase variant) | `auth.context.md` |
| Auth0 config / `@auth0/*` packages | `auth/SKILL.md` (Auth0 variant) | `auth.context.md` |
| Keycloak / OIDC setup | `auth/SKILL.md` (OIDC variant) | `auth.context.md` |
| React / Next.js / `package.json` with react | `frontend/SKILL.md` | `frontend.context.md` |
| Vue / Nuxt | `frontend/SKILL.md` (Vue variant) | `frontend.context.md` |
| Angular | `frontend/SKILL.md` (Angular variant) | `frontend.context.md` |
| .NET Aspire / `*.AppHost.csproj` | `aspire-integration-tests/SKILL.md` | `aspire.context.md` |
| Terraform / `*.tf` files | `terraform/SKILL.md` | `terraform.context.md` |
| Docker Compose / `docker-compose*.yml` | `deployment-compose/SKILL.md` | `deployment.context.md` |
| C# / `*.csproj` | `csharp-expert/SKILL.md` (alias: `quality-csharp`) | `project.patterns.md` |
| TypeScript / `tsconfig.json` | **Missing skill:** `quality-typescript/SKILL.md` not found. Needed instructions: linting rules, tsconfig conventions, recommended toolchain (ESLint, tsconfig strict settings, testing patterns). Add `quality-typescript/SKILL.md` or `.instructions/skills/quality-typescript/SKILL.md` | `project.patterns.md` |
| Wolverine / MediatR / CQRS patterns | `feature-creator/SKILL.md` | `project.patterns.md` |

## Output
- Updated/created skills and contexts for all detected stacks.
- Backup files in `.backup/` folders.
- `.instructions/warnings.md` entries for risks.
- New `.instructions/raw.tasks.md` entries for follow-up work.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
