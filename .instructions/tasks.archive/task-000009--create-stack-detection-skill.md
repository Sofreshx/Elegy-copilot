---
id: task-000009
title: "Create Stack Detection Skill"
status: done
priority: high
owner: agent
depends_on: []
skills: []
created: 2026-01-31
updated: 2026-01-31
---

# task-000009: Create Stack Detection Skill

## Summary
Create a skill that automatically detects the tech stack from project files and returns relevant skill names to load.

## Acceptance Criteria
- [x] Skill file `.github/skills/stack-detector/SKILL.md` created
- [x] Detects frameworks from `.csproj`, `package.json`, `*.sln`
- [x] Identifies: Marten, Wolverine, Orleans, SignalR, Aspire, React, etc.
- [x] Returns list of matching skill names
- [x] Documents detection heuristics

## Implementation Notes
- Check for package references in `.csproj` files
- Check `dependencies` in `package.json`
- Use namespace patterns as secondary signals
- Return skill names that exist in `.github/skills/`
