---
created: 2026-02-23
updated: 2026-02-23
category: system
status: draft
doc_kind: node
id: orchestrator-implementation-plan
summary: Historical implementation plan for introducing the orchestrator agent system; retained for reference only.
tags: [orchestrator, planning]
---

# Orchestrator Implementation Plan

> Historical note: this document records the original rollout plan. Current shipped behavior is
> defined by `engine-assets/agents/orchestrator.agent.md` and
> `docs/system/orchestrator/user-guide.md`.

## Date
2026-02-17

## Scope
Create the new Orchestrator agent system in the instruction-engine repo.

## Deliverables

### Phase 1: Foundation (Core Agent Files)

#### 1.1 Create @orchestrator agent definition
- File: `engine-assets/agents/orchestrator.agent.md`
- The main orchestrator agent with:
  - Complete lifecycle (Phase 0-5)
  - Request classification routing
  - Context curation protocol
  - Subagent delegation patterns
  - Fast path for trivial requests
  - Follow-up loop
  - Seamless Agent integration (with fallback)
  - Resume detection for active sessions
- Tools: read, edit, search, execute/runInTerminal, agent/runSubagent, todo, vscode/askQuestions, jraylan.seamless-agent/askUser, jraylan.seamless-agent/planReview, jraylan.seamless-agent/walkthroughReview, web/fetch, web/githubRepo
- agents list: o-reframer, o-planner, search, execute, impl-infra, impl-business, impl-reviewer, final-reviewer, work-unit-runner, code-explorer, code-architect, code-reviewer, research-ideation, unit-test-runner, integration-test-runner, e2e-browser, e2e-validator, doc-writer, stack-auditor, deploy-auditor, security-auditor, instruction-auditor, reviewer-gpt-5-3-codex, reviewer-opus-4-6
- user-invocable: true
- disable-model-invocation: true (orchestrator should use the best available model)

#### 1.2 Create @o-reframer agent definition
- File: `engine-assets/agents/o-reframer.agent.md`
- Request analysis and classification subagent
- Read-only (no file edits, no terminal)
- Tools: read, search
- Output: Structured brief (classification, type, scope, ambiguities, risks)
- user-invocable: false

#### 1.3 Create @o-planner agent definition
- File: `engine-assets/agents/o-planner.agent.md`
- Planning subagent that produces plan packs
- May edit only the approved plan artifact surface for the selected workflow
- Tools: read, search, edit
- Input: Enriched brief + exploration + skills + project context
- Output: Plan pack (2 files) using existing format
- Integrates planpack-writer quality gate checklist
- user-invocable: false

### Phase 2: Supporting Updates

#### 2.1 Update copilot-instructions.md
- Add @orchestrator to the delegation section as the recommended entry point
- Mark executive agents as deprecated (still available)
- Document the orchestrator's Seamless Agent integration

#### 2.2 Update work-unit-runner for fast path
- Add support for direct execution without a plan pack reference
- Accept inline WU spec when no planPack path is provided
- Keep backward compatible with existing plan-pack workflow

#### 2.3 Update code-reviewer for 3-status output
- Formalize APPROVED / NEEDS_REVISION / FAILED as standard output statuses
- Include specific feedback for NEEDS_REVISION
- Keep backward compatible

### Phase 3: Documentation & Migration

#### 3.1 Create orchestrator user guide
- File: `docs/system/orchestrator/user-guide.md`
- How to use @orchestrator
- When to use fast path vs full planning
- Seamless Agent setup (optional)
- Migration from older executive variants

#### 3.2 Clean Executive-era migration residue
- Update scripts, templates, and documentation that still point to executive-era names
- Redirect new work to `@orchestrator`
- Preserve only explicitly supported migration notes

### Phase 4: Validation

#### 4.1 Test orchestrator on a trivial request
- Verify fast path works (no plan, direct execution)
- Verify context curation (subagents get minimal context)
- Verify follow-up loop

#### 4.2 Test orchestrator on a standard request
- Verify plan creation and approval flow
- Verify WU execution
- Verify testing checkpoint
- Verify code review gate

#### 4.3 Test orchestrator on a complex request
- Verify discuss/research phase
- Verify cross-model review
- Verify replan handling

## Dependencies
- Seamless Agent extension (optional — graceful fallback to vscode/askQuestions)
- Existing subagents (code-explorer, code-architect, code-reviewer, etc.) — no changes needed
- Existing plan-pack format — reused as-is

## Risks
1. Orchestrator agent definition may be too large → Mitigation: Keep instructions focused on routing, delegate details to subagent prompts
2. Seamless Agent extension may have stability issues → Mitigation: Always include fallback to vscode/askQuestions
3. Reframer classification may be inaccurate → Mitigation: Include "uncertain" option, default to standard path

## Success Criteria
- [ ] User can invoke @orchestrator for any type of request
- [ ] Trivial requests complete without creating plan files
- [ ] Standard requests produce plan packs and execute through review
- [ ] Complex requests include research/discussion before planning
- [ ] Seamless Agent tools used when available, graceful fallback otherwise
- [ ] All existing subagents work with the new orchestrator without modification
- [ ] Executive-era references are removed or clearly marked as historical

## Estimated Work Units
- WU-001: Create orchestrator.agent.md (core orchestrator)
- WU-002: Create o-reframer.agent.md (request classifier)
- WU-003: Create o-planner.agent.md (plan-pack planner)
- WU-004: Update copilot-instructions.md (delegation docs)
- WU-005: Update work-unit-runner for fast path support
- WU-006: Update code-reviewer for 3-status output
- WU-007: Create user guide documentation
- WU-008: Remove or rewrite Executive-era migration residue
- WU-009: Validation testing (manual)
