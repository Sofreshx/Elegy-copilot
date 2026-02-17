# Relay Ecosystem Audit & Fix — Plan Artefact

## Goal + Success Criteria

**Goal**: Fix the broken Mobile Companion ↔ Cloud Relay ↔ VS Code Extension connectivity so all three components connect cleanly end-to-end, enabling developers to control VS Code sessions from mobile devices via the PWA.

**Success Criteria**:
1. Relay mints its own JWTs after GitHub OAuth verification (not raw GH tokens)
2. VS Code extension connects outbound to the cloud relay as a WebSocket client
3. Mobile companion stores relay-minted JWTs and handles token refresh
4. End-to-end message flow works: Mobile → Relay → Extension → Response → Mobile
5. Rate limiting on relay HTTP and WebSocket endpoints
6. Scope enforcement on relay-routed commands
7. CORS restricted to known origins
8. IndexedDB version conflicts resolved in mobile companion
9. Dead code removed from mobile and extension
10. Extension display name updated to "Instruction Engine"
11. Security doc rewritten to reflect actual implementation
12. PWA missing icons added, error boundaries added

## Context Loaded

### Relay (Group 1, 5)
- `cloud-relay/src/auth.ts`
- `cloud-relay/src/relay.ts`
- `cloud-relay/src/types.ts`
- `cloud-relay/src/index.ts`
- `.instructions/artefacts/relay-protocol.md` (Sections 3, 4, 7-8)
- `.instructions/research/relay-architecture-audit.md`

### Extension (Group 2)
- `vscode-skill-installer/src/wsServer.ts`
- `vscode-skill-installer/src/wsAuth.ts`
- `vscode-skill-installer/src/wsTypes.ts`
- `vscode-skill-installer/src/extension.ts`
- `vscode-skill-installer/src/eventEmitter.ts`
- `vscode-skill-installer/package.json`

### Mobile (Group 3)
- `mobile-companion/src/services/authService.ts`
- `mobile-companion/src/context/AuthContext.tsx`
- `mobile-companion/src/services/relayConnection.ts`
- `mobile-companion/src/services/relayApi.ts`

### Quality (Group 4)
- `mobile-companion/src/services/` (all IndexedDB files)
- `vscode-skill-installer/src/tasksTree.ts`
- `vscode-skill-installer/src/activeTasksTree.ts`

### Polish (Group 6)
- `docs/security-model.md`
- `vscode-skill-installer/package.json`
- `mobile-companion/public/manifest.json`

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Extension connects **outbound** to relay as WS client | Standard pattern; works through NAT/firewalls without port forwarding |
| D2 | Stateless JWT refresh tokens (no Redis/database) | Simplifies infrastructure; relay remains stateless and horizontally scalable |
| D3 | `vscode.authentication.getSession('github')` for extension auth | Frictionless — VS Code handles OAuth natively, no second login flow |
| D4 | `localStorage` for token storage in PWA v1 | Acceptable for v1; upgrade to HttpOnly cookies or Web Crypto in v2 |
| D5 | Local WS server kept alongside relay client | Preserves LAN development workflow; relay client is additive |
| D6 | Current relay infra (Docker/Traefik) assumed working | No infrastructure changes needed; deploy is a config update |

## Task Groups

| Group ID | Title | Order | Depends On | Notes |
|----------|-------|-------|------------|-------|
| `group-01-relay-auth` | Relay Auth Fix | 1 | — | **CRITICAL PATH**. Foundation for all auth. |
| `group-02-ext-relay` | Extension Relay Client | 2 | `group-01-relay-auth` | **CRITICAL PATH**. Extension outbound WS. |
| `group-03-mobile-auth` | Mobile Auth & Connection Fix | 3 | `group-01-relay-auth` | Mobile JWT + envelope fixes. |
| `group-04-quality` | Code Quality | 4 | — | Independent. Can run parallel with Group 2. |
| `group-05-security` | Security Hardening | 5 | `group-01-relay-auth` | Rate limiting + scope enforcement. |
| `group-06-polish` | Polish | 6 | Groups 1–5 | Docs, naming, PWA fixes. Runs last. |

### Dependency Graph

```
group-01-relay-auth ──► group-02-ext-relay
                    ──► group-03-mobile-auth
                    ──► group-05-security

group-04-quality    ── independent (parallel with groups 2, 3, 5)

group-06-polish     ──► depends on groups 1–5 complete
```

## Task Graph

