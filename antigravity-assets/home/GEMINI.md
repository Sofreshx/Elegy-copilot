## Instruction Engine

Use the shared instruction-engine skills installed under `~/.gemini/antigravity/skills`.

Instruction-engine keeps the current Antigravity CLI compatibility surface under the Gemini-compatible `~/.gemini` / `GEMINI.md` layout until upstream docs publish a different canonical root.

Shared spec-driven skills are available on demand: `spec-dev`, `spec-authoring`, and `spec-review`.
Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.

When a task clearly maps to an installed skill, load and follow that skill before proceeding.
Direct user instructions and local repository guidance still take precedence over these shared defaults.
