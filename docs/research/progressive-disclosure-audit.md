---
created: 2026-03-01
updated: 2026-03-01
category: research
status: current
doc_kind: node
id: progressive-disclosure-audit
summary: Audit of how well instruction-engine implements progressive disclosure across documentation, skills, and agent context.
tags: [documentation, progressive-disclosure, context-window, audit]
---

# Research: Progressive Disclosure Audit

## Scope

Evaluate how effectively instruction-engine layers information from surface-level to deep detail. Assess whether agents (and humans) can navigate from general orientation to specific domain knowledge without overloading context.

---

## Current Architecture — The Disclosure Layers

### Layer 0: Entry Point (README.md + copilot-instructions.md)

**README.md** provides:
- One-paragraph purpose statement
- Install commands (3 lines)
- Asset inventory table (agents, skills, prompts, instructions with counts)
- Key agents table (10 agents with one-line purpose each)
- State location summary

**copilot-instructions.md** provides:
- Safety rules (non-negotiable guardrails)
- Operating rules
- `/plan` and `/fleet` workflow contracts
- Subagent delegation heuristics
- Skill discovery protocol (the "1-2-3 resolution pattern")

**Assessment**: Good compression. An agent loading these two files gets enough to start working and knows where to look next. Token cost is reasonable (~2500 tokens combined).

**Gap**: README doesn't mention the doc-graph or how to navigate the documentation hierarchy. It jumps from "install" to "asset inventory" with no breadcrumb to `docs/system/index.md`.

---

### Layer 1: Documentation Graph (docs/system/)

**Structure**: Index → MOC → Node pattern from doc-graph-spec.

**index.md** (35 lines):
- Links to doc-graph-spec (the contract)
- Lists 7 MOCs + 1 runbook
- Distinguishes canonical vs non-canonical (research)

**MOCs** (7 total):
- orchestration-and-agents
- mcp-workflow
- testing-and-e2e
- security-model-and-safety
- session-state
- skills-governance
- software-design-concepts

**Assessment**: Well-structured for progressive disclosure — an agent can navigate Index → relevant MOC → specific node in 2-3 file reads. The wikilink + markdown dual-link rule is clever for both agent traversal and human readability.

