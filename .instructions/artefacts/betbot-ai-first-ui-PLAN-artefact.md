# BetBot — AI-First UI: Plan Artefact 🧭

## Goal 🎯
Transform BetBot from a manual strategy editor with AI assistance into an **AI-autonomous strategy creation platform** where humans act as overseers: approving, guiding, and observing AI reasoning and strategy generation.

---

## Acceptance Criteria ✅
1. **AI Command Center**: New primary UI that shows AI activity in real-time (tools invoked, markets analyzed, reasoning steps, strategy iterations).
2. **Strategy Pipeline View**: Kanban-like view that displays AI-proposed strategies with full reasoning chains, data sources used, backtesting results, and confidence metrics.
3. **Robust Human-in-the-Loop**: Clear accept/reject/modify workflow for proposals with feedback that the AI learns from (audit trail + versioned feedback).
4. **Agent Autonomy Controls**: Configurable AI behavior (exploration budget, risk tolerance, strategy types, time constraints) via a settings surface.
5. **Data Source Dashboard**: A live feed panel that reveals what the AI sees (Polymarket, Twitter, Reddit) with per-item relevance/score annotations.
6. **Remove/Hide Legacy UI**: Manual strategy editor and static market lists become secondary or hidden behind an "Expert Mode" toggle.

---

## Key Context 🔍
- **Agent infra**: `src/BetBot.Agents/AgentService.cs` orchestrates tool calls in iterative LLM loops.
- **Available tools**: `ProposeStrategyTool`, `MutateStrategyTool`, `ListMarketsTool`, `GetMarketDetailsTool`, `ScanForCorrelationsTool`, `DetectRegimeTool`, `ProposeHypothesisTool`, `TestHypothesisTool`, `RecordExplorationFindingTool`.
- **Workers**: `MarketExplorerWorker`, `BacktestWorker` are available for autonomous tasks and heavy processing.
- **UI stack**: Blazor Server (InteractiveServer render mode), Bootstrap for styling.
- **UI files**: `src/BetBot.Web/Components/Pages/` is the primary location for page components.
- **API**: Wolverine HTTP endpoints live in `src/BetBot.Api/Endpoints/`.

---

## Decisions & Rationale 🧠
- Start Phase 1 immediately to deliver visibility and iterative demos; Command Center becomes the new landing page.
- SignalR preferred for streaming agent activity; begin with polling fallback to reduce early complexity and iterate to SignalR.
- Keep the Manual Strategy Editor behind an `Expert Mode` feature flag to prevent sudden UX disruption and enable rollback.
- Store reasoning chains and tool-invocation events in a replayable, privacy-conscious format (timestamped event stream with truncated raw LLM output and references to stored artifacts).
- Backtests run by `BacktestWorker`; UI will show status and partial results as they arrive.

---

## Task Summary & Task Graph ⚙️
Phase and task IDs map to the approved plan. Dependencies are indicated.

Phase 1 — AI Command Center (start immediately)
- 1.1 CommandCenter.razor — Landing page replacement with real-time agent activity feed, active sessions, and stats. (Depends: none)
- 1.2 AgentActivity.razor — Live reasoning transparency with step-by-step tool invocations (Depends: 1.1; benefits from Phase 4 streaming)
- 1.3 StrategyPipeline.razor — Kanban-style pipeline: Exploring → Proposed → Backtesting → Review → Active/Rejected. (Depends: 1.1)

Phase 2 — Enhanced Proposal Review System (depends on Phase 1)
- 2.1 ProposalReview.razor — Deep-dive review: full reasoning chain, data sources, backtest results, editable annotations. (Depends: 1.2, 1.3)
- 2.2 TradeProposalCard (component extension) — Add AI context: reasons, signal breakdown, risk metrics. (Depends: 2.1)

Phase 3 — Autonomy Controls & Configuration (can run parallel to Phase 2)
- 3.1 AgentSettings.razor — AI behavior controls: exploration budget, strategy preferences, risk envelope, approval thresholds.
- 3.2 DataSourcesLive.razor — Live feed dashboard showing AI-seen items + relevance annotations.

