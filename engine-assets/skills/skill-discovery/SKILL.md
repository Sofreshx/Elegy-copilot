---
name: skill-discovery
description: "Vault-first skill routing for the search/execute pattern. Use this to resolve the smallest matching on-demand skill, apply the deterministic resolver chain, and load only the skills needed for the current step."
---

# Skill Discovery

## Purpose

Most domain-specific skills live in the **skill vault** (`~/.copilot/skills-vault/`) and stay unloaded by default. This keeps startup context and token usage low while still making domain guidance available on demand.

In the first-class Instruction Engine workflow, `@search` handles capability discovery and `@execute` handles capability application. This skill is the always-loaded routing contract they rely on for vault-first skill selection.

## Deterministic resolver chain

Use this exact order unless the caller already named the exact skill:

1. Direct load for an explicit skill name
2. Stack detection for project/framework clues
3. Catalog-backed metadata search/resolution
4. Semantic fallback as the last resort

Rules:
- Stop at the first step that yields a confident match.
- Keep selection deterministic: on ties, choose lexical order by skill name.
- Prefer the narrowest domain fit over broader/general skills.

## Multi-Skill Orchestration Policy

- Select one **primary skill** that directly matches the core task domain.
- Add **supporting skills** only for concrete cross-cutting needs (testing, security, deployment, audit format).
- Cap loaded skills per turn at 3 total: 1 primary + up to 2 supporting.
- Budget context intentionally: load primary first, then add supporting skills only when the current step needs them.
- If unsure, load fewer skills and re-evaluate after reading the primary one.

## When to stop and load

Load the resolved `SKILL.md` as soon as one of these is true:

- The user, caller, or task already names the exact skill.
- Stack detection returns a clear relevant skill for the current work.
- Catalog-backed search produces a confident top match.
- Only one narrow candidate remains after deterministic tie-breaking.

If no confident match exists, return the best candidate plus the ambiguity instead of speculatively loading multiple broad skills.

## Source of truth

- Canonical workflow and routing policy: `docs/system/search-execute-workflow.md`
- Skills governance: `docs/system/skills-governance.md`
- System docs index: `docs/system/index.md`

## Compact skill reference index

Keep detailed behavior in the canonical docs and individual skills. Use this compact index only to anchor deterministic vault references.

- Auth, security, and trust → `auth`, `firebase-auth`, `security`, `truth-sync`
- .NET and backend frameworks → `csharp-expert`, `wolverine-core`, `wolverine-http`, `marten-documents`, `marten-events`, `marten-linq-querying`, `orleans`, `signalr`, `aspire-apphost`, `aspire-deployment`
- Frontend, AI, and automation → `frontend`, `react-query`, `openai-compatible`, `microsoft-agent-framework`, `agent-browser`
- Testing, observability, and delivery → `testing-dotnet-unit`, `testing-frontend-unit`, `alba-integration-tests`, `e2e-workflow`, `test-caching-verification`, `logging-observability`
- Planning, governance, and audits → `planning-feature`, `planpack-authoring`, `roadmap-authoring`, `project-conventions-governance`, `documentation-structure-governance`, `audit-report-formats`, `stack-audit-patterns`, `skill-forge`
- Review and workflow support → `code-review`, `critic`, `refactor`, `friction-feedback`, `instruction-quality`, `system-cleanup`
- Superpowers workflow pack → `superpowers-brainstorming`, `superpowers-dispatching-parallel-agents`, `superpowers-executing-plans`, `superpowers-finishing-a-development-branch`, `superpowers-receiving-code-review`, `superpowers-requesting-code-review`, `superpowers-subagent-driven-development`, `superpowers-systematic-debugging`, `superpowers-test-driven-development`, `superpowers-using-git-worktrees`, `superpowers-using-superpowers`, `superpowers-verification-before-completion`, `superpowers-writing-plans`, `superpowers-writing-skills`
