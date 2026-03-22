---
created: 2026-03-22
updated: 2026-03-22
category: research
status: current
doc_kind: node
id: agent-skill-audit-cli-practices-2026-03
summary: Read-only audit of repo-owned agents, skills, and prompts against current CLI-first and scoped-MCP practices, with recommendations for tighter search/execute execution and better token efficiency.
tags: [research, audit, cli, mcp, skills, prompts, search-execute, token-efficiency]
related: [skills-governance, search-execute-workflow, system-upgrade-direction-2026, skillpointer-codemode-techniques, skill-discovery-search-execute-audit]
---

# Research: Agent and Skill Audit, CLI Practices, and MCP Scope (2026-03)

## 1. Scope and method

This is a read-only research note for maintainers of instruction-engine. It audits repo-owned assets under `engine-assets/` and compares them with current external CLI-first and MCP-adjacent practices.

Method:

- Reviewed the canonical direction in [../system/skills-governance.md](../system/skills-governance.md), [../system/search-execute-workflow.md](../system/search-execute-workflow.md), and [../system/system-upgrade-direction-2026.md](../system/system-upgrade-direction-2026.md).
- Audited the named repo assets directly, including [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md), [../../engine-assets/skills/superpowers-using-superpowers/SKILL.md](../../engine-assets/skills/superpowers-using-superpowers/SKILL.md), [../../engine-assets/skills/system-cleanup/SKILL.md](../../engine-assets/skills/system-cleanup/SKILL.md), [../../engine-assets/skills/refactor/SKILL.md](../../engine-assets/skills/refactor/SKILL.md), [../../engine-assets/skills/code-review/SKILL.md](../../engine-assets/skills/code-review/SKILL.md), [../../engine-assets/skills/frontend/SKILL.md](../../engine-assets/skills/frontend/SKILL.md), [../../engine-assets/skills/auth/SKILL.md](../../engine-assets/skills/auth/SKILL.md), [../../engine-assets/skills/security/SKILL.md](../../engine-assets/skills/security/SKILL.md), [../../engine-assets/skills/csharp-expert/SKILL.md](../../engine-assets/skills/csharp-expert/SKILL.md), [../../engine-assets/agents/e2e-browser.agent.md](../../engine-assets/agents/e2e-browser.agent.md), and [../../engine-assets/prompts/instruction-engine-plan.prompt.md](../../engine-assets/prompts/instruction-engine-plan.prompt.md).
- Compared the static discovery contract in [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js) with the runtime search implementation in [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js).
- Used prior repo research in [skillpointer-codemode-techniques.md](skillpointer-codemode-techniques.md) and [skill-discovery-search-execute-audit.md](skill-discovery-search-execute-audit.md) as non-canonical inputs.
- Used public product and protocol materials listed in References for external practice comparison.

This note is intentionally non-canonical. It is an audit and a proposal surface, not policy.

## 2. Executive summary

The current Cloudflare/skill-vault/search direction is good in principle and incomplete in execution.

- Good in principle: the canonical model in [../system/search-execute-workflow.md](../system/search-execute-workflow.md) is the right shape. Keep startup context lean, route through `@search`, apply through `@execute`, and keep most skills vault-first and on-demand.
- Incomplete in execution: repo assets still carry a large amount of static prompt text, legacy `.instructions*` coupling, and duplicated workflow coaching that undercuts the promised token economy.
- The biggest waste cluster is the superpowers workflow pack. It is broad, harness-specific, and heavy on generic process coaching. The pack is listed as a large block in [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md), while [../../engine-assets/skills/superpowers-using-superpowers/SKILL.md](../../engine-assets/skills/superpowers-using-superpowers/SKILL.md) prescribes harness-specific loading behavior and global skill invocation discipline that overlaps with core instructions instead of adding narrow domain knowledge.
- `system-cleanup` is effectively detached. [../../engine-assets/skills/system-cleanup/SKILL.md](../../engine-assets/skills/system-cleanup/SKILL.md) operates entirely on `.instructions/tasks/`, `.instructions/tasks.archive/`, `.instructions/tasks.history.md`, and `.instructions/raw.tasks.md`, even though current repo guidance treats `.instructions/*` as legacy rather than the active planning surface.
- Several generic skills still point at missing legacy surfaces or mostly duplicate base-model behavior: `refactor`, `code-review`, `frontend`, `auth`, `security`, and `csharp-expert`.
- `skill-discovery` should stay, but only as a compact resolver contract. The embedded static skill index is both a drift hotspot and a token hotspot, especially because [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js) validates literal references inside the text while [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js) already implements metadata-backed ranking, targeting, and telemetry.
- Several E2E and audit agents still point at `.instructions-output` and related legacy paths. [../../engine-assets/agents/e2e-browser.agent.md](../../engine-assets/agents/e2e-browser.agent.md) still depends on `.instructions/e2e.config.md` and writes to `.instructions-output/e2e/`; adjacent audit/E2E assets show the same pattern.
- Prompts are repeating guardrails and reviewer contracts that already exist elsewhere. [../../engine-assets/prompts/instruction-engine-plan.prompt.md](../../engine-assets/prompts/instruction-engine-plan.prompt.md) repeats `core-guardrails` invocation and the two-reviewer approval loop rather than depending on a thinner orchestration contract.
- Keep the compact deterministic core: `core-guardrails`, `search`, `execute`, governance skills, and `audit-report-formats`.

