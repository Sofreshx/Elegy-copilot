---
name: goal-session-workflow
description: "Run a root-owned, checkpointed Codex goal session across repositories and dependency waves. Use for multi-repo work, more than one dependency wave, multiple delegated implementation tasks, architecture followed by implementation or deployment, or a requested roadmap, full feature, or long goal."
---

# Goal Session Workflow

Use this skill only in the root user-facing session when any stated trigger applies. Do not use it
for subagents, reviewers, retrospectives, or routine bounded tasks. The root owns the goal,
planning authority, decisions, integration, checkpoints, validation judgment, and closure. Delegates
receive a bounded context packet and return evidence; they never emit a goal frame or checkpoint.

## Establish the session

1. Read the smallest applicable instruction and canonical-authority chain. Separate verified facts
   from assumptions, and stop for a decision that would change scope, architecture, authority,
   data handling, or external cost.
2. Resolve the goal and success criteria. Use the stable Codex goal ID when one exists; otherwise
   assign a session-local goal ID and mark the frame as `fresh` until the owning planning system
   provides a durable reference.
3. Select an assurance posture for this goal: `normal` (default, no independent verifier or extra
   gate), `advisory` (an optional manual reasoning or result check that never blocks delivery), or
   `strict` (only when the user or an explicit risk policy requests required evidence before a
   merge or deployment). This choice is per-goal, is never promoted globally, and never creates a
   scheduler or autonomous evaluator. In `normal`, do not ask for review merely because a signal
   exists; in `advisory`, offer a bounded check only at a meaningful checkpoint and leave it to the
   user. Signals never generate a review loop by themselves.
   Use `normal/not-requested` by default; `strict` must use `requested`, `passed`, `blocked`, or
   `stale`. For `strict`, populate `gateRef`, `evidenceRefs`, and (when blocked) `decisionRef`. A
   strict `blocked` outcome is valid only when the named gate, evidence, and explicit user decision
   are recorded in the checkpoint; this is the supported equivalent of accepting an inconclusive
   check.
4. Select `planning_surface: none|plan-pack|roadmap|both` explicitly. `plan-pack` is the active
   session execution artifact but still requires an explicit `scopeKey` (the repository/session
   mapping); `roadmap` and `both` additionally require the live `elegy-planning` authority plus
   `goalRef`, `roadmapRef`, and the selected `planRef`. Never
   silently use a default scope, a repo Markdown roadmap, a raw transcript, or memory as the
   durable planning authority. If `elegy-planning` is unavailable or the references cannot be
   verified, mark `authorityStatus: unavailable|manual` and stop before fan-out or implementation.
   In particular, `planning_surface: roadmap|both` always requires the durable planning references
   before implementation can begin.
5. Define the scope boundary, dependency waves, and one root integration owner. A wave contains
   only independent work whose prerequisites are complete.
6. Split readiness into:
   - `codeReadiness`: repository access, authority, known base/head, owned paths, dependencies,
     implementation evidence, and local validation;
   - `environmentReadiness`: credentials, permissions, services, devices, CI, deployment targets,
     and other external prerequisites. Never request, record, or expose secret values.
7. Before fan-out, confirm the canonical authority, every repository and branch base, external
   gates, and non-overlapping write ownership. Record dirty-worktree constraints and exclude
   pre-existing changes unless the user explicitly assigns them. Do not delegate until all required
   items are confirmed or explicitly blocked.
8. Emit `GOAL_SESSION_FRAME`, then emit the first `SESSION_CHECKPOINT`. These are durable, bounded
   handoff records. Keep the exact keys below; prose may explain them but cannot replace them.

