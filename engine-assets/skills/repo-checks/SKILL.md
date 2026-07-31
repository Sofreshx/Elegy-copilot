---
name: repo-checks
description: "Run and report repository-native proof for an active change, including the smallest sufficient local checks and any required remote evidence. Use when asked to run repository checks, validate a change, assess proof, or report check results; do not use for adopting, migrating, or repairing the repository check system. Triggers on: run checks, repository proof, validate this change, check evidence, CI proof."
---

# Repository Checks

## Purpose

Run existing repository proof for a change. This skill is separate from
`repo-quality-setup`: it executes and reports the check system that the repo
already owns; it does not install, redesign, migrate, or repair it.

## Workflow

1. Confirm the explicit repository root and inspect the change: diff, affected
   paths, branch, `HEAD`, and whether the worktree is already dirty. Preserve
   pre-existing edits; never reset, clean, commit, or push.
2. Read the applicable instruction chain and repo policy. At minimum inspect
   the relevant `AGENTS.md`/equivalent, native command definitions, and
   `.elegy/checks.json` when present. Use the plan or acceptance criteria to
   identify the risk that needs proof.
3. Classify each candidate lane as required, advisory, or not required. Select
   the smallest deterministic local proof that closes the active risk. Honor
   every required blocking lane; do not silently omit it because it is slow,
   inconvenient, or unavailable.
4. Run the configured profile/action or the repository-native command it maps
   to, with an explicit timeout and captured output. When the repo uses
   `elegy-checks`, use its existing contract, for example
   `elegy-checks run --repo <root> --profile <profile> --json` or the targeted
   `--check <check-id>` form. Retrieve failed output with
   `elegy-checks logs --repo <root> --run-id <run-id> --check <check-id> --json`
   when needed. Reuse existing evidence and logs; do not invent a second
   command implementation.
5. Inspect the result, not only the exit code, when artifacts, reports, or
   generated output are part of the check. Record failures with the exact
   command and log/artifact path.
6. Report local proof separately from remote evidence and return the output
   contract below.

## Evidence boundaries

- **Local-first:** current-worktree proof is the first response to a change.
  It can establish behavior covered by native deterministic commands, but it
  is tied to the current branch, `HEAD`, dirty state, installed tools, and
  configuration.
- **GitHub/remote evidence:** a clean checkout is authoritative for
  reproducibility and required OS/toolchain matrices. GitHub is also the
  evidence source for release packaging, signing/provenance, protected-branch
  rules, required status checks, secrets, and other hosted policy. Local proof
  does not substitute for those lanes.
- `elegy-checks` is a local runner and evidence store. Its run result does not
  fetch GitHub status, remote logs, or hosted policy evidence.
- Inspect workflow files to understand remote coverage, but discovered
  workflow commands are advisory/remote-only and are never auto-executed or
  copied into a local run. Do not claim a remote lane passed without its actual
  remote result.

## Failure and unknown handling

- `pass` means the required or selected check actually ran and passed.
- `fail` means it ran and failed; preserve the failing command and relevant
  log/artifact evidence.
- `warning` is limited to non-blocking advisory failure or an explicitly
  degraded environment; never downgrade a blocking failure to a warning.
- `skipped` means an intentional omission. Name who/what authorized it and
  the resulting closure gap; a required skipped lane is not success.
- `not-required` means policy and change risk do not require the lane.
- `not-run` means a selected or required lane could not execute. Record the
  blocker (missing tool, timeout, unavailable remote, or unknown policy) and
  treat required proof as unresolved.
- If policy, configuration, toolchain, or change scope is unknown, do not
  infer a pass or silently choose a broader check. Mark the uncertainty,
  inspect the nearest authoritative source, and escalate or stop when it
  affects a blocking lane.

## Output contract

```text
REPO_CHECKS_RESULT
- target_repo: <absolute repo root>
- profile/action: <configured profile/action, or inferred native lane>
- run_id: <run id, or manual-<timestamp> if no runner provides one>
- context:
  - branch: <branch or detached>
  - head: <commit>
  - dirty: <clean|dirty; include relevant pre-existing state>
  - config: <config path(s), or none>
  - plan: <plan/acceptance context, or none>
- policy_basis:
  - <required/advisory/not-required lane and source>
- local_proof:
  - <lane> — <pass|fail|warning|skipped|not-required|not-run> — <command and evidence>
- remote_evidence:
  - clean-checkout/os-toolchain: <status and source>
  - release/signing/branch-policy: <status and source>
- failures:
  - <failing command — log/artifact path or NONE>
- log_retrieval: <exact log command, or NONE>
- unknowns_limitations:
  - <unresolved fact, blocker, or NONE>
- escalation: <none|repo-quality-setup for explicit adoption/migration/repair>
- conclusion: <what the evidence proves and what remains unresolved>
```

## Escalation boundary

Escalate to `repo-quality-setup` only when the request is to adopt, configure,
update, migrate, or repair repository-owned checks, hooks, CI parity, or their
configuration. If existing proof is missing or broken during a run, report the
gap and ask for that setup/migration work rather than mutating it from this
skill.

## Canonical references

- `docs/system/commit-validation-governance.md`
- `docs/system/validation-governance.md`
- `docs/system/check-taxonomy-governance.md`
- `docs/system/search-execute-workflow.md`
