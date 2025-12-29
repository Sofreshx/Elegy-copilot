# Instruction Engine Upgrade Guide

This guide explains how to update the **Agentic Pattern** instruction engine in your repository to the latest version while preserving your local customizations.

## The Upgrade Process

We use a **System Upgrade Agent** to intelligently merge updates. This ensures that your custom agent steps, project-specific contexts, and tailored instructions are not lost.

### Prerequisites
- You have the **new version** of the instruction engine files (e.g., from the source repository).
- You have a clean working tree (commit your changes first).

### Steps

1.  **Prepare the Upgrade Package**:
    - Create a folder named `.upgrade` in the root of your workspace.
    - Copy the *new* `.github/` folder (containing `agents/`, `contexts/`, `docs/`) into `.upgrade/`.
    - Structure should look like:
      ```
      .upgrade/
        agents/
          project-planner.agent.md
          skills/
            ...
        contexts/
          ...
      ```

2.  **Run the Upgrade Agent**:
    - Ask Copilot:
      > "Run the system.upgrade.agent.md to upgrade my instruction engine."
    - **Note**: If you are upgrading from an older version (where agents were in the root `agents/` folder), the upgrade agent will automatically move them to `.github/agents/` for you.

3.  **Review Changes**:
    - The agent will merge the new files into your active `.github/agents/` and `.github/contexts/` folders.
    - **Check for Conflicts**: If the agent couldn't automatically resolve a change (e.g., you heavily modified a standard step that also changed in the new version), it will leave conflict markers:
      ```markdown
      <<<<<<< CURRENT (Customized)
      ...
      =======
      ...
      >>>>>>> INCOMING
      ```
    - Search for `<<<<<<<` in your workspace and resolve these manually.

4.  **Verify**:
    - Check `warnings.md` for any upgrade notes.
    - The `.upgrade` folder will be removed or renamed upon success.

## Migration Notes (v1 -> v2)
If you are upgrading from the flat structure (agents in root) to the new `.github` structure:
1.  The upgrade agent will move your existing files to `.github/agents` and `.github/contexts`.
2.  It will then merge the new "Executive vs Skill" hierarchy.
3.  Your existing domain agents will be moved to `.github/agents/skills/`.
4.  **Action Required**: You may need to update any custom scripts that referenced `agents/` directly.

## What is Preserved?
- **Custom Sections**: Any content under `## Custom` or `## Project-Specific` headers in agents.
- **Context Data**: Filled-in fields in `contexts/*.md` (e.g., your specific tech stack choices).
- **Task History**: Your `tasks.md` and `tasks.archive.md` are untouched (unless the table schema itself requires migration).