GOAL_SESSION_FRAME
```json
{
  "schemaVersion": "1",
  "kind": "goal-session.frame",
  "goalId": "<stable-goal-id>",
  "successCriteria": ["<observable criterion>"],
  "canonicalAuthority": "<program, repository, or explicit user authority>",
  "planning": {
    "surface": "none|plan-pack|roadmap|both",
    "scopeKey": "<explicit elegy-planning scope or null>",
    "goalRef": "<durable goal ref or null>",
    "roadmapRef": "<durable roadmap ref or null>",
    "planRef": "<durable plan ref or null>",
    "workPointRefs": ["<durable work-point ref>"],
    "projectRunRef": "<project-run ref or null>",
    "authorityStatus": "resolved|manual|required|unavailable"
  },
  "repositories": [{
    "repositoryId": "<repo id>",
    "branch": "<branch>",
    "baseRef": "<verified base>",
    "headRef": "<verified head>",
    "worktreeStatus": "clean|dirty|unknown",
    "ownedPaths": ["<allowed path>"],
    "changedPaths": ["<known changed path>"],
    "commitRef": "<commit or null>"
  }],
  "dependencyWaves": [{
    "waveId": "<wave id>",
    "dependsOn": [],
    "status": "pending|active|completed|blocked|skipped",
    "workPointRef": "<work-point or null>",
    "planRef": "<plan or null>",
    "projectRunRef": "<run or null>"
  }],
  "integrationOwner": "root",
  "readiness": {"codeReadiness": ["<status and evidence>"], "environmentReadiness": ["<status and gate owner>"]},
  "validation": [{"waveId": "<wave id or null>", "owner": "<validator>", "expectedEvidence": ["<check>"], "status": "pending|passed|failed|blocked"}],
  "stopEscalationContinuation": {"stop": ["<condition>"], "escalate": ["<decision owner>"], "continueWhen": ["<evidence>" ]},
  "checkpointPolicy": {"beforeFanOut": true, "afterEachWave": true, "beforePhaseTransition": true},
  "retrospectiveEligibility": "manual_after_closure|not_eligible",
  "assurancePolicy": {"mode": "normal|advisory|strict", "verificationStatus": "not-requested|suggested|requested|passed|blocked|stale", "gateRef": "<named gate or null>", "evidenceRefs": [], "decisionRef": "<explicit user decision or null>"},
  "attentionSignals": []
}
```

The frame is the root's compact map, not a second planning database. `scopeKey`, `goalRef`,
`roadmapRef`, `planRef`, `workPointRefs`, and `projectRunRef` are the links that let a later root
session find the durable plan and resume without replaying a transcript. `repositories` records
the exact branch/base/head and ownership boundary that must be reconciled on resume.

### Keep an optional attention ledger

When a fact deserves a later revisit but does not justify stopping the current work, add a bounded
`attentionSignals` entry instead of opening another agent, database, or review lane:

```json
{
  "signalId": "<stable-in-session-id>",
  "signalKey": "<short-risk-or-question-key>",
  "severity": "critical|high|medium|low",
  "summary": "<one-sentence concern>",
  "evidenceRefs": ["<frame, checkpoint, receipt, file, or check reference>"],
  "whyItMatters": "<concrete consequence if ignored>",
  "whenToRevisit": "<next phase, wave, or explicit condition>",
  "status": "open|accepted|resolved|stale"
}
```

Keep at most 12 signals, require at least one evidence reference (at most eight per signal), and
keep summaries and references bounded. Prefer promoting an existing
agent `residualRisks`/`blockers`, validation failure, or external gate rather than inventing a new
signal. When durable planning is active, mirror only open signals to the existing
`elegy-planning` work-point or project-run follow-up authority; otherwise keep them session-local.
The ledger is a bounded reminder for the root and future relevant sessions. It never blocks normal
work, asks for an independent verifier by itself, creates a second planning store, runs an LLM, or
enables scheduled evaluation.

## Delegate with a bounded context packet

Every delegated task receives a fresh `AGENT_CONTEXT_PACKET` in the root's prompt. The packet is
derived from the current frame/checkpoint and is the only cross-wave context a delegate needs:

AGENT_CONTEXT_PACKET
```json
{
  "goalId": "<stable-goal-id>",
  "planningRefs": {"scopeKey": "<scope>", "goalRef": "<goal>", "roadmapRef": "<roadmap>", "planRef": "<plan>", "workPointRefs": [], "projectRunRef": "<run>"},
  "activeWaveId": "<wave id>",
  "repositories": [{"repositoryId": "<repo>", "branch": "<branch>", "baseRef": "<base>", "headRef": "<head>", "worktreeStatus": "clean|dirty|unknown", "ownedPaths": [], "changedPaths": [], "commitRef": "<commit or null>"}],
  "ownedScope": ["<repository/path allowlist>"],
  "validation": ["<required check and evidence>"],
  "checkpointRef": "<same-session checkpoint timestamp or state reference>",
  "contextHash": "<hash of the bounded packet>"
}
```

