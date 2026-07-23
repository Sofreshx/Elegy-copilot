---
name: repo-quality-setup
description: "Audit, bootstrap, migrate, or repair repository-owned local checks, Git hooks, and GitHub Actions parity after an explicit request. Use for onboarding a repository to quality practices or updating its quality workflow; do not use merely to run or triage existing checks."
---

# Repository Quality Setup

Require an explicit absolute repository root. Start with the bundled coordinator:

```text
node <skill-dir>/scripts/repo-quality-audit.mjs --repo <absolute-repo-root>
```

Treat its JSON as discovery, not permission to mutate. Stop when the repository is unsupported or the audit reports an invalid root.

## Ownership

Keep execution truth in repository-native commands. Use `.elegy/checks.json` only to describe local proof, profiles, and CI mapping. Never make Git hooks depend on the Elegy desktop app or `elegy-checks` being installed.

Preserve an existing supported hook manager. When no manager exists in a Node-rooted repository, recommend Lefthook. Treat `.githooks` plus `.copilot/commit-checks.json` as the legacy Elegy setup and propose migration to `.elegy/checks.json`; do not retain two check authorities.

## Workflow

1. Read the repository's instruction chain and native package/build files.
2. Run the audit coordinator and inspect every file named in its findings.
3. Identify the smallest native commands for formatting, linting, static analysis, type checking, tests, build, and security checks. Reuse existing tools and scripts.
4. Present one exact change preview: files, hook lanes, CI jobs, commands, expected runtime, migrations, and validation. Ask for approval before mutation unless the user already approved implementation in the current task.
5. Implement these layers:
   - pre-commit: deterministic change-scoped formatting/linting and fast static checks;
   - pre-push: full type checking and relevant tests that are practical locally;
   - GitHub Actions: repeat required proof from a clean checkout by calling the same native scripts;
   - `.elegy/checks.json`: describe profiles and map required local lanes to CI jobs.
6. Pin GitHub Actions to full commit SHAs with version comments. Add Dependabot for the `github-actions` ecosystem when GitHub Actions are present.
7. Validate the hook manager configuration, each native quality command, `elegy-checks validate`, `elegy-checks audit`, and CI mapping when those commands are available.

Do not create or change remote rulesets, branch protection, secrets, repository permissions, or required checks without separate explicit approval. Do not bypass a failing hook to claim setup success. Report pre-existing failures separately from infrastructure failures.

Return the detected stack, retained hook manager, canonical commands, files changed, local validation results, CI parity, remaining gaps, and any remote action that still needs approval.
