---
name: skill-forge
description: "Pointer stub — skill creation is now handled by Elegy SkillForgeService. Triggers on: create skill, author skill, skill template, forge skill, project skill, runtime skill."
---

# Skill Forge (Elegy Pointer)

> **This skill has been migrated to Elegy.** The canonical implementation lives in `Elegy.Formalization.SkillForge.SkillForgeService`.

## How to Invoke

Use `SkillForgeService.Forge(SkillForgeRequest)` from the `Elegy.Formalization.SkillForge` namespace.

```csharp
var engine = new DynamicSkillEngine(new DynamicSkillEngineOptions { IsEnabled = true });
var service = new SkillForgeService(engine, new SkillForgeOptions());
var result = service.Forge(new SkillForgeRequest
{
    Name = "my-new-skill",
    Description = "What this skill does",
    Triggers = [new SkillTrigger { Pattern = "trigger phrase" }],
    Constraints = [new SkillConstraint { ConstraintId = "scope", Description = "project-only", Required = true }],
    DiscoveryKeywords = ["keyword1", "keyword2"]
});
```

## What Moved

- **Naming enforcement** (kebab-case regex) → `SkillForgeService`
- **Governance bar** (triggers, constraints, description required) → `SkillForgeService`
- **Registration metadata** → `RegistrationMetadata` record
- **Schema validation** → `skill-forge-request.schema.json` contract