The root updates the packet at every wave and phase transition. Do not paste raw transcripts,
secrets, unrelated repository state, or another agent's unverified conclusions. A delegate must
confirm the packet's goal, wave, owned scope, base ref, and validation expectation before writing.
Compute `contextHash` as the lowercase SHA-256 of canonical JSON (object keys sorted recursively,
array order preserved) over `{goalId, planningRefs, activeWaveId, repositories}`. A delegate echoes
`goalId`, `activeWaveId`, and `contextHash` inside its role-specific payload so the hook can bind a
receipt to the exact goal-run context. The hash is an integrity marker, not a secret or an authority
grant.
When the packet includes a durable planning scope, a delegate may inspect the referenced goal,
roadmap, plan, work points, or project-run context through the read-only `elegy-planning` context
surface using that exact `scopeKey`; never omit the scope, fall back to `default`, claim a missing
record is complete, or mutate planning records/leases from a delegated lane.
The `SubagentStart` hook may reinforce this contract, but hook context is advisory and fails open;
the root remains responsible for including the packet.

## Execute by waves

For each wave, give every delegate a bounded task, repository/path allowlist, expected evidence,
validation command or observable check, and stop condition. Keep requirements, architecture,
cross-repository integration, credential decisions, and final acceptance in the root session.

Reconcile every returned `AGENT_RESULT` against the goal, packet, and success criteria. Run or
inspect the required validation before marking a wave complete. If validation fails, record the
failure and keep the wave active; do not advance based on an assertion alone.

After validation, append evidence to the referenced project run/work point when that authority is
available, then release or retain the run lease with an explicit reason. Record a git boundary:
the checkpoint must say whether the wave is `committed`, `clean-no-commit`, `blocked-uncommitted`,
or `not-applicable`. Never claim a commit or clean tree without checking the repository.

Emit the following JSON block in this exact field order. New checkpoints use schema version `2`;
the hook/runtime may still read the legacy v1 shape for compatibility, but v1 must not be emitted
for a new goal session.

````text
SESSION_CHECKPOINT
```json
{
  "schemaVersion": "2",
  "goalId": "<stable-goal-id>",
  "phase": "planning|implementation|review|deployment",
  "planning": {"surface": "none|plan-pack|roadmap|both", "scopeKey": "<scope or null>", "goalRef": "<goal or null>", "roadmapRef": "<roadmap or null>", "planRef": "<plan or null>", "workPointRefs": [], "projectRunRef": "<run or null>", "authorityStatus": "resolved|manual|required|unavailable"},
  "completedWaveIds": [],
  "activeWaveId": "<active wave id or null>",
  "decisions": ["<decision and authority>"],
  "repositories": [{"repositoryId": "<repo id>", "branch": "<branch>", "baseRef": "<base>", "headRef": "<verified head>", "worktreeStatus": "clean|dirty|unknown", "ownedPaths": [], "changedPaths": [], "commitRef": "<commit or null>"}],
  "validationEvidence": ["<command, artifact, result, or explicit pending state>"],
  "blockers": ["<blocker or none>"],
  "externalGates": ["<gate, owner, and status>"],
  "validationReceipts": [{"receiptId": "<stable id>", "check": "<check name>", "kind": "command|test|build|lint|manual|other", "status": "pending|passed|failed|blocked|skipped", "command": "<redacted command or null>", "exitCode": "<integer or null>", "durationMs": "<non-negative integer or null>", "artifactRef": "<artifact ref or null>", "observedAt": "<ISO timestamp>", "headRef": "<observed HEAD or null>"}],
  "blockerRecords": [{"blockerId": "<stable id>", "code": "<machine code>", "severity": "critical|high|medium|low", "owner": "<decision owner>", "blocking": true, "status": "open|accepted|resolved", "evidenceRefs": [], "nextDecision": "<decision or null>"}],
  "externalGateRecords": [{"gateId": "<stable id>", "owner": "<gate owner>", "blocking": true, "status": "pending|passed|failed|waived|unavailable", "evidenceRefs": [], "continueWhen": "<condition or null>"}],
  "nextAction": "<single next root action>",
  "resume": {"status": "fresh|reconciled|drifted|blocked", "checkedAt": "<ISO timestamp or null>", "drift": ["<detected mismatch or none>"]},
  "gitCheckpoint": {"status": "not-applicable|committed|clean-no-commit|blocked-uncommitted", "commitSha": "<sha or null>", "reason": "<why>", "validationRefs": ["<evidence ref>"]},
  "assurancePolicy": {"mode": "normal|advisory|strict", "verificationStatus": "not-requested|suggested|requested|passed|blocked|stale", "gateRef": "<named gate or null>", "evidenceRefs": [], "decisionRef": "<explicit user decision or null>"},
  "attentionSignals": [],
  "updatedAt": "<ISO-8601 timestamp>"
}
```
````