| Group | Task ID | Title | Depends On | Next Tasks |
|-------|---------|-------|------------|------------|
| `group-01-relay-auth` | `task-000435` | Create TokenService for relay JWT minting/verification | — | `task-000436` |
| `group-01-relay-auth` | `task-000436` | Rewrite relay auth endpoints to mint relay JWTs | `task-000435` | `task-000437` |
| `group-01-relay-auth` | `task-000437` | Wire TokenService into relay and fix verifyToken | `task-000435`, `task-000436` | `task-000438`, `task-000441`, `task-000446` |
| `group-02-ext-relay` | `task-000438` | Create RelayAuthBridge for extension → relay authentication | `task-000437` | `task-000439` |
| `group-02-ext-relay` | `task-000439` | Create RelayClient outbound WebSocket client | `task-000438` | `task-000440` |
| `group-02-ext-relay` | `task-000440` | Refactor WsServer and wire RelayClient in extension.ts | `task-000439` | `task-000448` |
| `group-03-mobile-auth` | `task-000441` | Fix mobile auth to use relay-minted JWTs | `task-000437` | `task-000442` |
| `group-03-mobile-auth` | `task-000442` | Fix mobile WebSocket connection and envelope wrapping | `task-000441` | `task-000449` |
| `group-04-quality` | `task-000443` | Consolidate mobile IndexedDB to single versioned database | — | `task-000444` |
| `group-04-quality` | `task-000444` | Remove dead code from mobile companion | `task-000443` | `task-000445` |
| `group-04-quality` | `task-000445` | Remove dead code and fix bugs in extension | `task-000444` | — |
| `group-05-security` | `task-000446` | Add rate limiting to relay | `task-000437` | `task-000447` |
| `group-05-security` | `task-000447` | Add scope enforcement and CSRF verification | `task-000446` | `task-000450` |
| `group-06-polish` | `task-000448` | Update extension display name and add relay status UI | `task-000440` | — |
| `group-06-polish` | `task-000449` | Fix mobile PWA: icons, error boundary, install prompt | `task-000442` | — |
| `group-06-polish` | `task-000450` | Rewrite security-model.md for actual v1 architecture | `task-000447` | — |

## Task Index

| Group | Task ID | Title | Task File |
|-------|---------|-------|-----------|
| `group-01-relay-auth` | `task-000435` | Create TokenService for relay JWT minting/verification | `.instructions/tasks/task-000435.md` |
| `group-01-relay-auth` | `task-000436` | Rewrite relay auth endpoints to mint relay JWTs | `.instructions/tasks/task-000436.md` |
| `group-01-relay-auth` | `task-000437` | Wire TokenService into relay and fix verifyToken | `.instructions/tasks/task-000437.md` |
| `group-02-ext-relay` | `task-000438` | Create RelayAuthBridge for extension → relay authentication | `.instructions/tasks/task-000438.md` |
| `group-02-ext-relay` | `task-000439` | Create RelayClient outbound WebSocket client | `.instructions/tasks/task-000439.md` |
| `group-02-ext-relay` | `task-000440` | Refactor WsServer and wire RelayClient in extension.ts | `.instructions/tasks/task-000440.md` |
| `group-03-mobile-auth` | `task-000441` | Fix mobile auth to use relay-minted JWTs | `.instructions/tasks/task-000441.md` |
| `group-03-mobile-auth` | `task-000442` | Fix mobile WebSocket connection and envelope wrapping | `.instructions/tasks/task-000442.md` |
| `group-04-quality` | `task-000443` | Consolidate mobile IndexedDB to single versioned database | `.instructions/tasks/task-000443.md` |
| `group-04-quality` | `task-000444` | Remove dead code from mobile companion | `.instructions/tasks/task-000444.md` |
| `group-04-quality` | `task-000445` | Remove dead code and fix bugs in extension | `.instructions/tasks/task-000445.md` |
| `group-05-security` | `task-000446` | Add rate limiting to relay | `.instructions/tasks/task-000446.md` |
| `group-05-security` | `task-000447` | Add scope enforcement and CSRF verification | `.instructions/tasks/task-000447.md` |
| `group-06-polish` | `task-000448` | Update extension display name and add relay status UI | `.instructions/tasks/task-000448.md` |
| `group-06-polish` | `task-000449` | Fix mobile PWA: icons, error boundary, install prompt | `.instructions/tasks/task-000449.md` |
| `group-06-polish` | `task-000450` | Rewrite security-model.md for actual v1 architecture | `.instructions/tasks/task-000450.md` |

## Execution Notes

- **Task files are the source of truth** for task-specific context, acceptance criteria, and implementation details. This plan provides the big picture and dependency ordering.
- **Group 4 is independent** and can be executed in parallel with Groups 2, 3, and 5 to maximize throughput.
- **Groups 2, 3, and 5 all depend on Group 1** completing first. After Group 1 is done, they can run concurrently.
- **Group 6 is the final pass** and depends on all other groups. It should not start until Groups 1–5 are verified.
- **Subagents** executing tasks should load the group's shared context files before starting any task in that group.
- **Each task within a group is sequential** (enforced by `Depends On` column). Cross-group parallelism is encouraged where dependencies allow.
- When the relay is modified (Groups 1, 5), redeploy and verify the relay is healthy before proceeding to dependent groups.

