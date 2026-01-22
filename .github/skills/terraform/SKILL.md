---
name: terraform
description: "Terraform infrastructure as code. Creates and modifies IaC for cloud resources. Triggers on: terraform, infrastructure, IaC."
---

# Terraform Skill

## Inputs
- Task from a task file under `.instructions/tasks/`.
- `../../warnings.md`, `../../contexts/terraform.context.md`, `../../contexts/project.patterns.md`.

## Steps
1. Review provider setup, backends, and modules; align with existing patterns.
2. Mode selection: auto -> deep if touching shared modules or prior failures exist; shallow for variable/output tweaks.
3. Implement changes with drift awareness; plan for state and environments.
4. Add/update docs and examples; ensure validation/formatting runs.
5. Log inconsistencies in `../../warnings.md` (snowflake resources, missing tagging, env drift) and add follow-up tasks.

## Output
- Terraform changes and docs.
- Updated warnings/tasks/raw tasks if applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks**: [any new task files created]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any ../../warnings.md updates]
- **Next**: [suggested next actions]


