---
name: lane-quick
description: "Small UI tweaks and tiny bug fixes. Flash only; no spec or roadmap by default."
triggers:
  - quick fix
  - small tweak
  - tiny bug
  - ui nit
  - minor change
  - lane quick
---

# Lane: Quick

Small UI tweaks and tiny bug fixes. No spec or roadmap required.

## When To Use

- CSS/layout nits and alignment fixes
- Typo or copy corrections
- One-line logic fixes in well-understood code
- Toggle or flag changes
- Any change that takes <5 minutes, touches 1-2 files, and has no ambiguity

## When NOT To Use

- If the change touches a contract boundary, API surface, or user-facing behavior → use `lane-standard` or `lane-spec`
- If the change requires exploration of unfamiliar code → use `lane-standard`
- If the fix might have cascading effects → escalate to `lane-standard`

## Model Role

- **Default:** `small` (DeepSeek V4 Flash)
- **Escalation trigger:** Not needed by design
- If scope exceeds lane bounds mid-work, stop and recommend `lane-standard`

## Workflow

1. Understand the issue from context or the user's description
2. Make the minimal change in 1-2 files
3. Run the narrowest relevant validation (lint, affected tests)
4. Present the diff for confirmation

## Validation Standard

- Run lint on changed files
- Run tests directly exercising the changed code
- No broad test suite run required

## Output Contract

- **Done:** [change applied, validation passed]
- **Changes:** [file:line references]
- **Next:** [nothing, or escalate recommendation if scope exceeded]

## Safety

- Do not change public APIs, exported types, or user-facing strings without escalating
- Do not change error handling paths or control flow without escalating
- Do not introduce new dependencies or configuration knobs
