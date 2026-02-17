# Mobile Companion Ecosystem for Remote Agentic Sessions - Plan Artefact

**Created**: 2026-02-01  
**Status**: Active  
**Project Type**: Multi-phase feature (30 tasks across 6 phases)

---

## Goal

Build a mobile companion ecosystem for remote agentic session management, enabling developers to:
- Monitor and control GitHub Copilot agent sessions from mobile devices
- Draft and refine ideas, plans, and features asynchronously
- Interact with AI chat for brainstorming and learning (using GitHub Pro API)
- Respond to agent validation/permission requests from anywhere
- View real-time progress across multiple VS Code instances

This system bridges the gap between desktop development and mobile accessibility, allowing continuous engagement with AI-powered workflows without being tethered to a workstation.

---

## Success Criteria

### Mobile App Capabilities
- ✅ View all connected VS Code clients and their connection status
- ✅ Queue and start agent sessions with configurable agent selection (e.g., `@executive2-planner`, `@debugger`)
- ✅ Draft, refine, and organize ideas/plans/features with tagging and categorization
- ✅ AI chat interface using user's GitHub Pro API key for brainstorming/learning
- ✅ Handle agent validation/permission requests (approve/deny/defer)
- ✅ Real-time progress monitoring of running agent sessions

### VS Code Extension Enhancements
- ✅ WebSocket server API for bidirectional mobile communication
- ✅ Chat participant API for programmatic agent session control
- ✅ Session tracker for active Copilot sessions (state, progress, events)
- ✅ Event emission system for push notifications to mobile
- ✅ Client registry with heartbeat management

### Cloud Infrastructure
- ✅ Cloud relay service for secure cross-network communication
- ✅ GitHub OAuth authentication flow
- ✅ Message routing and offline buffering
- ✅ GitHub Actions workflow support for cloud-based agent runs

### Distribution & Quality
- ✅ Extension packaged and published via GitHub Actions on push
- ✅ Mobile PWA deployed to GitHub Pages
- ✅ Comprehensive documentation (setup, security, API reference)
- ✅ Security audit passing (auth, command allowlisting, rate limiting)

---

## Context Loaded

### Existing Files (Source of Truth)
- `RannIA/package.json` - Extension manifest, dependencies, activation events
- `RannIA/src/extension.ts` - Extension entry point and lifecycle
- `RannIA/src/types.ts` - Shared TypeScript types and interfaces
- `.github/copilot-instructions.md` - Project conventions and agent delegation patterns

### New Components (To Be Created)
- `RannIA/src/websocket/` - WebSocket server implementation
- `RannIA/src/chat/` - Chat participant API for agent control
- `RannIA/src/session/` - Session tracking and event emission
- `mobile-companion/` - React PWA application
- `cloud-relay/` - Azure SignalR or Node.js relay service
- `.github/workflows/extension-publish.yml` - CI/CD for extension packaging

---

## Architectural Decisions

### 1. Mobile Technology Stack
**Decision**: PWA-first approach using React + TypeScript, with optional Capacitor wrapper for native features later

**Rationale**:
- Zero friction distribution via URL (no app store approvals)
- Single codebase for iOS, Android, desktop browsers
- Service Workers enable offline support and push notifications
- Capacitor provides escape hatch for native APIs if needed (biometrics, filesystem)
- React ecosystem mature for this use case

**Trade-offs**: Limited native integration initially, but acceptable for v1

---

### 2. Cloud Relay Architecture
**Decision**: Azure SignalR Service (lightweight Node.js fallback if budget constrained)

**Rationale**:
- WebSocket state management handled by Azure (auto-scaling, reconnection)
- Global edge presence reduces latency
- Built-in authentication and message routing
- Falls back gracefully to long-polling
- Node.js alternative keeps costs near-zero for small scale

**Trade-offs**: Azure dependency vs. self-hosted complexity

---

### 3. Authentication Model
**Decision**: GitHub OAuth App (shared secret across extension + mobile)

**Rationale**:
- Single identity provider (users already have GitHub accounts)
- GitHub Pro entitlements automatically available (API quotas, Models access)
- Trusted OAuth flow (no custom credential storage)
- JWT tokens for stateless relay authentication

**Trade-offs**: Requires GitHub account, but acceptable given target audience

