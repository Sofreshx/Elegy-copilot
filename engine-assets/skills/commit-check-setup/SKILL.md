---
name: commit-check-setup
description: "Compatibility route for older requests to set up commit checks or Elegy-managed .githooks. Route new setup, migration, and repair work to repo-quality-setup."
---

# Commit Check Setup (Compatibility)

Use the `repo-quality-setup` skill for all new setup, update, migration, and repair work. Preserve this skill name only so existing prompts and installations fail forward to the current workflow.

Do not run the legacy bootstrap coordinator unless the user explicitly requests the historical `.copilot/commit-checks.json` and `.githooks` implementation after being told that it is deprecated.
