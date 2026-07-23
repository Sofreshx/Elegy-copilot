---
created: 2026-06-04
updated: 2026-07-22
category: system
status: current
doc_kind: node
id: commit-validation-governance
summary: Canonical ownership and execution contract for repository quality checks, Git hooks, local proof, and CI parity.
tags: [ci, git-hooks, quality, validation]
related: [ci-conventions, copilot-ui-guide, project-conventions-governance]
---

# Commit Validation Governance

## Outcome

Every supported repository exposes a small set of named, repository-native quality commands. Git hooks call those commands automatically at the cheapest useful boundary; GitHub Actions repeats required proof from a clean checkout; Elegy records and explains the result.

The setup must remain usable without the Elegy desktop app running.

## Ownership

| Concern | Canonical owner |
|---|---|
| Commands and tool configuration | The target repository |
| Hook installation and dispatch | The repository's existing hook manager; Lefthook is the default when none exists |
| Check profiles, evidence, and CI mapping | `.elegy/checks.json` and `elegy-checks` |
| Clean-checkout enforcement | GitHub Actions |
| Readiness and next action | Copilot Workspace Checks UI |
| Onboarding and migration | `repo-quality-setup` skill |

Do not duplicate raw command lists across hooks, CI, and app code. Hooks and CI invoke the same named repository scripts.

## Required layers

### Pre-commit

Run deterministic checks selected by staged file type. Prefer formatting, linting, instruction/doc validators, and project-scoped static analysis. A normal documentation-only commit must not pay for Rust or TypeScript validation.

Pre-commit is blocking. A missing required runtime is a setup failure, not permission to skip silently.

### Pre-push

Run the repository's complete practical local gate: full type checking, static analysis, and relevant tests. Heavy packaged desktop, E2E, release-signing, and platform-matrix checks may remain CI-only when the local cost is disproportionate.

### GitHub Actions

Required jobs start from a clean checkout and invoke the same named repository commands. CI is defense in depth, not the first place routine deterministic failures should be discovered.

Pin third-party actions to full commit SHAs with a version comment and let Dependabot propose reviewed updates. See [CI conventions](ci-conventions.md).

### Elegy evidence

`.elegy/checks.json` describes profiles, costs, blocking behavior, and the GitHub workflow/job that repeats each required lane. It does not install hooks and is not a second command implementation.

The supported profiles are:

- `commit`: fast checks suitable for staged changes;
- `push`: full practical local proof;
- `ci-local`: broader clean-checkout parity when needed;
- explicit preview or release profiles for costly checks.

## Hook-manager policy

Preserve Husky, pre-commit, Lefthook, or another maintained manager already owned by the repository. For supported Node-rooted repositories without a manager, use Lefthook.

The historical Elegy setup—tracked `.githooks`, `core.hooksPath=.githooks`, `.copilot/commit-checks.json`, and copied `commit-check-*` runtime scripts—is deprecated. Migrate it to the layered model and remove the duplicate config after parity is established. The `commit-check-setup` skill remains only as a compatibility route to `repo-quality-setup`.

## Onboarding contract

The `repo-quality-setup` skill:

1. requires an explicit repository root;
2. performs a deterministic read-only audit;
3. reads native commands and the repository instruction chain;
4. preserves the existing hook manager or recommends Lefthook;
5. presents an exact mutation preview;
6. applies only approved local changes;
7. validates hooks, native commands, Elegy config, and CI mapping.

Remote rulesets, branch protection, required-check selection, secrets, and permissions require separate explicit approval.

## Failure behavior

- Do not use `--no-verify` to claim the setup is healthy.
- Distinguish infrastructure failure from a correctly detected pre-existing repository failure.
- Keep failed run evidence and identify the exact command and lane.
- Never weaken or silently remove an existing repository-owned hook.

## Validation

For this repository, the focused contract is:

```text
npx lefthook dump
npx lefthook run pre-commit --all-files
npm run quality:push
elegy-checks validate
elegy-checks audit
elegy-checks ci-map
```

Use `npm run ci:local` for the broader repository gate. Platform-only and release checks remain in their explicit profiles or GitHub jobs.