---

### 4. Permission Interception Strategy
**Decision**: Custom confirmation tools wrapping sensitive operations (file edits, terminal commands)

**Rationale**:
- Copilot currently lacks native permission hook API
- Middleware pattern allows remote approval flow
- Can degrade gracefully to notification-only mode if approval times out
- Provides audit trail for automated actions

**Trade-offs**: Requires discipline to wrap all sensitive operations

---

### 5. Agent Session Control
**Decision**: Chat Participant API + file-based logging for session state

**Rationale**:
- Chat Participant API is the programmatic entry point for Copilot agents
- File-based logs provide durable session state (survives extension restart)
- WebSocket events provide real-time updates (complement file logs)
- `.instructions-output/sessions/` directory for session artifacts

**Trade-offs**: No official session management API, so custom tracking required

---

## Task Graph

### Phase 1: Extension Core Upgrade (Foundation)
**Purpose**: Establish programmatic control surface for mobile integration

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000395 | Add WebSocket server to extension (JWT auth, command protocol) | None | Pending |
| task-000396 | Create chat participant API for programmatic agent sessions | None | Pending |
| task-000397 | Implement session tracker for active Copilot sessions | task-000396 | Pending |
| task-000398 | Add event emission system for push notifications | task-000395 | Pending |
| task-000399 | Build client registry with heartbeat management | task-000395 | Pending |

**Blockers**: Phase 2 and Phase 3 cannot start until Phase 1 completes (mobile needs extension API)

---

### Phase 2: Cloud Relay Infrastructure
**Purpose**: Enable cross-network communication between mobile and extension

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000400 | Design relay protocol (message schema, auth, events) | task-000395 | Pending |
| task-000401 | Implement cloud relay service (Azure SignalR or Node.js) | task-000400 | Pending |
| task-000402 | Add GitHub OAuth flow for authentication | None | Pending |
| task-000403 | Create connection broker for message routing | task-000401, task-000402 | Pending |
| task-000404 | Implement offline message queue/buffer | task-000401 | Pending |

**Blockers**: Phase 3 cannot start until Phase 2 completes (mobile needs relay for cross-network)

---

### Phase 3: Mobile App (PWA/React)
**Purpose**: Build user-facing mobile interface for session management

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000405 | Create app shell and navigation (Dashboard, Sessions, Ideas, AI Chat, Settings) | Phase 1, Phase 2 | Pending |
| task-000406 | Build client management view (list VS Code instances + status) | task-000405, task-000399 | Pending |
| task-000407 | Build session control panel (start/stop/monitor agents) | task-000405, task-000397 | Pending |
| task-000408 | Create idea drafting system with tagging | task-000405 | Pending |
| task-000409 | Build agent configuration UI (agent selection, parameters) | task-000407 | Pending |
| task-000410 | Implement permission request handler | task-000407, task-000398 | Pending |
| task-000411 | Create AI chat interface (GitHub Models API) | task-000405, task-000402 | Pending |

**Parallelization**: Within Phase 3, tasks 000406-000411 can be parallelized after task-000405 completes

---

### Phase 4: GitHub Cloud Integration
**Purpose**: Enable cloud-based agent runs via GitHub Actions and Codespaces

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000412 | Create workflow dispatch endpoint for remote triggers | task-000402 | Pending |
| task-000413 | Add Codespaces integration for cloud agent runs | task-000412 | Pending |
| task-000414 | Implement artifact sync to repo/relay | task-000403, task-000413 | Pending |
| task-000415 | Add webhook receiver for workflow notifications | task-000412, task-000398 | Pending |

**Parallelization**: Phase 4 can run in parallel with Phase 3 (independent workstreams)

---

### Phase 5: Enhanced Features
**Purpose**: Polish user experience with quality-of-life improvements

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000416 | Build reminders system for unprogressed ideas | task-000408 | Pending |
| task-000417 | Implement learning mode with checkpoints/recaps | task-000411 | Pending |
| task-000418 | Add queue management (prioritize, reorder, batch) | task-000407 | Pending |
| task-000419 | Implement offline support with local storage | task-000405, task-000404 | Pending |
| task-000420 | Optional news feed integration | task-000405 | Pending |

**Optional**: Phase 5 tasks are incremental enhancements, can be deferred if needed