## 3. Repo audit findings

### 3.1 High-value core is being crowded by low-value generic material

The repo already has a sound compact center.

- [../system/skills-governance.md](../system/skills-governance.md) explicitly says to keep skills high-signal and classify generic tasks as default-handled or deprecated.
- [../system/search-execute-workflow.md](../system/search-execute-workflow.md) explicitly says the majority of skills should remain vault-first and on-demand.
- [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js) already has the runtime machinery to rank by aliases, triggers, tags, frameworks, stacks, languages, repo context, and routing policy snapshots.

The problem is not the core model. The problem is the amount of repo-owned text still acting like a static pre-runtime encyclopedia.

### 3.2 Biggest waste cluster: the superpowers pack

This is the clearest prune-or-quarantine target.

- The repo ships a large `superpowers-*` cluster under `engine-assets/skills/`, and [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md) still embeds that pack as a large static index block.
- [../../engine-assets/skills/superpowers-using-superpowers/SKILL.md](../../engine-assets/skills/superpowers-using-superpowers/SKILL.md) is broad workflow doctrine, not narrow reusable project knowledge.
- The content is harness-specific. It talks about Claude Code `Skill` tooling, Gemini `activate_skill`, and platform adaptation rather than repo-specific engineering constraints.
- The content is also repetitive. It re-asserts workflow discipline already handled by higher-level instructions and other prompts.

Recommendation: keep only explicit compatibility shims that are still demonstrably used. Everything else in this pack should be opt-in, hidden, or removed from the always-visible discovery story.

### 3.3 `system-cleanup` is detached from the repo's current operating model

[../../engine-assets/skills/system-cleanup/SKILL.md](../../engine-assets/skills/system-cleanup/SKILL.md) assumes active `.instructions/tasks/*` and `.instructions/raw.tasks.md` surfaces. That does not match the current direction in [../system/search-execute-workflow.md](../system/search-execute-workflow.md) or the repo instructions that treat `.instructions/*` as legacy.

This is more than stale wording. It means the skill points to absent or de-emphasized surfaces and therefore provides negative routing value.

Recommendation: deprecate or rewrite it around current planning and issue surfaces. Until then, it should not participate in normal discovery.

### 3.4 Generic skills are still carrying legacy pointers or base-model guidance

Several skills fail the token-efficiency test.

- [../../engine-assets/skills/refactor/SKILL.md](../../engine-assets/skills/refactor/SKILL.md) depends on `../../contexts/project.patterns.md` and `../../warnings.md`, which are legacy surfaces in this repo. Most of its content is generic refactoring advice.
- [../../engine-assets/skills/code-review/SKILL.md](../../engine-assets/skills/code-review/SKILL.md) points at `../../warnings.md` and `../../contexts/project.patterns.md` and mostly restates generic review heuristics now better enforced through reviewer agents and prompt policy.
- [../../engine-assets/skills/frontend/SKILL.md](../../engine-assets/skills/frontend/SKILL.md) still starts from a task-file model under `.instructions/tasks/` and bundles broad aesthetic coaching that belongs in mode instructions or project-local guidance, not a general-purpose repo skill.
- [../../engine-assets/skills/auth/SKILL.md](../../engine-assets/skills/auth/SKILL.md) is nominally a backward-compatibility alias, but still points to `.instructions/tasks/` and an old `.github/skills/firebase-auth/SKILL.md` path rather than acting as a minimal redirect contract.
- [../../engine-assets/skills/security/SKILL.md](../../engine-assets/skills/security/SKILL.md) has useful review structure, but it still writes findings to `.instructions/raw.tasks.md`, which is a legacy surface.
- [../../engine-assets/skills/csharp-expert/SKILL.md](../../engine-assets/skills/csharp-expert/SKILL.md) is mostly broad, model-native .NET advice. It has little repo-specific authority and is a prime candidate for metadata-only discovery plus a much smaller execution brief.

