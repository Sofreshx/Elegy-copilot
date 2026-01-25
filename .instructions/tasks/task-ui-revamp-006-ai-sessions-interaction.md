---
schema: task/v1
id: task-000001
title: "UI Revamp: AI Sessions & Interaction Pages"
type: feature
status: done
priority: high
owner: "dylan"
skills: ["feature-creator", "design", "react-query", "testing-frontend-unit", "docs"]
depends_on: []
next_tasks: []
created: "2026-01-20"
updated: "2026-01-20"
---

## Context

We need a set of pages and components to let users view AI session history and traces, interact with running AI agents, and approve items (trades, quota requests) that the AI proposes. Backend APIs already expose:

- Sessions: `/ai/sessions`, `/ai/sessions/{id}`, `/ai/sessions/metrics`
- Trade approvals: `/trades/proposals/pending`, `/trades/proposals/{id}/approve` (and reject endpoints)
- Quota system: `/quotas/status`, `/quotas/requests/pending` (and approve/deny endpoints)
- There are ~23 agent tools available; UI should surface tool invocations and decision points.

**Dependencies:** T3 (Navigation) must be in place (routing / nav shell) before committing pages to nav.

## Acceptance Criteria

- [ ] Sessions list with filtering (type, status, date range, model) is implemented and functional
- [ ] Session detail page displays full trace (timeline of steps, LLM prompts/responses, tool invocations, decision highlights)
- [ ] Interact page shows pending approvals (trade proposals and quota requests)
- [ ] Users can approve/reject trades inline from the UI (with optional notes)
- [ ] Users can approve/deny quota requests inline from the UI (with optional notes)
- [ ] Metrics panel displays usage stats (sessions/hour, tokens over time, cost summary, success/failure rates)
- [ ] A chat-like interface (basic) is available for sending messages/requests to AI and receiving responses

## Components / Pages to Build

1. AISessions.razor (`/ai/sessions`)
   - Paginated session list with filters:
     - Session type (strategy_run, research, etc.)
     - Status (Running, Completed, Failed)
     - Date range
     - Model used
   - Session cards showing:
     - Type and status badge
     - Started/completed time
     - Model, tokens, cost
     - Quick view of outputs

2. AISessionDetail.razor (`/ai/sessions/{id}`)
   - Header with full session info
   - Trace visualization:
     - Step-by-step timeline
     - LLM calls with prompts/responses (expandable)
     - Tool invocations with inputs/outputs
     - Decision points highlighted and linked to outputs
   - Outputs panel:
     - Structured data display
     - Confidence scores
     - Source references
   - Cost breakdown (tokens, estimated cost)

3. AIInteract.razor (`/ai/interact`) - NEW
   - Chat interface (send ideas, ask for explanations, view AI responses)
   - Pending Approvals panel:
     - Trade proposals awaiting approval
     - Quota requests awaiting approval
     - One-click approve/reject with optional notes
   - Active Sessions panel (running sessions with live status if feasible)
   - Quick Actions (trigger new agent run, view recent decisions)

4. TradeApprovalCard.razor (component)
   - Compact card showing market, direction, amount, price
   - Reasoning summary, confidence score
   - Approve/Reject buttons and notes input

5. QuotaApprovalCard.razor (component)
   - Shows resource type, amount, session context, reason
   - Approve/Deny buttons and notes input

6. AIMetricsPanel.razor (component)
   - Sessions per hour chart
   - Token usage over time
   - Cost summary
   - Success / failure rates

## Plan / Approach

1. Create routes/pages and wire to navigation (coordinate with T3 routing changes).
2. Implement API client hooks (use `react-query` / equivalent pattern in Blazor; follow project conventions) for the endpoints listed above.
3. Build UI components with accessibility and responsive layout in mind.
4. Add unit/component tests for critical pieces (Approval cards, Interact UI, Sessions list filtering).
5. Add E2E checks for happy-path flows (approve trade → backend call; open session detail → traces visible).
6. Instrument Metrics panel data fetch and charting (use existing charting components used elsewhere in app).
7. Add feature flags if needed for gradual rollout.
8. Document the pages and any new API usage in `docs/` and in component README comments.

## Acceptance / UX Notes

- Approvals should show sufficient reasoning / confidence for a user to make a quick decision.
- The chat interface may be basic initially (send message → triggers server-side agent run and returns reply) with plan to make it interactive/streaming later.
- Link from any decision or output to the relevant session detail for "why did you decide X?".

## Testing & Validation

- Unit tests for components and hooks
- Integration tests for pages hitting mocked API responses
- E2E tests for approve/reject workflows

## Next Steps

1. Assign an owner and pick a sprint to schedule (priority: HIGH)
2. Start by scaffolding pages and components, mock API responses, and implement filters on the sessions list
3. Once scaffolding is validated, wire to real APIs and add tests

## Notes / Discoveries

- Keep an eye on the cost display: ensure token and pricing models are consistent with backend metrics
- Check if there are existing session trace formats to reuse in the detail page

## Deliverables
- `.razor` pages: `AISessions.razor`, `AISessionDetail.razor`, `AIInteract.razor`
- Components: `TradeApprovalCard.razor`, `QuotaApprovalCard.razor`, `AIMetricsPanel.razor`
- Tests: unit + integration + e2e as described

---

**Suggested Adjacent Tasks:**
- Add tests task: `test-000001--ai-sessions-interaction-tests.md` (unit, integration, e2e)
- Docs: update navigation docs and README for AI pages

**Questions / Clarifications:**
1. Should the `AIInteract` chat be real-time (streaming) in initial implementation or deferred to a follow-up? (Recommended: defer to future; implement basic request-response)
2. Who should be the default owner if not `dylan`?

**Done**: Created `.instructions/tasks/task-ui-revamp-006-ai-sessions-interaction.md` (task-000001)