---

### Phase 6: Distribution & Polish
**Purpose**: Package, publish, and document the complete ecosystem

| Task ID | Description | Dependencies | Status |
|---------|-------------|--------------|--------|
| task-000421 | GitHub Actions CI/CD for extension build/package | Phase 1 complete | Pending |
| task-000422 | Extension marketplace prep (package, release artifacts) | task-000421 | Pending |
| task-000423 | Mobile app deployment (GitHub Pages PWA + optional Capacitor) | Phase 3 complete | Pending |
| task-000424 | Documentation (setup guide, security model, API reference) | All phases | Pending |

**Timing**: Phase 6 should run after core functionality is stable (Phases 1-3 complete)

---

## Execution Notes for Subagents

### General Workflow
1. **Task Assignment**: Each task file (`.instructions/tasks/task-NNNNNN.md`) contains detailed requirements, acceptance criteria, and technical references
2. **Context Loading**: Always read task file + related context files (package.json, extension.ts, types.ts) before starting
3. **Incremental Progress**: Commit frequently with descriptive messages; update task status in metadata
4. **Testing**: Write unit tests alongside implementation; integration tests after phase completes
5. **Documentation**: Update inline comments and API docs as you code; defer comprehensive docs to task-000424

### Phase-Specific Guidance

#### Phase 1 (Extension Core)
- **Target Agents**: `@feature-creator`, `@csharp-expert` (if TypeScript parallels needed)
- **Key Principles**: Minimal API surface, strong typing, graceful degradation
- **Testing**: Mock WebSocket clients, simulate chat participant invocations
- **Files to Modify**: Mostly new files under `src/websocket/`, `src/chat/`, `src/session/`

#### Phase 2 (Cloud Relay)
- **Target Agents**: `@feature-creator`, `@deployment-compose` (if Node.js self-hosted)
- **Key Principles**: Stateless message routing, retry logic, secure by default
- **Testing**: Load testing for concurrent connections, chaos testing for network failures
- **New Repos/Folders**: Likely separate `cloud-relay/` directory or new repo

#### Phase 3 (Mobile App)
- **Target Agents**: `@frontend`, `@react-query` (for data fetching)
- **Key Principles**: Responsive design, optimistic UI, offline-first
- **Testing**: Component tests (React Testing Library), E2E (Playwright)
- **New Repo/Folder**: `mobile-companion/` React app with standard create-react-app or Vite structure

#### Phase 4 (GitHub Integration)
- **Target Agents**: `@feature-creator`, `@deployment-compose`
- **Key Principles**: Idempotent workflows, webhook security (HMAC verification)
- **Testing**: Workflow dry-runs, mock webhook payloads
- **Files to Create**: `.github/workflows/agent-dispatch.yml`, webhook handler endpoint

#### Phase 5 (Enhancements)
- **Target Agents**: `@frontend`, `@feature-creator`
- **Key Principles**: Non-blocking (can fail gracefully), user-configurable
- **Testing**: Feature flags for gradual rollout
- **Files to Modify**: Iterative additions to Phase 3 mobile app

#### Phase 6 (Distribution)
- **Target Agents**: `@docs`, `@deployment-compose`
- **Key Principles**: Reproducible builds, semantic versioning, changelog discipline
- **Testing**: Install extension from VSIX locally, test PWA on real mobile device
- **Files to Create**: CI/CD workflows, README, SECURITY.md, API_REFERENCE.md

---

## Risks & Rollback Strategies

