# Instruction Engine Skill Installer (VS Code Extension)

Shows:
- **Available** skills from `instruction-engine` (prefers `.github/skills`, falls back to `.codex/skills`).
- **Loaded** skills in other workspace repos (targets), from their `.github/skills` folder.
- **Tasks** from any workspace repo that has `.instructions/tasks/*.md`.
- **Agents** from any workspace repo that has `.github/agents/*.agent.md`.

The **Tasks** view reads each task file’s YAML front matter (e.g. `title`, `status`, `owner`, `skills`) and lets you filter down to “my tasks”.

## Why `F5` opens a new VS Code window

That window is the **Extension Development Host**. VS Code intentionally runs extensions under development in a separate host window so you can debug safely without crashing/locking up your main editor session.

If you want to use the extension in your *current* window, you need to install it like a normal extension (dev-linked or packaged) and then reload.

## Use the extension in your current window

### Option A (recommended): dev-link from folder (fast iteration)

1. Build once:
	- `npm install`
	- `npm run compile`
2. In the VS Code window you want to use:
	- Run **Developer: Install Extension from Location...**
	- Select the `vscode-skill-installer/` folder
	- Run **Developer: Reload Window**

After that, iterate with:
- `npm run watch` (keeps `dist/` up to date)
- **Developer: Reload Window** to pick up changes

### Option B: package to a VSIX

1. `npm install`
2. `npm run package` (creates a `.vsix`)
3. In the VS Code window you want to use:
	- Run **Extensions: Install from VSIX...**
	- Pick the generated `.vsix`
	- Reload window

## Run locally (debug mode)

From VS Code:
- Open this repo.
- Press `F5` using the **Run Extension** launch config.

## Commands
- `Skill Installer: Refresh Skills, Tasks & Agents`
- `Skill Installer: Clear Repo Context`
- `Skill Installer: Clear Context for All Repos`

## Settings
- `skillInstaller.tasks.onlyOwner`: When enabled, only show tasks whose front matter `owner` matches `skillInstaller.tasks.owner`.
- `skillInstaller.tasks.owner`: Your dev handle (e.g. `lolzi`).

## Direction (scope expansion)

This extension is expected to grow beyond “skill installer” into a general **Instruction Engine Prompting Settings** extension (settings + UI + project scaffolding), with the goal of not needing to add `instruction-engine` as a workspace folder.
