---
name: instruction-engine-fleet
description: Split work into independent workstreams for /fleet, minimizing file conflicts and defining an integration/validation step.
---

Split this task into independent workstreams suitable for Copilot CLI `/fleet` (parallel subagents).

Constraints:
- Assign exclusive file/directory ownership per workstream to reduce merge conflicts.
- Prefer additive changes over broad refactors.
- Each workstream must end with a short integration step (narrow build/test/lint).

Output format:
- Workstream 1: <title> — <owner paths> — <acceptance criteria> — <validation>
- Workstream 2: ...
- Integration step: ...