| Risk | Likelihood | Impact | Mitigation | Rollback Plan |
|------|------------|--------|------------|---------------|
| **Copilot has no permission hook API** | High | Medium | Build custom confirmation tools wrapping sensitive operations (file edits, terminal commands). Prompt user to approve via mobile before executing. | Degrade to notification-only mode (inform user of actions taken, no blocking approval). Extension still useful for monitoring. |
| **Network latency (mobile ↔ relay ↔ extension)** | Medium | Low | Optimistic UI updates on mobile (assume success), eventual consistency with WebSocket events. Display "pending" states. | Accept ~1-2 second delay as baseline; use caching and batching to reduce round-trips. |
| **Security: remote command execution** | Medium | High | JWT authentication, allowlisted commands only (no arbitrary code execution), rate limiting per user, audit logging. | Switch to view-only mode (disable start/stop controls, show read-only status). |
| **GitHub API rate limits** | Medium | Medium | Aggressive caching (store responses in IndexedDB), exponential backoff, display rate limit status to user. | Queue operations locally, batch sync on rate limit reset. Degrade AI chat to lower frequency. |
| **VS Code Tunnels no programmatic API** | High | Medium | Custom WebSocket relay bypasses need for Tunnels API. Fallback to local network discovery (LAN). | Hybrid mode: local network when available (fast), cloud relay for cross-network (slower but works anywhere). |
| **Extension marketplace review delays** | Medium | Low | Submit early, maintain clean code review checklist, use pre-release channel for testing. | Distribute VSIX directly via GitHub Releases while awaiting approval. |
| **Mobile offline support complexity** | Low | Medium | Service Workers + IndexedDB for offline queue. Sync when network returns. | Require online connection for v1; defer offline support to Phase 5. |

---

## Validation & Testing

### Unit Testing
- **Extension**: Jest/Mocha for WebSocket server, chat participant, session tracker
- **Relay**: Jest for message routing, auth middleware, queue logic
- **Mobile**: Vitest + React Testing Library for components, hooks

### Integration Testing
- **Relay ↔ Extension**: Simulate WebSocket handshake, command round-trips, event push
- **Mobile ↔ Relay**: Test GitHub OAuth flow, message routing, offline buffering
- **GitHub ↔ Relay**: Webhook delivery, workflow dispatch triggers

### End-to-End Testing
- **Primary Flow**: Mobile app → start agent session → relay routes to extension → agent executes → extension emits events → mobile displays progress
- **Permission Flow**: Agent requests file edit → extension pushes to mobile → user approves → extension proceeds
- **Offline Recovery**: Mobile loses connection → queues commands → reconnects → commands execute

### Security Audit Checklist
- [ ] JWT tokens use strong secrets (env vars, not hardcoded)
- [ ] Command allowlist enforced on extension (no eval, no arbitrary shell)
- [ ] Rate limiting per user (max N commands/minute)
- [ ] GitHub OAuth redirect URIs locked to production domains
- [ ] HTTPS enforced for all relay communication
- [ ] Webhook HMAC signatures verified
- [ ] User permissions validated on every command
- [ ] Audit log for all remote-triggered actions

### Performance Benchmarks
- WebSocket round-trip latency: < 500ms (p95)
- Agent session start time: < 3 seconds
- Mobile app cold start: < 2 seconds
- Relay can handle 1000+ concurrent connections

---

## Cross-Session Context Anchors

### Key Invariants (Do Not Violate)
1. **Extension remains optional**: Core Instruction Engine workflows must work without mobile companion
2. **No state corruption**: If relay goes down, extension continues working locally
3. **User consent**: Never execute destructive operations without explicit approval (local or remote)
4. **Backwards compatibility**: Existing extension users unaffected by new WebSocket/chat features

### When Resuming Work
1. Check task status in `.instructions/tasks/task-NNNNNN.md` files
2. Review decisions in this artefact (especially if considering deviations)
3. Check `.instructions/contexts/project.memory.md` for any new gotchas discovered during implementation
4. Run `get_errors` to validate current state before proceeding

### When Pivoting Design
1. Update **Architectural Decisions** section in this artefact
2. Create ADR file under `.instructions/contexts/decisions/` if change is significant
3. Notify in task file comments which decisions were revised and why

---

## Success Metrics (Post-Launch)

- **Adoption**: 50+ active users within 3 months
- **Stability**: < 1% crash rate on mobile, < 5% failed command executions
- **Performance**: 95% of commands complete within 5 seconds
- **Engagement**: 20% of users use mobile app weekly

---

## Future Enhancements (Out of Scope for v1)

- Voice input for mobile idea capture
- Multi-user collaboration (shared session viewing)
- Desktop PWA install (not just mobile)
- Native mobile apps via Capacitor (biometric auth, native notifications)
- Agent marketplace (discover/install new agents from mobile)
- Analytics dashboard (session duration, most-used agents, idea→task conversion rate)

---

**Last Updated**: 2026-02-01  
**Next Review**: After Phase 1 completion (re-validate feasibility of Phases 2-6)
