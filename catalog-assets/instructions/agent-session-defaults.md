# Agent Session Router

Portable baseline for all harnesses. Harness appendices add tool-specific
routing; repo instruction files add project-specific commands and authority.

## Repo Discovery

Apply explicit user instructions first, then the active global-to-local
instruction chain. A nearer scoped instruction overrides a broader instruction
at the same authority layer.

Use the repo instruction entrypoint to discover any repo-declared canonical
authority. Once identified, that authority governs maintained docs and repeated
implementation patterns beneath it. Report conflicts.

Route downward and stop at the smallest set of owning nodes required for the
task:

```text
instruction chain -> repo entrypoint -> relevant topics -> owning nodes
```

Prefer repo-local validators. Do not broaden discovery when the route is
already clear.

## Instruction Content

Keep instruction surfaces as routers. Retain only non-obvious triggers,
actions, boundaries, failure behavior, output contracts, and checks. Put durable
policy in its canonical owner; remove ceremony, generic advice, and copied
policy.

## Clarification Contract

Never implement through ambiguity.

Investigate discoverable facts first. Clarify only when uncertainty changes
scope, architecture, data handling, destructive action, external cost,
user-visible behavior, acceptance criteria, validation, ownership, security,
or privacy.

## Planning Contract

Plan non-trivial work after reading the relevant local sources.

A ready plan states the goal, success criteria, authority path, facts,
assumptions, smallest workable path, validation, and stop conditions. It leaves
no product or architecture decision to the implementer.

## Long-Running Work

Let builds, validations, exports, and delegated work reach a natural result.
Prefer one call with a suitable timeout. If a tool yields, use its wait or
resume path instead of adding status probes or repeatedly reading growing logs.

Interrupt only for an explicit error; a permission, credential,
destructive-action, or privacy boundary; a confirmed stall; or user direction.
After completion, inspect the exit status, concise summary, and relevant output
once. Keep verbose logs outside model context when practical.

## Review Rule

For review requests, lead with actionable findings and exact evidence. Check
the active authority and acceptance criteria; flag assumptions presented as
facts, duplicated policy, dead code, and unnecessary complexity.

## Validation Rule

After changes, run the narrowest repo-local check that covers the changed
behavior. Validate links for instruction or documentation changes. Report
failed or skipped checks.

## Git Checkpoint Rule

Keep changes scoped and preserve unrelated work. In goal or durable planning
sessions, commit validated atomic units only when the approved goal or plan
authorizes it. Otherwise, pause at a natural boundary and offer an atomic
commit. Never auto-push, auto-merge, delete branches, or force-remove dirty
worktrees.
