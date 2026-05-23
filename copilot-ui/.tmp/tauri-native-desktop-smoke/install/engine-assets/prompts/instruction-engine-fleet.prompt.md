---
name: instruction-engine-fleet
description: Split work into independent workstreams for /fleet, minimizing file conflicts and defining integration and policy-aware validation coverage.
---

Split this task into independent workstreams suitable for Copilot CLI `/fleet` (parallel subagents).

Before proceeding, apply `core-guardrails` safety constraints (especially terminal/background-process rules).

Constraints:
- Assign exclusive file/directory ownership per workstream to reduce merge conflicts.
- Prefer additive changes over broad refactors.
- Each workstream must specify the required validation layer(s) for its scope, who runs them (workstream runner vs coordinator/integration owner), and any known coverage gaps or why no gap remains.
- Treat narrow checks (targeted build/test/lint) as the default only when higher-layer validation is not required by policy, risk, or unresolved coverage gaps.
- If policy, risk, or coverage gaps require broader validation, explicitly escalate to the necessary layer and identify the coordinator-owned follow-up.

Output format:
- Workstream 1: <title> — <owner paths> — <acceptance criteria> — <required validation layers> — <validation runner/coordinator> — <coverage gaps or none> — <validation>
- Workstream 2: ...
- Integration step: <cross-workstream merge/integration> — <required higher-layer validation and owner> — <coverage gaps/reporting>
