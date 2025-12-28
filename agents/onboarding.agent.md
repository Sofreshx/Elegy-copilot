# Onboarding Agent
---
schema-version: "1.0"
---
Purpose: scan a host repository, detect patterns, generate tailored agents/contexts, and log inconsistencies.

## Inputs
- Repository files (project manifests, source samples, tests, infra).
- Existing `warnings.md`, `failed.tasks.md` (for prior issues).

## Steps
1. Read `warnings.md`, `architecture.md` (if present), and manifests (`package.json`, `.csproj`, `Dockerfile`, `docker-compose.yml`, IaC files).
2. Detect stacks and patterns using the **Stack Detection Matrix** below.
3. Generate or update agents/contexts for ALL detected stacks in one pass using the **Merge Strategy** below:
   - `contexts/project.patterns.md` summarizing conventions.
   - Stack contexts per detection matrix.
   - Domain agent files per detection matrix.
4. Append findings to `warnings.md` for inconsistencies (mixed patterns, missing tests, drift between modules).
5. Add `raw.tasks.md` items for missing docs, refactors, or fixes.
6. Produce a session summary.

## Merge Strategy (Override Behavior)
When updating existing files, follow these rules:

### For Agent Files (`agents/*.agent.md`)
1. **Backup first**: Create `agents/.backup/[agent].agent.md.bak` before any changes.
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

### For Context Files (`contexts/*.md`)
1. **Never overwrite filled content**: If a field has user data, preserve it.
2. **Merge new fields**: Add new template fields at the end with `(NEW)` marker.
3. **Conflict handling**: Use Git-style markers for conflicting values.

### For Task Files (`raw.tasks.md`, `tasks.md`, `failed.tasks.md`)
1. **Append-only**: Never delete existing entries.
2. **Duplicate detection**: Skip if identical entry already exists.

### For Core Files (`architecture.md`, `warnings.md`)
1. **Additive updates**: Append new sections; don't overwrite existing.
2. **Timestamp entries**: New warnings include date for tracking.

### Rollback
If merge fails or user requests rollback:
1. Check `agents/.backup/` and `contexts/.backup/` for originals.
2. Restore from backup and log rollback in `warnings.md`.

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
| Go / `go.mod` | `quality.go.agent.md` | `go.context.md` |
| Python / `pyproject.toml` / `requirements.txt` | `quality.python.agent.md` | `python.context.md` |
| NestJS / `@nestjs/*` | `feature.creator.agent.md` (NestJS variant) | `nestjs.context.md` |
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
