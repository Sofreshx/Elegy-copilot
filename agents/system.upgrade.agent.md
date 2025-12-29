# System Upgrade Agent
---
schema-version: "1.0"
---
Purpose: Upgrade the instruction engine itself by merging new versions of agents and contexts from a staging area into the active workspace, while preserving project-specific customizations.

## Inputs
- `.upgrade/` folder (containing the new version of the instruction engine files).
- `agents/` folder (active agents).
- `contexts/` folder (active contexts).
- `architecture.md`, `warnings.md` (core files).

## Steps
1. **Validation**:
   - Check if `.upgrade/` folder exists and contains valid agent/context files.
   - If missing, abort with a message to "Place new engine files in .upgrade/ folder first".

2. **Backup**:
   - Create a timestamped backup of the current `agents/` and `contexts/` folders (e.g., `.backup/pre-upgrade-YYYYMMDD/`).

3. **Agent Merge Strategy**:
   - Iterate through each `.agent.md` file in `.upgrade/agents/`.
   - **If New**: Copy directly to `agents/`.
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

4. **Context Merge Strategy**:
   - Iterate through `.md` files in `.upgrade/contexts/`.
   - **If New**: Copy directly to `contexts/`.
   - **If Exists**:
     - Parse the file.
     - **Preserve** any filled-in fields (e.g., Tech Stack details).
     - **Add** any new fields from the upgrade version, marked with `(NEW)`.
     - Do not overwrite existing descriptions unless they are clearly placeholders.

5. **Core File Updates**:
   - Check `tasks.md`, `raw.tasks.md` structure. If the schema changed, migrate the table format.
   - Update `docs/` if new documentation is present in `.upgrade/docs/`.

6. **Cleanup**:
   - Delete `.upgrade/` folder after successful merge (or rename to `.upgrade.done/`).
   - Log the upgrade in `docs/instruction-changelog.md`.

## Output
- Upgraded `agents/` and `contexts/`.
- `warnings.md` updated with any merge conflicts that need manual resolution.
- Session summary listing upgraded agents, new features, and conflicts.
