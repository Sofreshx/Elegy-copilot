---
created: 2026-08-01
updated: 2026-08-01
category: system
status: current
doc_kind: node
id: codex-workflow-improvement-governance
summary: Native Codex hook, checkpoint, identity-binding, and guarded retrospective automation policy.
tags: [codex, hooks, checkpoint, retrospective, automation]
related: [session-retrospective-governance, codex-subagent-control-plane, harness-asset-flow, workflow-planning-contract]
---

# Codex Workflow Improvement Governance

## Purpose

Govern the deterministic runtime around goal checkpoints and later retrospective
evaluation. Skills perform judgment; hooks observe lifecycle events; a scheduled
host may eventually execute a validated manual-equivalent evaluation. None of
these surfaces may promote a proposal or replace planning authority.

## Runtime and identity authority

Managed runtime state lives under
`~/.elegy/codex-workflow-improvement/`. Checkpoints live at
`sessions/<canonical-thread-id>/`; queue jobs use atomic one-file records. Hook
scripts and merged hook configuration may live under the Codex home, but
runtime state does not.

Never assume hook `session_id`, app-server `thread.id`, and
`thread.sessionId` are interchangeable. Checkpoint injection and automatic
evaluation require an explicit verified binding produced by forward tests for
root, resumed, forked, archived, and deleted threads. A missing or conflicting
binding leaves evaluation manual/unavailable. Deleted-thread automatic
evaluation is unsupported in the first release; do not retain an unstable raw
transcript snapshot to simulate support.

State writes are atomic, schema-validated, redacted, and bound to one verified
session. A frame/checkpoint pair must share goal, planning, repository, and
wave identity; mismatches are ignored rather than injected. Checkpoints expire
after seven days. Queue jobs expire after 30 days.

`checkpoint.json` remains the latest-record compatibility surface. The runtime
also retains immutable ordered wrappers under `checkpoints/`, capped at 64
valid records per bound session and governed by the same seven-day TTL. Each
wrapper carries a runtime-generated checkpoint ID, sequence, and predecessor;
goal-specific IDs prevent a new goal in the same thread from overwriting older
history. History never becomes planning authority.

## Hook behavior

The installer merges managed commands into `hooks.json` and never replaces the
whole file. Exact managed command paths identify Elegy ownership. Reinstall is
deduplicated; uninstall removes only managed commands; unrelated user,
repository, and plugin hooks are preserved. Dry-run reports the merge, Windows
paths with spaces remain valid JSON command values, and enabled hooks still
require normal Codex review/trust. Discovery is verified through app-server
`hooks/list`; the installer never bypasses trust.

First-release events are bounded as follows:

- `Stop` observes `last_assistant_message` and atomically persists only a valid
  `GOAL_SESSION_FRAME` and/or `SESSION_CHECKPOINT`; new goal sessions emit
  checkpoint schema `2`, while schema `1` remains readable for compatibility.
  It never blocks or continues the turn.
- `PreCompact` records the event and checks for a valid same-session checkpoint;
  it never parses rollout/transcript JSON or blocks compaction.
- `SessionStart` with `source=compact` injects the latest valid same-session
  goal frame and checkpoint with a 1,500-token ceiling. When `cwd` resolves to
  the recorded repository, it also observes Git branch, HEAD, worktree state,
  exact changed paths, and a deterministic worktree digest. Drift is surfaced
  separately as `RUNTIME_RECONCILIATION`; pattern/directory scopes skip only
  exact path comparison. Missing, expired, malformed, unbound, or uninspectable
  state fails open with an explicit status rather than a fabricated match.
- `SubagentStart` injects the common `AGENT_RESULT` requirement plus a bounded
  same-session goal/planning summary and recent verified receipts. The root
  still owns the full `AGENT_CONTEXT_PACKET`; hook context is advisory. A
  goal-run receipt must echo the goal ID, active wave, and deterministic packet
  hash; the persisted wrapper binds those values to the verified session.
  `SubagentStop` persists a redacted, identity-bound receipt and records
  compliance telemetry only; it does not continue or mutate subagent execution.
- `SessionEnd` enqueues a minimal bound session reference. It does not invoke
  an LLM or parse transcript contents.

Goal assurance is opt-in and local to a goal session. `normal` is the default and requests no
independent verification. `advisory` allows the root/user to ask for a manual reasoning or result
check without blocking delivery. `strict` is allowed only when the user or an explicit risk policy
names a required evidence gate and uses `requested`, `passed`, `blocked`, or `stale` status. Its
`gateRef`, `evidenceRefs`, and `decisionRef` fields bind that state to the named gate, proof, and
decision. A strict `blocked` result must include the named gate, evidence, and explicit user decision. The goal
skill may carry up to twelve evidence-linked attention
signals, promoting existing receipt residual risks, blockers, failed checks, or external gates so a
later relevant session can surface them. Signals are reminders, not automatic stop conditions, and
do not create a second planning store.

Schema-v2 checkpoints keep the legacy string summaries and add optional structured
`validationReceipts`, `blockerRecords`, and `externalGateRecords`. New emitters populate both:
strings remain compact human/legacy summaries, while records carry stable IDs, status, ownership,
blocking semantics, evidence references, timing, and observed HEAD where applicable. Neither form
may contain secrets or raw logs.

The installed hook exposes a read-only `status [session-id]` command that distinguishes unbound,
bound, frame-persisted, and checkpoint-persisted states and reports reconciliation availability.
Installer `--hooks-status` also reports whether runtime files have ever been observed. These are
diagnostics only: `hooks/list` discovery and `/hooks` trust remain separate required evidence.
The session-specific result includes a compact derived operator view (goal, phase/wave, validation,
blocking count, reconciliation, changed-path count, and next action); it is read-only projection,
not another progress authority.

## Guarded scheduled evaluation

The current release is manual-only: no scheduled task is installed, the queue
feature flag is off by default, and no hook is enabled merely by adding these
repository assets. A user must explicitly install and trust the native hook
and separately approve any future scheduler.

Do not create or enable the hourly desktop scheduled task until all release
gates pass: representative manual v2 evaluations, identity-binding forward
tests, hook trust, scoped scheduled read/write permissions, and evaluator
self-exclusion. Until then the installer reports automation as available but
disabled.

Automatic eligibility requires a verified binding, a non-active thread, a
Codex goal terminally `complete` or `blocked`, no evaluator marker, and no
report for the same evidence checksum plus contract version. Active goals stay
pending. Cleared, cancelled, replaced, no-goal, deleted, and evaluator sessions
are tombstoned as skipped/unavailable.

Queue records have `pending`, `claimed`, `completed`, `failed`, or `skipped`
state, a 30-minute claim lease, one automatic retry, deterministic idempotency,
and one terminal observation per job. The scheduled task must explicitly invoke
`$evaluate-task-workflow` from a dedicated local project rooted at the state
directory. The skill returns content only; the host writes a validated local
report. Reports remain proposals and cannot mutate AGENTS files, skills,
agents, hooks, config, memory, roadmap, backlog, or product state.

Plugin packaging and dashboard projection are later distribution/view layers,
not prerequisites or evidence authorities.

## Validation

Validate hook merge preservation, reinstall, dry-run, upgrade, uninstall,
Windows quoting, trust reporting, and app-server discovery. Forward-test every
identity lifecycle. Exercise missing/stale/corrupt/cross-session checkpoints,
repeated compaction, receipt status variants, queue leases/retry/TTL/tombstones,
duplicate SessionEnd events, recursion prevention, and manual/scheduled output
equivalence before enabling automation.