Emit a checkpoint before fan-out, after every wave, and before each planning-to-implementation,
implementation-to-review, and review-to-deployment transition. Include empty arrays rather than
omitting fields. Keep `activeWaveId` null only when no wave is active. A transition checkpoint
proves the prior phase's validation and readiness for the next phase; it does not authorize an
unmet external gate.

`validationEvidence`, `blockers`, and `externalGates` remain compatibility summaries. New schema-v2
checkpoints also emit the corresponding structured receipt arrays. A validation receipt records
what was observed at which HEAD; it does not turn command output into planning authority. Never put
secret values, raw transcripts, or unrestricted logs into a receipt.

The native runtime retains `checkpoint.json` as the latest compatibility record and keeps a bounded
ordered history under `checkpoints/`. Each persisted wrapper has `checkpointId`, `sequence`, and
`previousCheckpointId`; these are runtime identity, not fields the root invents in the emitted
checkpoint. Use `node <installed-hook>/elegy-codex-hook.mjs status [session-id]` for local activation
and persistence diagnostics. Filesystem status cannot prove Codex hook discovery or trust.

## Resume from checkpoint

On every continuation or post-compaction resume, locate the same-session checkpoint by verified
thread binding and reconcile it before doing work:

1. Confirm the goal ID and success criteria still match the active user request; confirm the
   planning refs resolve in the recorded `scopeKey`, including the goal, roadmap, plan, work
   points, and project-run lease when present.
2. Re-read the applicable instruction/authority chain and compare each repository's branch, base,
   head, worktree status, owned paths, changed paths, and commit ref to the checkpoint.
3. Recheck validation evidence, external gates, and active-wave dependencies. Do not infer that a
   delegated task completed because a receipt or checkpoint is present; inspect the claimed
   evidence and repository state.
4. Set `resume.status` to `reconciled` only when those facts agree. Set it to `drifted` for any
   branch, file, authority, or evidence mismatch, and `blocked` when a required authority or gate
   cannot be accessed. Stop and ask the root/user for the smallest safe decision in either case.
5. Continue only from the recorded `nextAction` after emitting the reconciled checkpoint. A fresh
   session may create a frame, but it must not adopt an old checkpoint without verified binding.

On compact resume, treat `RUNTIME_RECONCILIATION` as an independent observation of the Git worktree.
It may be `reconciled`, `drifted`, or `unavailable`. Stop before editing on `drifted`; investigate
`unavailable` rather than upgrading it to reconciled. Pattern or directory scopes intentionally
disable exact changed-path comparison, while branch, HEAD, and worktree-state checks still apply.

Assurance remains opt-in at resume: `normal` does not request an independent verifier; `advisory`
may surface a manual reasoning or result check when the root/user chooses it; `strict` pauses at
the explicitly configured merge or deployment gate until the requested evidence passes or the
root records a `blocked` result with the named gate and explicit user decision. Surface only
relevant `open` attention signals, and keep them non-blocking unless the goal's explicit stop policy
says otherwise.

## Stop and close

Stop and escalate when authority conflicts, a branch base or clean ownership cannot be confirmed,
write scopes overlap, a planning reference drifts, an external gate requires human action,
validation contradicts completion, or a new fact materially changes the approved goal. State the
blocker, evidence, decision owner, and smallest safe continuation; do not guess or broaden scope.

Close only after all success criteria have evidence, all active waves are reconciled, required
validation is passed or explicitly accepted by its authority, the project-run/work-point evidence
is recorded when available, and unresolved goals are handled by their owning carryover workflow.
Determine goal completion only in the root session. A retrospective is eligible only when
explicitly requested with bounded sources; it is diagnostic and does not change goal closure,
validation, backlog, roadmap, or deployment authority.