Recommendation: shrink these into one of three states defined by [../system/skills-governance.md](../system/skills-governance.md): specialized, deprecated, or default-handled. The current middle state costs tokens without proving quality delta.

### 3.5 `skill-discovery` is valuable, but the embedded index is not

[../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md) should survive as a resolver contract because it clearly states:

- deterministic resolver order,
- single-primary plus limited supporting skills,
- stop-at-first-confident-match behavior.

That is the right abstraction. The static embedded skill list is the wrong implementation detail.

Why it is a problem:

- It creates drift pressure. [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js) parses literal references from `skill-discovery` and `stack-detector` to prove coverage, so text maintenance becomes part of the runtime contract.
- It duplicates what the runtime already knows. [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js) already resolves skills from structured metadata and produces explanation codes and telemetry.
- It burns context every time the meta-skill is loaded, even though the important part is the resolver policy, not the exhaustive list.

Recommendation: keep `skill-discovery` as contract text only. Move the authoritative inventory to generated metadata or runtime search only. If a human-readable index is still needed, generate it from the same metadata source and keep it out of always-loaded prompt paths.

### 3.6 E2E and audit agents still leak legacy storage assumptions

[../../engine-assets/agents/e2e-browser.agent.md](../../engine-assets/agents/e2e-browser.agent.md) still reads `.instructions/e2e.config.md` and writes to `.instructions-output/e2e/`. That is not aligned with current doc guidance and not aligned with a lean CLI-first path.

The same pattern appears in adjacent E2E and audit agents that write reports into `.instructions-output/*` or assume legacy local task surfaces.

Recommendation: either route output through current host/session artifacts or require explicit caller-provided output paths. Do not bake legacy path policy into agents that are supposed to be reusable.

### 3.7 Prompts are duplicating contracts that already exist elsewhere

[../../engine-assets/prompts/instruction-engine-plan.prompt.md](../../engine-assets/prompts/instruction-engine-plan.prompt.md) duplicates:

- `core-guardrails` invocation,
- plan structure requirements,
- the cross-model review loop and approval contract.

That duplication is not isolated to one prompt. It is a pattern in the prompt set. The result is avoidable token repetition and more surfaces to keep in sync.

Recommendation: prompts should reference a compact contract and only add the minimum prompt-local behavior. Reviewer verdict structure belongs with reviewer agents and canonical governance, not repeated in each adjacent prompt.

## 4. Search/execute and Cloudflare-direction assessment

The repo's direction is correct: yes, keep the Cloudflare-inspired search/execute model. The issue is execution discipline, not strategy.

What is working:

- [../system/search-execute-workflow.md](../system/search-execute-workflow.md) correctly centers fixed routing stages, vault-first skills, deterministic routing before broad search, and limited downstream loading.
- [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js) already looks more like the right runtime substrate than the static prompt text does. It computes scores from structured metadata and repo context, and it emits explanation codes and telemetry hooks.
- [../system/skills-governance.md](../system/skills-governance.md) already defines the right quality bar and pruning policy.

What is still incomplete:

- The repo still relies on a static embedded skill index in [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md).
- [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js) still couples validation to literal prompt references rather than to the canonical metadata store.
- Prior research in [skillpointer-codemode-techniques.md](skillpointer-codemode-techniques.md) and [skill-discovery-search-execute-audit.md](skill-discovery-search-execute-audit.md) already identified the same tension: the architecture wants late binding, but parts of the implementation still depend on eagerly maintained static maps.

Cloudflare Code Mode is useful here as inspiration, not as a blueprint to copy mechanically.

