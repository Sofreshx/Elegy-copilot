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
    - Copy the *new* `agents/`, `contexts/`, and `docs/` folders into `.upgrade/`.
    - Structure should look like:
      ```
      .upgrade/
        agents/
          task-runner.agent.md
          ...
        contexts/
          ...
      ```

2.  **Run the Upgrade Agent**:
    - Ask Copilot:
      > "Run the system.upgrade.agent.md to upgrade my instruction engine."

3.  **Review Changes**:
    - The agent will merge the new files into your active `agents/` and `contexts/` folders.
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

## What is Preserved?
- **Custom Sections**: Any content under `## Custom` or `## Project-Specific` headers in agents.
- **Context Data**: Filled-in fields in `contexts/*.md` (e.g., your specific tech stack choices).
- **Task History**: Your `tasks.md` and `tasks.archive.md` are untouched (unless the table schema itself requires migration).