Phase 4 — Backend Enhancements (start early; cross-cutting)
- 4.1 SignalR Hub for agent streaming — Real-time push for agent steps, new proposals, and status updates. (Kick off early; can be phased: polling -> SignalR)
- 4.2 Agent tracing extensions — Emit tool invocation events, timing metrics, and store reasoning chains for replay and audit. (Will inform UI display components)

Phase 5 — Cleanup & Navigation (after Phases 1–3)
- 5.1 Navigation reorg — Primary nav: `Command Center`, `Pipeline`, `Proposals`, `Settings`; Legacy items move to secondary or hidden.
- 5.2 Remove/deprecate demo pages and legacy manual-first components (behind feature flags and deprecation notices).

Task Dependencies (short):
- Phase 2 depends on Phase 1
- Phase 3 can run in parallel with Phase 2
- Phase 4 should start early and provide streaming and tracing foundation for Phase 1.2 and Phase 2.1
- Phase 5 requires Phases 1–3 complete

---

## Execution Notes & How to Run Work 🏃‍♂️
- Suggested iteration cadence: 2-week sprints. Multi-week effort; estimate 6–10 weeks depending on team size.
- Deliver incremental demos: after 1.1 (Command Center shell + sample feed), after 1.2 (live activity), after 1.3 (pipeline basics), then ProposalReview (2.1) and AgentSettings (3.1).
- Start SignalR as an early spike with an opt-in SignalR channel; maintain a polling fallback to reduce UX risk.
- Data model: design `AgentEvent` and `StrategyProposal` entities with relations to backtests and observations. Persist minimal LLM content for privacy and storage control.
- Security: gate agent controls and proposal approvals behind role-based authorization; store audit logs for approvals and rejections.
- Testing: add component tests for new Razor components and API contract tests for streaming endpoints.

---

## Risks & Mitigations ⚠️
- SignalR complexity → Begin with polling-first and incrementally replace with SignalR once stable.
- Slow/unpredictable tool calls → Show clear loading states, timeouts, and partial-progress UI; surface worker job IDs and estimated time.
- Loss of manual control → Keep legacy editor as `Expert Mode`, enable read-only fallback during rollouts.
- Data privacy & cost → Truncate/pin LLM outputs; allow retention policies for reasoning data.

---

## Validation & Acceptance Testing ✅
- Build E2E scenarios: AI proposes a strategy → Strategy appears in Pipeline → Backtest runs → Proposal appears in Review → Approve or modify → Strategy becomes Active and audit log records decision.
- UI acceptance: Verify live streaming (or polling) of events, correctness of the Kanban moves, and visibility of backtest metrics and confidence scores.
- Security: Role-based approval tests; verify only authorized users can change autonomy controls.
- Performance: Load test streaming and pipeline list updates; ensure UI remains responsive with multiple concurrent agent sessions.

---

## Rollback & Incremental Launch Plan ↩️
- Use feature flags for Command Center and new Pipeline. Default to the existing Dashboard until opt-in toggle is enabled for a user or tenant.
- Migrate gradually: pilot with internal team, then beta users, then full rollout. Keep Manual Editor accessible as `Expert Mode` until final deprecation.

---

## Milestones & Rough Timeline ⏱️
- Sprint 1–2: Phase 1 MVP (1.1, 1.2 basic activity feed, 1.3 pipeline skeleton)
- Sprint 3–4: Phase 2 & Phase 4 (ProposalReview, extend proposal cards, SignalR spike → incremental rollout)
- Sprint 4–5: Phase 3 (AgentSettings & DataSourcesLive), tracing persistence and backtest integration
- Sprint 6: Phase 5 cleanup, nav reorg, documentation, and deprecation notices

---

## Notes for Subagents / Engineers 🧩
- Files of interest for implementation:
  - Agent orchestration: `src/BetBot.Agents/AgentService.cs`
  - Workers: `MarketExplorerWorker`, `BacktestWorker`
  - UI components: `src/BetBot.Web/Components/Pages/`
  - API: `src/BetBot.Api/Endpoints/`
- Consider small, testable PRs (component + API contract + small DB migration) per task.

---

Prepared for delivery and iteration. Keep this artefact updated as tasks split into `.instructions/tasks/` entries and as implementation decisions evolve.