## Risks / Rollback

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `vscode.chat.sendRequest` is undocumented | `invoke_agent` may not work programmatically | Degrade to notification-only mode; log warning |
| GitHub OAuth App credentials missing on prod relay | 500 on `/auth/callback` | Verify env vars on deploy; fail fast with clear error |
| Multiple VS Code instances need client picker UI | Mobile may route to wrong client | Relay already supports multi-client; mobile can list and select |
| Token refresh race condition (multi-tab) | Double refresh attempt | Stateless JWT refresh tokens eliminate this issue |

### Rollback Strategy

- Each group can be **reverted independently** by reverting its commits.
- The **local WS server remains functional** throughout all changes (fallback for LAN use).
- If relay JWT minting fails, the old raw-token behavior can be restored by **reverting Group 1 only**.
- No database migrations or irreversible infrastructure changes in this plan.

## Validation

| Checkpoint | Validation |
|------------|------------|
| After Group 1 | Relay returns relay-minted JWTs on `/auth/callback`, `/auth/refresh`, and `/auth/exchange` |
| After Group 2 | Extension connects to relay via WS, appears in relay's client list |
| After Group 3 | Mobile login succeeds, connects to relay, can list clients and see the connected extension |
| After Group 4 | No IndexedDB conflicts, dead code removed, test suite passes |
| After Group 5 | Rate-limited requests get `-32003`, unauthorized scope requests get `-32004` |
| Full E2E | Mobile → `invoke_agent` → relay routes → extension handles → session event → relay routes → mobile sees progress |

---

## Review Amendments (Cross-Model Reconciliation)

Both cross-model reviewers (Opus 4.5: 8/10, GPT-5.2 Codex: 78/100) validated the plan as sound. The following amendments incorporate agreed-upon feedback:

### Accepted Amendments

1. **`/auth/exchange` token provenance** (task-000436): Document explicitly that any valid GitHub token grants relay access in v1. This is acceptable because: (a) relay JWTs are short-lived (1h), (b) rate limiting bounds abuse, (c) verifying token provenance (checking if issued to our OAuth app) is not possible with generic GitHub PATs. Mitigation: short access TTL + rate limits. Add explicit v2 note for device attestation.

2. **Stateless token revocation limitation** (task-000450): Document in security doc that `/auth/revoke` is a client-side cleanup endpoint only — stateless JWTs cannot be truly revoked. Access TTL of 1h limits blast radius. v2 could add JTI blocklist with short Redis TTL.

3. **WS Origin validation** (task-000447): Add WebSocket `Origin` header check in the relay's WS upgrade handler alongside the existing HTTP CORS restriction. This closes the gap where HTTP endpoints are CORS-restricted but WS upgrades are not.

4. **RelayClient reconnection safety** (task-000439): Acceptance criteria should explicitly include: (a) `disconnect()` cancels all timers and prevents further reconnects, (b) reconnect loop stops after `maxRetries`, (c) `connect()` is idempotent (calling while connected disconnects first).

5. **Mobile outbound queuing** (task-000442): Queue outbound messages until auth ack arrives and `clientId` is set. Early sends before auth completes would be misrouted.

6. **`routeRequestInternal` context propagation** (task-000440): Pass a `RequestContext` object (containing `userId`, `scopes`, `source: 'local' | 'relay'`) so relay-routed calls can enforce scopes consistently with local calls.

7. **Auth failure UX** (task-000438): If `vscode.authentication.getSession` returns null or throws, `getRelayTokens()` returns null and shows a VS Code notification "GitHub authentication required for relay connection" — no crash, no infinite retry.

8. **Relay-down mobile UX** (task-000449): When relay WebSocket disconnects, show an offline banner with retry timer. When reconnected, dismiss banner and resync state.

### Deferred (Explicitly Out of Scope for v1)

- **Multi-instance client picker UI**: Users with multiple VS Code windows will see all clients in `list_clients` response. The mobile app already has a `ClientList` component. A proper selection UX is v1.1 scope — for v1, routing to user's extensions (any available) is sufficient.
- **Automated E2E test task**: Validate E2E flow manually via checkpoint list above. Automated E2E script is v1.1 scope (depends on relay being deployed and accessible from CI).
- **IndexedDB data migration**: Task-000443 creates stores but doesn't migrate existing data. Acceptable for v1 since the app is pre-release with no production users.
- **Token provenance verification on `/auth/exchange`**: Not feasible with GitHub's token model. Short token TTL + rate limits are sufficient.
