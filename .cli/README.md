# .cli/

Contains the install contract for the engine.

- `manifest.allowlist.json` — allowlist for which agents/skills/prompts ship in the generated manifest
- `manifest.json` — generated install/shipping manifest (validated by `scripts/validate-manifest.js`)

All canonical assets (agents, skills, prompts, instructions) live in `engine-assets/`.
Generate the allowlisted shipping manifest with:

```bash
node scripts/generate-cli-manifest.mjs
```

The legacy `.cli/ui/` dashboard remnants have been removed. The active local dashboard now lives in
`copilot-ui/` at the repo root.
