## Instruction Engine

Use the shared instruction-engine skills installed under `~/.gemini/antigravity/skills`.

Instruction-engine keeps the current Antigravity CLI compatibility surface under the Gemini-compatible `~/.gemini` / `GEMINI.md` layout until upstream docs publish a different canonical root.

Shared routing skills include `skill-discovery` and `stack-detector`.
Planning, review, and spec skills are installed by default: `rubberduck-plan-review`, `roadmap-planning`, `implementation-handoff`, `implementation-review`, `spec-dev`, `spec-authoring`, and `spec-review`.
Load them only when the current step needs that guidance.
Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.

When a task clearly maps to an installed skill, load and follow that skill before proceeding.
Narrow candidate constraints to the minimum hard constraints needed for the active step instead of copying full upstream rule sets.
Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions.
Direct user instructions and local repository guidance still take precedence over these shared defaults.
