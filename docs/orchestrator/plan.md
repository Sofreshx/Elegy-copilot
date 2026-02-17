# Orchestrator Implementation Plan

## Date
2026-02-17

## Scope
Create the new Orchestrator agent system in the instruction-engine repo.

## Deliverables

### Phase 1: Foundation (Core Agent Files)

#### 1.1 Create @orchestrator agent definition
- File: `.github/agents/orchestrator.agent.md`
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
- agents list: o-reframer, o-planner, work-unit-runner, code-explorer, code-architect, code-reviewer, research-ideation, unit-test-runner, integration-test-runner, reviewer-gpt-5-3-codex, reviewer-opus-4-6, context-curator, e2e-browser, e2e-live-observer, doc-writer, app-runtime-manager
- user-invocable: true
- disable-model-invocation: true (orchestrator should use the best available model)

#### 1.2 Create @o-reframer agent definition
- File: `.github/agents/o-reframer.agent.md`
- Request analysis and classification subagent
- Read-only (no file edits, no terminal)
- Tools: read, search
- Output: Structured brief (classification, type, scope, ambiguities, risks)
- user-invocable: false

#### 1.3 Create @o-planner agent definition
- File: `.github/agents/o-planner.agent.md`
- Planning subagent that produces plan packs
- May edit only `.instructions/artefacts/`
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
- File: `docs/orchestrator/user-guide.md`
- How to use @orchestrator
- When to use fast path vs full planning
- Seamless Agent setup (optional)
- Migration from older executive variants

#### 3.2 Add deprecation notices to old agents
- Update executive.agent.md, executive2.agent.md, executive2p5.agent.md
- Add deprecation notice in description pointing to @orchestrator
- Keep them functional for backward compatibility

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
- [ ] Old executive agents remain functional with deprecation notices

## Estimated Work Units
- WU-001: Create orchestrator.agent.md (core orchestrator)
- WU-002: Create o-reframer.agent.md (request classifier)
- WU-003: Create o-planner.agent.md (plan-pack planner)
- WU-004: Update copilot-instructions.md (delegation docs)
- WU-005: Update work-unit-runner for fast path support
- WU-006: Update code-reviewer for 3-status output
- WU-007: Create user guide documentation
- WU-008: Add deprecation notices to old agents
- WU-009: Validation testing (manual)
