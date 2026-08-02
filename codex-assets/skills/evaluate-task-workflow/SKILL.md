---
name: evaluate-task-workflow
description: "Read-only, exact-thread Codex workflow evaluation using stable app-server read surfaces. Use only when the user explicitly invokes $evaluate-task-workflow (or names this skill) and supplies one exact thread ID; report evidence and unpromoted proposals without changing state."
---

# Evaluate Task Workflow

Produce an evidence-linked evaluation of one completed or active Codex thread. This is an
on-demand manual lane: invoke it only when the user explicitly names `$evaluate-task-workflow`
(or this exact skill). It is not a generic review, planning, or improvement trigger.

## Scope and safety

- Stay read-only. Do not create, edit, delete, persist, upload, send, install, enable, disable,
  or promote anything. The response is not authority to change repository state, Codex state,
  configuration, skills, hooks, MCP servers, backlog, roadmap, telemetry, or memory.
- Require one exact, non-empty Codex thread ID. Never discover a thread by listing, search nearby
  threads, accept a label as a selector, or merge several threads. If it is absent, request it.
- Do not read conversation/message bodies, databases, SQLite, rollout state, plugin inventories,
  telemetry, home-directory scans, environment dumps, or unselected repositories.
- Preserve uncertainty. Missing, inaccessible, or policy-blocked evidence is not a negative
  finding and is never a reason to guess a fix.

## Exact-thread collection

Use `scripts/inspect-codex-workflow.mjs` with an injected transport adapter. The adapter must
provide `request(method, params)` and may expose a `version`; the collector intentionally does
not define, infer, or emulate an app-server protocol.

The only app-server calls allowed are, in this exact order:

1. `thread/read` with `{ threadId, includeTurns: true }`
2. `thread/goal/get` with `{ threadId }`
3. `config/read`
4. `configRequirements/read`
5. `skills/list`
6. `hooks/list`
7. `mcpServerStatus/list`

Do not call `plugin/list`, SQLite, rollout, thread-listing, or any mutation method. The collector
projects only allowlisted fields, redacts credentials and absolute paths, paginates surface items,
records the adapter version when available, and bounds output to 512 KiB. It marks each discovered
surface as one of `configured`, `discovered`, `enabled`, `callable`, or `policy-blocked`; these are
observations, not change requests.

Turn reads are structural only: retain bounded compaction and subagent-start item IDs, types,
statuses, timestamps, and agent references. Never retain or quote user/assistant messages,
reasoning, tool arguments/results, or item bodies. The collector describes events; identifying a
recommendation from them remains skill judgment backed by the selected thread evidence.

Filesystem evidence is optional and tightly bounded: only caller-supplied paths in the active
`AGENTS.md` chain and only direct `*.toml` custom-agent files in caller-supplied applicable roots.
Pass those exact bounds as `filesystemOptions.activeInstructionPaths` and
`filesystemOptions.customAgentRoots`; do not recursively search either location or infer roots
from the machine. The CLI intentionally exposes no filesystem path flags. A trusted host that
needs this optional inventory must import `collectCodexWorkflow` and pass `filesystemOptions`;
CLI execution collects app-server evidence only.

Example interface (the adapter is supplied by the caller's stable integration):

```text
node codex-assets/skills/evaluate-task-workflow/scripts/inspect-codex-workflow.mjs \
  --thread-id <exact-thread-id> --transport-module <adapter-module>
```

## Evaluation and authority routing

Start with `thread/read` and `thread/goal/get`; treat their facts as thread-scoped evidence. Use
the other five responses only to explain the effective environment. Do not claim a configured,
enabled, or callable surface caused a thread outcome unless direct thread evidence establishes it.

Route each possible follow-up through
`references/codex-customization-surfaces.md`. A candidate is admissible only when its observed
surface is available, its owner is identified, and the map names a supported authority. User- or
repository-owned targets may be `direct`; workspace-admin targets require approval and
host-integration targets require integration. Prefer a focused change to an existing authority over
creating a new surface. Add a custom agent only when the inventory proves no existing role can own
the independent specialized work. Reject candidates that are unavailable, policy-blocked,
product-owned, externally owned, or lack a clear owner; report the reason as uncertainty instead.

Keep two lanes separate:

- Session advice is a clearly labelled, non-durable part of the human-readable recap for a future
  run of this exact workflow. It must not imply an edit or promotion.
- `durableCandidates`: ownership-routed, evidence-backed proposals for a separately authorized
  future task, represented as `improvementCandidates` in Structured State. Every entry has
  `status: "proposed"`; do not accept, file, prioritize, or implement it.

## Response contract

Return `SESSION_RETROSPECTIVE` followed by a concise recap and exactly one
`## Structured State` JSON block. Keep session advice in the recap under a distinct
`Session advice (non-durable)` label. Do not append an action plan or a second schema. New output
uses the canonical `session-retrospective-v2` contract; do not emit a parallel Codex-specific
schema.

````text
SESSION_RETROSPECTIVE
<concise evidence-bounded recap>

Session advice (non-durable): <optional advice for a later run; no durable change implied>

## Structured State
```json
{
  "schemaVersion": "2",
  "kind": "session.retrospective.single",
  "retrospectiveId": "<stable response id>",
  "generatedAt": "<ISO-8601 timestamp>",
  "source": {
    "harness": "codex",
    "taskIds": ["<exact supplied thread id>"],
    "repoIds": [],
    "completeness": "complete"
  },
  "recap": {
    "summary": "<concise evidence-bounded recap>",
    "requested": [],
    "delivered": []
  },
  "strengths": [],
  "frictions": [],
  "customizationInventory": [],
  "improvementCandidates": [],
  "uncertainty": {
    "biggestMissing": null,
    "leastConfident": null
  },
  "requiresUserDecision": false
}
```
````

Every strength, friction, inventory entry, and durable candidate must include minimal
`evidenceRefs`. Each inventory entry uses the canonical `status`, `scope`, `owner`, and
`limitations` enums; each durable candidate uses a typed `target` with `surface`, `scope`, `owner`,
`action`, `automation`, and `feasibility`, plus `whyThisSurface`, `alternativesRejected`, expected
impact, risks, validation, confidence, and `status: "proposed"`. Use empty arrays rather than
invented content. Set `requiresUserDecision` only for a missing exact selector, an ownership
conflict, a privacy boundary, or a separately requested promotion; explain the decision under
`uncertainty`.