- The useful lesson is the fixed tool footprint and server-side late binding: present a small deterministic surface, keep the large capability set behind runtime search and execution, and mediate auth/session scope outside the parent prompt when possible.
- The repo already points in that direction, but it has not completed the move. It still keeps too much discovery detail in always-loaded or frequently-loaded text assets.

Bottom line:

- Keep search/execute.
- Keep the skill vault.
- Move from static embedded skill lists to metadata-backed or runtime-backed resolution only.
- Measure actual search -> selection -> invocation quality and prune assets with no demonstrated value.

## 5. External resources and practices

The external pattern that emerges is consistent across vendors and tools: keep the parent context small, make tooling explicit, and scope heavy capability surfaces tightly.

| Source | Relevant practice | Fit for this repo |
|---|---|---|
| Cloudflare Code Mode MCP | Fixed `search` and `execute` surface, server-side code mode, sandboxing, OAuth downscoping | Strong architectural fit. The repo should imitate the fixed-footprint and late-binding discipline, not keep static discovery inventories in prompt text. |
| Model Context Protocol introduction | Interoperable tool protocol across hosts and providers | Good fit when interoperability or auth/session mediation matters, but exposure should stay scoped. Dumping many MCP tools into the parent context recreates manifest bloat. |
| Claude Code hooks | `PreToolUse`, `PostToolUse`, `TaskCompleted`, `SubagentStop`, tool matching, scoped hook configuration | Useful for deterministic quality gates and post-edit validation without bloating every prompt. Better as runtime policy than repeated prose. |
| Claude Code subagents | Isolate high-volume work, restrict tool access, scope MCP servers to subagents, trade off skill preload against precision | Good fit for search/execute: keep the parent agent thin, push high-volume or high-risk work into scoped subagents. |
| Aider chat modes and automation | `ask` vs `code`, architect/editor split, automatic lint/test after edits | Good CLI-first reference. This repo should borrow the narrow, deterministic post-edit validation habit more than the conversational packaging. |
| OpenAI Codex CLI/docs/repo | AGENTS.md emphasis, skills, subagents, approvals, MCP, security posture | Confirms that the active CLI lane is converging on the same primitives: small contracts, explicit agent boundaries, explicit approval/security controls. |

Implications for instruction-engine:

- Favor CLI tools when they are self-describing, deterministic, and easy to scope inside a skill or agent.
- Favor MCP when interoperability, remote capability access, or auth/session mediation matters.
- Do not expose large MCP manifests or broad tool sets to the parent orchestration context by default. Scope them to subagents or narrow execution lanes.
- Prefer runtime hooks and narrow contracts over prose-heavy prompt duplication for guardrails and quality gates.

## 6. Recommended experiments / next steps

1. Replace the embedded static skill list in [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md) with a compact resolver-only contract. Make the runtime metadata index or search service the single source of truth.
2. Rewrite [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js) so it validates metadata parity and resolver coverage, not literal mentions in prompt text.
3. Add end-to-end measurement for search -> selection -> invocation -> outcome. Use that data to prove whether a skill or agent improves results before keeping it in the discovery surface.
4. Quarantine or deprecate the superpowers pack unless a concrete compatibility case still exists. Start with `superpowers-using-superpowers` and the plan-writing cluster.
5. Deprecate or rewrite `system-cleanup`, `refactor`, `code-review`, `frontend`, `auth`, `security`, and `csharp-expert` into smaller, current-state assets. Keep only the pieces that carry repo-specific authority.
6. Remove baked-in `.instructions-output` and `.instructions/*` assumptions from E2E and audit agents. Prefer caller-provided outputs or host/session artifact routing.
7. Shrink prompts such as [../../engine-assets/prompts/instruction-engine-plan.prompt.md](../../engine-assets/prompts/instruction-engine-plan.prompt.md) so they reference shared contracts instead of restating them.
8. Pilot scoped MCP usage only where it clearly beats direct CLI tooling, such as auth-brokered remote actions or cross-tool interoperability. Keep MCP servers attached to subagents or narrow execution modes.
9. Add CLI-style automatic narrow validation after edits, borrowing from Aider and hook-driven workflows: lint/test the smallest relevant surface automatically, then report deterministically.
10. Preserve and document the compact deterministic core: `core-guardrails`, `search`, `execute`, governance skills, `audit-report-formats`, and the runtime search service.

## 7. Conclusions

