# Codex Customization Surface Map

Use this map only after collecting one exact thread. It routes a proposal for a separately
authorized task; it never authorizes an edit, installation, enablement, or promotion. Prefer the
named existing authority. If the owner, scope, or availability is unknown, leave the idea out of
`improvementCandidates` and explain the boundary in the human-readable uncertainty instead.

| Surface | Use/policy trigger | Owner | Scope | Limitations | Existing authority to prefer |
| --- | --- | --- | --- | --- | --- |
| Prompt/thread context | One-run preference or advice for this selected thread | user | turn | Non-durable; never infer a repo edit | Session advice only |
| Global `AGENTS.md` | Repeated personal behavior across repositories | user | global | Must already exist and be user-owned; not repo policy | Existing global `AGENTS.md` |
| Repository or nested `AGENTS.md` | Repository policy or subtree-specific repeated behavior | repo | repo or subtree | Use the nearest active existing file; do not create an instruction file | Existing nearest `AGENTS.md` |
| User or project `config.toml` | Model, sandbox, or concurrency/effective configuration evidence | user or repo | user_local or repo | Inspect resolved layers and requirements first; never alter product defaults | Existing resolved config layer |
| Skill | Reusable procedure | user or repo | global, repo, or subtree | Require an existing compatible skill source; discovered-only is not causal evidence | Existing skill source |
| Custom agent | Specialized independent work | user or repo | user_local, repo, or subtree | Direct applicable custom-agent TOMLs only; reject product-managed roles | Existing custom-agent TOML |
| Codex hook | Deterministic lifecycle behavior | user, repo, or workspace_admin | user_local, repo, or workspace_managed | Match documented hook semantics and preserve other owners' hooks | Existing hook definition |
| MCP/app | External live system | user, workspace_admin, or host_integration | user_local or workspace_managed | Callable state does not prove thread use; policy-blocked/external-only surfaces are rejected | Existing MCP/app configuration |
| App-server integration | Stable host/runtime integration behavior | host_integration | workspace_managed | Use only documented stable methods; do not invent or emulate a protocol | Existing host integration |
| Memory | Personal recall or generated summary | user | global | Never policy authority and never evidence of a repository rule | Session advice only |
| Scheduled task | Recurring execution after manual evaluator and trust gates pass | user or workspace_admin | user_local or workspace_managed | Requires a separately approved scheduler authority; no promotion from this skill | Existing scheduled task |
| Plugin | Distribution or packaging of a proven local customization | user, repo, or workspace_admin | global, repo, or workspace_managed | Later distribution layer; do not select before an existing local authority works | Existing plugin package |
| Repository enforcement | Mechanically enforceable repository rule | repo | repo | Use only when a test, CI, linter, or pre-commit check can verify it | Existing repository check |
| Product feedback | Unavailable product behavior | openai | product | Product-owned; never turn into a local configuration candidate | Feedback/escalation only |
| Deprecated custom prompt | Retired or duplicate product surface | openai | product | Never select; do not revive or recommend it | None |

## Collector observations

The collector may provide evidence for active instructions, custom agents, resolved configuration,
requirements, skills, hooks, and MCP servers. Its state names mean:

- `configured`: present in configuration; availability or execution is unproven.
- `discovered`: visible without sufficient configuration evidence.
- `enabled`: enabled by its owner, but not necessarily callable in this thread.
- `callable`: reported available for calls; this does not establish use or causal impact.
- `policy-blocked`: visible but forbidden by policy; it is not a candidate.

For v2 `customizationInventory`, translate `enabled`/`callable` to `active`;
`configured`/`discovered` to `available` only when owner and scope are known, otherwise `unknown`;
and `policy-blocked` to `policy_blocked`. A missing read is `unavailable`; use `unsupported` only
for a confirmed unsupported surface. Inventory owners are `user`, `repo`, `workspace_admin`,
`host_integration`, or `openai`; an `openai` owner is product-owned and cannot produce a durable
candidate.

## Candidate shape

Every `improvementCandidates` entry has `status: "proposed"`, a typed `target` (`surface`, `scope`,
`owner`, `action`, `automation`, and `feasibility`), `whyThisSurface`, `alternativesRejected`,
expected impact, risks, validation, confidence, and `evidenceRefs`. Keep session-only advice in the
clearly labelled recap; do not translate it into a durable candidate without new evidence and a
separately authorized task.