**Gaps**:
1. **MOCs are thin**: Most MOCs are ~15–25 lines with 1–3 links. `skills-governance` MOC has exactly one link. This creates an unnecessary traversal step — the agent reads a MOC just to get one link it could have gotten from the index directly.
2. **No agent is instructed to use the doc-graph**: copilot-instructions.md doesn't mention `docs/system/index.md` or the MOC pattern. Agents discover skills via the vault but have no equivalent "discover documentation" protocol.
3. **Orphaned top-level docs**: Files like `docs/copilot-sdk-spike.md`, `docs/agent-architecture-simplicity.md` exist outside the graph structure (some are redirect stubs, some aren't).

---

### Layer 2: Skills Architecture (skills/ + skills-vault/)

**Always-loaded** (4 skills in `~/.copilot/skills/`):
- `core-guardrails` — safety rules
- `skill-discovery` — keyword map + discovery protocol
- `implementation-friction` — code quality feedback capture
- `stack-detector` — project-wide tech identification

**On-demand** (30+ skills in `~/.copilot/skills-vault/`):
- Domain-specific: wolverine, marten, orleans, signalr, firebase-auth, etc.
- Cross-cutting: security, debug, refactor, code-review, etc.
- Planning: planning-feature, planpack-authoring
- Testing: testing-dotnet-unit, testing-frontend-unit, alba-integration-tests

**Assessment**: This is the strongest progressive disclosure layer. The vault pattern means 30+ skills (~50K+ tokens if all loaded) are compressed to zero startup cost, with a well-defined discovery protocol.

**Gaps**:
1. **Keyword map is static and manual**: The skill-discovery SKILL.md contains a hardcoded keyword→skill table. Adding a new skill requires updating this table — easy to forget.
2. **No fallback for ambiguous queries**: If keywords don't match exactly, the agent falls back to listing `skills-vault/` and pattern-matching by directory name. This works but is fragile for skills with non-obvious names (e.g., `alba-integration-tests` for someone asking about "endpoint testing").
3. **Default-handled skills are hidden but still in vault**: Skills like `debug`, `refactor`, `design` are classified as "default-handled" in governance but still exist in the vault. An agent might load them unnecessarily.

---

### Layer 3: Agent Specialization (agents/)

**32 agents** with specialized personas:
- Orchestrators: orchestrator, elegy-planner, elegy-direction, elegy-subplanner
- Implementers: impl-business, impl-infra
- Reviewers: code-reviewer, reviewer-opus-4-6, reviewer-gpt-5-3-codex
- Scanners: security-scanner, stack-auditor, deploy-auditor
- Utilities: agent-governor, instruction-auditor

**Assessment**: Good separation of concerns. Agents are the "action layer" — they don't carry redundant context because each has a focused system prompt.

**Gap**: Agent discovery is implicit. If you're not the orchestrator (who knows which agents exist), there's no equivalent of skill-discovery for agents. The copilot-instructions.md mentions some agents but not all 32.

---

## Disclosure Flow Analysis

### Happy Path (well-known domain)

```
User asks about Wolverine endpoint
→ Agent matches keyword "wolverine endpoint"
→ skill-discovery resolves to wolverine-http
→ Agent loads SKILL.md from vault
→ Works with full domain context
```

**Verdict**: Excellent. 2-step disclosure, minimal wasted context.

### Moderate Path (project kickoff)

```
User starts working on a new project
→ Agent runs stack-detector
→ Scans .csproj/package.json for package references
→ Returns list of relevant skill names
→ Agent loads 2-3 most relevant skills
→ Works with appropriate context
```

**Verdict**: Good. 3-step disclosure, but stack-detector is thorough.

### Weak Path (documentation lookup)

```
User asks about how session state works
→ Agent has no instruction to check docs/system/
→ May grep for "session state" across entire workspace
→ Likely hits docs/system/session-state-artifacts.md eventually
→ But may also hit noise from copilot-sdk/, RannIA/, etc.
```

**Verdict**: Fragile. No structured discovery path. The doc-graph exists but nothing tells agents to use it.

### Weak Path (cross-cutting concern)

```
User asks about security practices
→ skill-discovery resolves "security" → security skill
→ Agent loads security skill from vault
→ But also needs docs/system/security-model.md for project-specific policy
→ No link from skill to project docs
```

**Verdict**: Partial disclosure. Skills and docs are disconnected graphs.

---

## Scored Assessment

| Dimension | Score (1-5) | Notes |
|---|---|---|
| **Entry point clarity** | 4 | README + copilot-instructions together are strong |
| **Doc-graph structure** | 4 | Well-designed, proper spec, validator exists |
| **Doc-graph discoverability** | 2 | Nothing tells agents the graph exists |
| **Skill progressive disclosure** | 5 | Vault pattern is best-in-class |
| **Skill discoverability** | 4 | Good keyword map, some edge-case fragility |
| **Agent progressive disclosure** | 3 | Good specialization, weak discovery for non-orchestrators |
| **Cross-layer navigation** | 2 | Skills and docs don't cross-reference each other |
| **Research → canonical promotion** | 3 | research/ vs system/ distinction is clear but no workflow to promote |

**Overall: 3.4/5** — Strong individual layers, weak connections between them.

---

## Key Findings

### What Works Well

1. **Vault pattern for skills**: Zero-startup-cost skill management with on-demand loading is the strongest progressive disclosure mechanism in the system.
2. **Doc-graph spec**: Index → MOC → Node is architecturally sound and validated.
3. **Skill-discovery keyword map**: Covers most common domains and is easy to use.
4. **Separation of canonical vs research**: Prevents stale notes from polluting system-of-record docs.

### What Needs Improvement

1. **Documentation is invisible to agents**: The doc-graph has no discovery entry point in copilot-instructions.md. Agents don't know it exists.
2. **Thin MOCs add traversal cost with little value**: Several MOCs contain 1-2 links. They should either be enriched with routing guidance or collapsed into the index.
3. **Skills and docs are disconnected**: A skill about security doesn't link to the security model doc. A skill about testing doesn't link to the testing MOC.
4. **No "discover documentation" protocol**: Skills have a 3-step discovery protocol. Docs have nothing equivalent.
5. **Agent discovery gap**: 32 agents exist but only ~10 are mentioned in copilot-instructions.md. No agent-discovery equivalent to skill-discovery.

---

## Recommendations (for future planning)

1. **Add a doc-discovery protocol to copilot-instructions.md**: Teach agents that `docs/system/index.md` is the entry point for project knowledge, analogous to skill-discovery for domain knowledge.
2. **Enrich or collapse thin MOCs**: If a MOC has <3 links, either add routing context (when to read which node) or fold it into the index.
3. **Cross-link skills to docs**: Add `Related docs:` sections to skills that have corresponding system docs, and vice versa.
4. **Add agent-discovery skill or section**: Parallel to skill-discovery, document when to invoke each agent beyond the orchestrator.
5. **Automate keyword map sync**: When a new skill is added to the vault, a validation check should flag if skill-discovery's keyword map is missing an entry.

---

## References

- [docs/system/index.md](../system/index.md)
- [docs/system/doc-graph-spec.md](../system/doc-graph-spec.md)
- [engine-assets/copilot-instructions.md](../../engine-assets/copilot-instructions.md)
- [engine-assets/skills/skill-discovery/SKILL.md](../../engine-assets/skills/skill-discovery/SKILL.md)
- [docs/system/skills-governance.md](../system/skills-governance.md)
- [docs/research/skillpointer-codemode-techniques.md](skillpointer-codemode-techniques.md)
