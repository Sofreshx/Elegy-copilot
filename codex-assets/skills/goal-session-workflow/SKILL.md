---
name: goal-session-workflow
description: "Keep long or risky Codex work resumable with one compact baseline and meaningful differential checkpoints. Use for multi-repository work, dirty-worktree risk, dependency waves, likely compaction or resumption, external boundaries, or genuinely long work."
---

# Compact Goal Session Workflow

Use this skill only in the root user-facing session when at least one risk trigger applies:

- multiple repositories;
- meaningful dirty-worktree or ownership risk;
- more than one dependency wave;
- likely context compaction, interruption, or later resumption;
- external cost, deployment, publication, approval, credential, or destructive boundaries;
- work long enough that the next action may otherwise be lost.

Skip it for routine bounded work. A native Codex goal is not required: use its stable ID when one
already exists, otherwise assign a session-local `goalId`. Never create a native goal merely because
this skill activated; goal creation still requires an explicit user request.

The root owns requirements, architecture, integration, validation judgment, checkpoints, and
closure. The record is continuation state, never a second planning authority.

## Establish one compact baseline

Read the smallest applicable instruction and canonical-authority chain, inspect every repository,
and separate verified facts from assumptions. Stop for uncertainty that changes scope,
architecture, authority, data handling, destructive action, external cost, or acceptance.

Define the goal, observable success criteria, scope, protected boundaries, dependency waves, the
active wave, and one next action. Treat downloads, paid services, publication, approval, deployment,
and similar restrictions as protected boundaries until one actually prevents the next action; only
then record a blocking gate.

Show the user a concise summary:

```text
Goal: <one sentence>

Success:
- <observable result>

Scope:
- <repository or owned area>

Protected:
- <existing work or external boundary>

Waves:
1. <deliverable>
2. <deliverable>

Current: <active wave> — <single next action>
```

In the same final message, add exactly one hidden machine record. Keep JSON valid and do not put
secrets, transcripts, raw logs, or user-facing explanation inside it.

```text
<!-- ELEGY_SESSION_STATE
{
  "schemaVersion": "1",
  "kind": "baseline",
  "goalId": "<stable or session-local id>",
  "goal": "<one sentence>",
  "successCriteria": ["<observable result>"],
  "authority": "<canonical program, repository, or user authority>",
  "scope": ["<owned area>"],
  "protected": ["<pre-existing work or external boundary>"],
  "dependencyWaves": [{"waveId": "wave-1", "dependsOn": [], "deliverable": "<result>"}],
  "current": {"activeWave": "wave-1", "nextAction": "<single root action>"},
  "repositories": [{
    "repositoryId": "<id>",
    "root": "<absolute repository root>",
    "ownedPaths": ["<path or pattern>"],
    "protectedPaths": ["<excluded path>"],
    "preserveExistingChanges": true
  }]
}
-->
```

Emit the baseline once. Do not follow it with an initial checkpoint. The runtime owns timestamps,
sequence IDs, Git branch/HEAD/worktree observations, changed-path digests, and bounded path evidence.
Do not repeat those facts in the agent-authored record.

### Optional baseline modules

Omit inactive modules entirely; never fill them with `null`, empty defaults, or labels that do not
resolve.

- Add `planning` only for verified durable references. Its allowed keys are `scopeKey`, `goalRef`,
  `roadmapRef`, `planRef`, `workPointRefs`, and `projectRunRef`. If roadmap authority is required but
  cannot be resolved, stop rather than inventing references.
- Add `assurance` only for non-default `advisory` or `strict` posture. Normal assurance is omission.
  Strict assurance requires a named `gateRef`; passed or blocked status requires `evidenceRefs`, and
  blocked also requires an explicit `decisionRef`.

## Work by dependency waves

Advance a wave only after its dependencies and required evidence are complete. Reconcile delegated
results against the owned scope and validation; never accept an assertion as completion evidence.

When delegation is authorized, give each delegate a bounded task, repository/path allowlist,
expected evidence, validation, and stop condition. Supply a compact context packet containing the
`goalId`, optional planning references, active wave, repository observations, owned scope,
validation expectation, latest update reference, and a lowercase SHA-256 context hash. Delegates
echo `goalId`, active wave, and hash in their `AGENT_RESULT`. Do not paste the baseline, raw
transcript, unrelated repository state, or secrets into delegate prompts.

## Emit differential checkpoints only when meaningful

Emit an update only after:

- a wave completed and its evidence was checked;
- a real blocker or user decision changed continuation;
- a deliberate interruption or handoff;
- final closure.

Do not checkpoint merely because fan-out began, a phase label changed, or a lifecycle ceremony was
reached. Automatic compaction is handled by the runtime repository snapshot and does not require
fabricated semantic progress.

Show only the decision-relevant delta:

```text
Checkpoint: <event>
Changed: <bounded result or none>
Validated: <evidence or pending failure>
Next: <single action>
Risk: <current risk or none>
```

Then add exactly one hidden update. Required keys are `schemaVersion`, `kind`, `goalId`, and `event`.
Allowed events are `wave-complete`, `blocked`, `decision`, `handoff`, `interrupted`, and `closure`.
Include only fields that changed:

```text
<!-- ELEGY_SESSION_STATE
{
  "schemaVersion": "1",
  "kind": "update",
  "goalId": "<matching id>",
  "event": "wave-complete",
  "completedWaveIds": ["wave-1"],
  "activeWave": "wave-2",
  "changed": ["<result>"],
  "validated": ["<check and outcome>"],
  "nextAction": "<single root action>",
  "git": {"status": "uncommitted", "reason": "Commit not requested."}
}
-->
```

Optional delta fields are `completedWaveIds`, `activeWave`, `changed`, `validated`, `decisions`,
`risks`, `blockers`, `gates`, `assurance`, `nextAction`, and `git`. Omission means unchanged. For current-state
`risks`, `blockers`, and `gates`, an empty array explicitly clears the prior value. `activeWave:
null` is reserved for closure.

Git status is `committed`, `clean`, `uncommitted`, or `not-applicable`. `uncommitted` describes a
boundary and does not imply blocked. Never claim `committed` or `clean` without checking; a commit
reference is required for `committed`.

## Resume and close

On compact resume, use the injected materialized state and treat `RUNTIME_RECONCILIATION` as an
independent Git observation. Re-read the authority chain and verify the active request, planning
references, active-wave dependencies, validation, and external gates. Stop before editing on
`drifted`; investigate `unavailable` rather than treating it as reconciled. Continue only from the
recorded next action after the evidence agrees.

Legacy `GOAL_SESSION_FRAME` and `SESSION_CHECKPOINT` blocks are unsupported and must not be adopted.
For a still-qualifying legacy session, reconcile conversation and repository state, then establish a
fresh compact baseline. Never delete legacy runtime files as part of resumption.

Close only when every success criterion has evidence, active waves are reconciled, and required
gates are passed or explicitly resolved by their authority. Emit one `closure` update with
`activeWave: null`, final validation, current risks, and the final git boundary. A retrospective
remains a separate, explicitly requested diagnostic workflow.
