# GitHub Copilot CLI Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Harness

This is the GitHub Copilot CLI (`copilot`) harness, invoked through the `ghcp`
wrapper for BYOK model routing and lane selection.

Use `docs/system/ghcp-guide.md` for install commands, provider profiles, model
requirements, and OpenCode comparison details.

## Lanes

Use the `ghcp` wrapper commands:

| Command | Use |
|---|---|
| `ghcp quick <prompt>` | Small, low-ambiguity changes |
| `ghcp project <prompt>` | Multi-session or planning-heavy work |
| `ghcp impl <prompt>` | Bounded implementation |
| `ghcp explorer <prompt>` | Read-only code discovery |
| `ghcp reviewer <prompt>` | Read-only review |
| `ghcp scout <prompt>` | External research |

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local
  `AGENTS.md` only when a repo actually needs them.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.
- Keep provider/profile reference details in `docs/system/ghcp-guide.md`.
