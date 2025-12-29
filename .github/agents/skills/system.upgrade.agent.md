# System Upgrade Agent
---
schema-version: "1.0"
---
Purpose: Upgrade the instruction engine itself by merging new versions of agents and contexts from a staging area into the active workspace, while preserving project-specific customizations.

## Inputs
- `.upgrade/` folder (containing the new version of the instruction engine files).
- `.github/agents/` folder (active agents).
- `.github/contexts/` folder (active contexts).
- `../../architecture.md`, `../../warnings.md` (core files).

## Steps
1. **Validation**:
   - Check if `.upgrade/` folder exists and contains valid agent/context files.
   - If missing, abort with a message to "Place new engine files in .upgrade/ folder first".

2. **Backup**:
   - Create a timestamped backup of the current `.github/agents/` and `.github/contexts/` folders (e.g., `.backup/pre-upgrade-YYYYMMDD/`).

3. **Migration Check (Folder Structure)**:
   - Check if the target repo is using the old structure (agents in root `agents/`).
   - If so, **Move** them to `.github/agents/` and `.github/contexts/` BEFORE merging.
   - Update `INSTALLATION_GUIDE.md` and `architecture.md` references if they point to the old locations.

4. **Agent Merge Strategy**:
   - Iterate through each `.agent.md` file in `.upgrade/agents/` (and subfolders like `skills/`).
   - **If New**: Copy directly to `.github/agents/`.
   - **If Exists**:
     - Read the *current* local file.
     - Check for `## Custom` or `## Project-Specific` sections.
     - Check for user modifications in standard steps.
     - **Merge**:
       - Overwrite standard sections (Purpose, Inputs, Output) with the new version.
       - **Preserve** `## Custom` sections exactly as they are.
       - If standard steps have changed significantly but the user also modified them, use **Conflict Markers**:
         ```markdown
         <<<<<<< CURRENT (Customized)
         [User's version]
         =======
         [New Version]
         >>>>>>> INCOMING
         ```
       - If the file is identical (hash check), skip.

5. **Context Merge Strategy**:
   - Iterate through `.md` files in `.upgrade/contexts/`.
   - **If New**: Copy directly to `.github/contexts/`.
   - **If Exists**:
     - Parse the file.
     - **Preserve** any filled-in fields (e.g., Tech Stack details).
     - **Add** any new fields from the upgrade version, marked with `(NEW)`.
     - Do not overwrite existing descriptions unless they are clearly placeholders.

6. **Core File Updates**:
   - Check `../../tasks.md`, `../../raw.tasks.md` structure. If the schema changed, migrate the table format.
   - Update `.github/docs/` if new documentation is present in `.upgrade/docs/`.

7. **Cleanup**:
   - Delete `.upgrade/` folder after successful merge (or rename to `.upgrade.done/`).
   - Log the upgrade in `.github/docs/instruction-changelog.md`.

## Output
- Upgraded `.github/agents/` and `.github/contexts/`.
- `../../warnings.md` updated with any merge conflicts that need manual resolution.
- Session summary listing upgraded agents, new features, and conflicts.
