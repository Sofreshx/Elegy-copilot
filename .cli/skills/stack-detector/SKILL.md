---
name: stack-detector
description: "Automatic tech stack detection. Scans project files to identify frameworks, libraries, and infrastructure. Use this when asked to detect stack, identify technologies, discover frameworks, or determine which skills apply to a codebase."
---

# Stack Detection Skill (CLI distribution)

## Purpose
Detect frameworks, libraries, and infrastructure from common project files and return the relevant skill names that exist in the installed skills directory.

## Minimal detection signals
- `.csproj`, `.sln` → likely .NET
- `package.json` → Node.js / frontend
- `docker-compose*.yml` → Docker Compose
- `*.tf` → Terraform

## Output
Return a deduplicated list of skill names (folders) that exist under `~/.copilot/skills/`.