The repo is pointed in the right architectural direction. The search/execute model, vault-first loading, and metadata-backed discovery are the correct foundations for a leaner runtime. The main problem is not strategy. The main problem is that too many repo-owned assets still behave like static instruction catalogs, and that low-value prompt mass is diluting the direction the runtime is already taking.

For maintainers, the structural conclusion is clear: the runtime is moving toward late binding through search, execute, and structured metadata, while a meaningful part of `engine-assets/` still assumes eager, static, text-heavy discovery. That mismatch is now the dominant source of drag in this area. It increases token cost, creates drift pressure, and keeps compatibility and legacy material in the same discovery surface as the compact high-value core.

The keep/remove boundary should be explicit. Preserve the compact deterministic core identified in this note: `core-guardrails`, `search`, `execute`, governance-oriented skills, `audit-report-formats`, and the runtime search substrate. Reduce, quarantine, or remove broad generic skills, stale legacy-bound assets, compatibility-only prompt packs, and duplicated workflow prose unless they can show clear selection and outcome value in practice.

The tooling conclusion is also straightforward. Prefer CLI-first, scoped, deterministic tools when they can satisfy the task directly and predictably. Use MCP selectively where interoperability, auth/session mediation, or remote capability access actually justifies the added surface area. The issue is not MCP itself; the issue is exposing more tool surface than the lane needs.

The governance conclusion is that future pruning should be evidence-backed rather than taste-backed. Search hits, selections, downstream invocations, and measured outcome quality are the right signals for deciding what stays in the discovery path. If an asset is broad, expensive, stale, or compatibility-oriented and cannot demonstrate routing or execution value, this note supports treating it as a candidate for quarantine or removal.

### 7.1 What this note does not establish

- It does not create policy or override canonical guidance in [../system/index.md](../system/index.md).
- It does not, by itself, deprecate any specific skill, prompt, or agent.
- It does not argue that MCP, prompts, or compatibility layers are broadly wrong; it argues that they should stay scoped, justified, and measured.
- It does not introduce new evidence beyond the audit summarized above.

## 8. References

Internal repo sources:

- [../system/skills-governance.md](../system/skills-governance.md)
- [../system/search-execute-workflow.md](../system/search-execute-workflow.md)
- [../system/system-upgrade-direction-2026.md](../system/system-upgrade-direction-2026.md)
- [../../engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md)
- [../../engine-assets/skills/superpowers-using-superpowers/SKILL.md](../../engine-assets/skills/superpowers-using-superpowers/SKILL.md)
- [../../engine-assets/skills/system-cleanup/SKILL.md](../../engine-assets/skills/system-cleanup/SKILL.md)
- [../../engine-assets/skills/refactor/SKILL.md](../../engine-assets/skills/refactor/SKILL.md)
- [../../engine-assets/skills/code-review/SKILL.md](../../engine-assets/skills/code-review/SKILL.md)
- [../../engine-assets/skills/frontend/SKILL.md](../../engine-assets/skills/frontend/SKILL.md)
- [../../engine-assets/skills/auth/SKILL.md](../../engine-assets/skills/auth/SKILL.md)
- [../../engine-assets/skills/security/SKILL.md](../../engine-assets/skills/security/SKILL.md)
- [../../engine-assets/skills/csharp-expert/SKILL.md](../../engine-assets/skills/csharp-expert/SKILL.md)
- [../../engine-assets/agents/e2e-browser.agent.md](../../engine-assets/agents/e2e-browser.agent.md)
- [../../engine-assets/prompts/instruction-engine-plan.prompt.md](../../engine-assets/prompts/instruction-engine-plan.prompt.md)
- [../../scripts/validate-skill-discovery-map.js](../../scripts/validate-skill-discovery-map.js)
- [../../copilot-ui/lib/skillSearchService.js](../../copilot-ui/lib/skillSearchService.js)
- [skillpointer-codemode-techniques.md](skillpointer-codemode-techniques.md)
- [skill-discovery-search-execute-audit.md](skill-discovery-search-execute-audit.md)

External sources:

- Cloudflare Code Mode MCP blog: https://blog.cloudflare.com/code-mode-mcp/
- Model Context Protocol introduction: https://modelcontextprotocol.io/introduction
- Anthropic Claude Code documentation: https://docs.anthropic.com/en/docs/claude-code
- Aider documentation: https://aider.chat/docs/
- OpenAI Codex repository: https://github.com/openai/codex