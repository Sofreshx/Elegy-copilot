---
name: repo-skill-sync-demo
description: "Use when checking or demonstrating repo-local skill mirroring across Copilot, Codex, OpenCode, Gemini CLI, and Antigravity in instruction-engine. Triggers on: repo skill sync demo, skill mirror demo, cross-harness skill example."
---

# Repo Skill Sync Demo

This is a minimal demo skill used to prove the repo-local skill mirror contract and validation path.

## Purpose

- keep one canonical repo-local skill under `.github/skills`
- mirror it deterministically into Codex, OpenCode, and Gemini-family repo-local skill folders
- use it as a safe fixture when changing sync tooling

## Validation

```powershell
node scripts/sync-repo-skills.mjs --targets codex,opencode,gemini-cli
node scripts/validate-repo-skill-sync.js
```
