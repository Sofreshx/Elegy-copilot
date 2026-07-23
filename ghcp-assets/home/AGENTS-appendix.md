# GitHub Copilot CLI Harness Appendix

## Harness

This is the GitHub Copilot CLI (`copilot`) harness, invoked through the `ghcp`
wrapper for BYOK model routing and lane selection.

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

- Do not change git branches unless explicitly asked.
