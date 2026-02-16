# Remote Control Messaging Gateway (Discord-first) — Plan Artefact Index

## Active Plan

| Field | Value |
|-------|-------|
| Plan | Remote Control Messaging Gateway (Discord-first) |
| Artefact | [remote-control-messaging-gateway-PLAN-artefact.md](remote-control-messaging-gateway-PLAN-artefact.md) |
| Progress | [x-TASK-PROGRESS.md](x-TASK-PROGRESS.md) |
| Total Tasks | 26 |
| Groups | 5 |
| MVP | Groups 1 + 2 (tasks rcmg-001 through rcmg-015) |
| Status | `in-progress` |

## Goal + Success Criteria

Replace the mobile/relay approach with a **local-first Messaging Gateway** that lets you create, queue, and execute agent requests from Discord (first) with full session tracking, permission approvals, plan visibility, and security hardening — all running locally on the desktop with VS Code as the execution hub.

See the [full plan artefact](remote-control-messaging-gateway-PLAN-artefact.md) for architecture, security model, decisions, and detailed work breakdown.

## Context Loaded

- `.instructions/artefacts/remote-control-messaging-gateway-PLAN-artefact.md` (full plan)
- `vscode-skill-installer/src/wsServer.ts` (extension WS server)
- `vscode-skill-installer/src/extension.ts` (extension entry)
- `vscode-skill-installer/scripts/e3-cli.js` (E3 CLI)
- `.instructions/artefacts/relay-protocol.md` (legacy relay protocol reference)

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Local-first gateway (no cloud relay) | Desktop process connects directly to extension WS + reads E3 DB locally. No NAT/firewall issues. |
| D2 | Discord first, platform-agnostic core | `MessagePlatform` interface decouples core from any messaging SDK. Telegram addable later. |
| D3 | Extension WS when connected, E3 DB when disconnected | Two operating modes: full capabilities (VS Code running) vs read-only + queue (VS Code closed). |
| D4 | Bot token in OS credential store | Never on disk, never in `.env`. Windows Credential Manager or VS Code SecretStorage. |
| D5 | Thread-per-session in Discord | Keeps main channel clean; all streaming output, tool calls, approvals in dedicated thread. |
| D6 | Deprecate relay after gateway proven | Phase 5 disables relay client, archives old packages, shuts down relay.sfrsh.xyz. |

## Task Groups

| Group ID | Title | Order | Depends On | Notes |
|----------|-------|-------|------------|-------|
| `group-01-core-framework` | Core Framework | 1 | — | Foundation: package scaffold + all core modules |
| `group-02-discord-adapter` | Discord Adapter | 2 | `group-01-core-framework` | First messaging surface implementation |
| `group-03-extension-enhancements` | Extension Enhancements | 3 | `group-01-core-framework` | WS methods + session visibility + plan events |
| `group-04-remote-queuing` | Remote Queuing | 4 | Groups 1–3 | E3 queue, general queue, visibility |
| `group-05-deprecation-cleanup` | Deprecation & Cleanup | 5 | Groups 1–2 | Relay disable, archive, shutdown, docs |

### Dependency Graph

```
group-01-core-framework ──► group-02-discord-adapter ──► group-05-deprecation-cleanup
                        ──► group-03-extension-enhancements ──► group-04-remote-queuing
                                                           ──► group-04-remote-queuing
```

## Task Graph

| Group | Task ID | Title | Depends On | Next Tasks |
|-------|---------|-------|------------|------------|
| `group-01-core-framework` | `rcmg-001` | Create companion/ package scaffold | — | `rcmg-002` thru `rcmg-010` |
| `group-01-core-framework` | `rcmg-002` | Define MessagePlatform interface + types | `rcmg-001` | `rcmg-007`, `rcmg-010`, `rcmg-011` |
| `group-01-core-framework` | `rcmg-003` | Implement ExtensionBridge | `rcmg-001` | `rcmg-013`, `rcmg-014`, `rcmg-016`, `rcmg-017`, `rcmg-019`, `rcmg-021` |
| `group-01-core-framework` | `rcmg-004` | Implement E3Monitor | `rcmg-001` | `rcmg-018`, `rcmg-020` |
| `group-01-core-framework` | `rcmg-005` | Implement ArtefactsMonitor | `rcmg-001` | — |
| `group-01-core-framework` | `rcmg-006` | Implement GitMonitor | `rcmg-001` | — |
| `group-01-core-framework` | `rcmg-007` | Implement CommandRouter | `rcmg-001`, `rcmg-002` | `rcmg-011` |
| `group-01-core-framework` | `rcmg-008` | Implement Sanitizer | `rcmg-001` | — |
| `group-01-core-framework` | `rcmg-009` | Implement AuditLogger | `rcmg-001` | — |
| `group-01-core-framework` | `rcmg-010` | Implement OutputFormatter | `rcmg-002` | `rcmg-015` |
| `group-02-discord-adapter` | `rcmg-011` | Implement DiscordPlatform adapter | `rcmg-002`, `rcmg-007` | `rcmg-012`, `rcmg-013`, `rcmg-014`, `rcmg-015`, `rcmg-023`, `rcmg-026` |
| `group-02-discord-adapter` | `rcmg-012` | Discord slash commands | `rcmg-011` | `rcmg-020`, `rcmg-021` |
| `group-02-discord-adapter` | `rcmg-013` | Streaming display | `rcmg-011`, `rcmg-003` | `rcmg-023` |
| `group-02-discord-adapter` | `rcmg-014` | Approval flow | `rcmg-011`, `rcmg-003` | `rcmg-023` |
| `group-02-discord-adapter` | `rcmg-015` | Output handling | `rcmg-011`, `rcmg-010` | — |
| `group-03-extension-enhancements` | `rcmg-016` | Add executive3_query WS method | `rcmg-003` | — |
| `group-03-extension-enhancements` | `rcmg-017` | Add get_workspace_info WS method | `rcmg-003` | — |
| `group-03-extension-enhancements` | `rcmg-018` | Bridge session visibility gap | `rcmg-004` | — |
| `group-03-extension-enhancements` | `rcmg-019` | Add plan lifecycle events | `rcmg-003` | — |
| `group-04-remote-queuing` | `rcmg-020` | E3 queue via CLI | `rcmg-004`, `rcmg-012` | `rcmg-022` |
| `group-04-remote-queuing` | `rcmg-021` | General request queue | `rcmg-003`, `rcmg-012` | `rcmg-022` |
| `group-04-remote-queuing` | `rcmg-022` | Queue visibility commands | `rcmg-020`, `rcmg-021` | — |
| `group-05-deprecation-cleanup` | `rcmg-023` | Disable relay client | `rcmg-011`, `rcmg-013`, `rcmg-014` | `rcmg-024` |
| `group-05-deprecation-cleanup` | `rcmg-024` | Archive old packages | `rcmg-023` | `rcmg-025` |
| `group-05-deprecation-cleanup` | `rcmg-025` | Shut down relay.sfrsh.xyz | `rcmg-024` | — |
| `group-05-deprecation-cleanup` | `rcmg-026` | Update docs and README | `rcmg-011` | — |

## Task Index

| Group | Task ID | Title | Task File |
|-------|---------|-------|-----------|
| `group-01-core-framework` | `rcmg-001` | Create companion/ package scaffold | `.instructions/tasks/rcmg-001.md` |
| `group-01-core-framework` | `rcmg-002` | Define MessagePlatform interface + types | `.instructions/tasks/rcmg-002.md` |
| `group-01-core-framework` | `rcmg-003` | Implement ExtensionBridge | `.instructions/tasks/rcmg-003.md` |
| `group-01-core-framework` | `rcmg-004` | Implement E3Monitor | `.instructions/tasks/rcmg-004.md` |
| `group-01-core-framework` | `rcmg-005` | Implement ArtefactsMonitor | `.instructions/tasks/rcmg-005.md` |
| `group-01-core-framework` | `rcmg-006` | Implement GitMonitor | `.instructions/tasks/rcmg-006.md` |
| `group-01-core-framework` | `rcmg-007` | Implement CommandRouter | `.instructions/tasks/rcmg-007.md` |
| `group-01-core-framework` | `rcmg-008` | Implement Sanitizer | `.instructions/tasks/rcmg-008.md` |
| `group-01-core-framework` | `rcmg-009` | Implement AuditLogger | `.instructions/tasks/rcmg-009.md` |
| `group-01-core-framework` | `rcmg-010` | Implement OutputFormatter | `.instructions/tasks/rcmg-010.md` |
| `group-02-discord-adapter` | `rcmg-011` | Implement DiscordPlatform adapter | `.instructions/tasks/rcmg-011.md` |
| `group-02-discord-adapter` | `rcmg-012` | Discord slash commands | `.instructions/tasks/rcmg-012.md` |
| `group-02-discord-adapter` | `rcmg-013` | Streaming display | `.instructions/tasks/rcmg-013.md` |
| `group-02-discord-adapter` | `rcmg-014` | Approval flow | `.instructions/tasks/rcmg-014.md` |
| `group-02-discord-adapter` | `rcmg-015` | Output handling | `.instructions/tasks/rcmg-015.md` |
| `group-03-extension-enhancements` | `rcmg-016` | Add executive3_query WS method | `.instructions/tasks/rcmg-016.md` |
| `group-03-extension-enhancements` | `rcmg-017` | Add get_workspace_info WS method | `.instructions/tasks/rcmg-017.md` |
| `group-03-extension-enhancements` | `rcmg-018` | Bridge session visibility gap | `.instructions/tasks/rcmg-018.md` |
| `group-03-extension-enhancements` | `rcmg-019` | Add plan lifecycle events | `.instructions/tasks/rcmg-019.md` |
| `group-04-remote-queuing` | `rcmg-020` | E3 queue via CLI | `.instructions/tasks/rcmg-020.md` |
| `group-04-remote-queuing` | `rcmg-021` | General request queue | `.instructions/tasks/rcmg-021.md` |
| `group-04-remote-queuing` | `rcmg-022` | Queue visibility commands | `.instructions/tasks/rcmg-022.md` |
| `group-05-deprecation-cleanup` | `rcmg-023` | Disable relay client | `.instructions/tasks/rcmg-023.md` |
| `group-05-deprecation-cleanup` | `rcmg-024` | Archive old packages | `.instructions/tasks/rcmg-024.md` |
| `group-05-deprecation-cleanup` | `rcmg-025` | Shut down relay.sfrsh.xyz | `.instructions/tasks/rcmg-025.md` |
| `group-05-deprecation-cleanup` | `rcmg-026` | Update docs and README | `.instructions/tasks/rcmg-026.md` |

## Execution Notes

- **Task files are the source of truth** for task-specific context, acceptance criteria, and implementation details. This index provides the big picture and dependency ordering.
- **Group 1 is the foundation** — all other groups depend on it completing first.
- **Groups 2 and 3 can run in parallel** once Group 1 is done.
- **Group 4 depends on Groups 1–3** (needs both the extension enhancements and Discord slash commands).
- **Group 5 only starts after Group 2 proves the gateway works** end-to-end.
- **MVP = Groups 1 + 2** (tasks rcmg-001 through rcmg-015). This covers the complete core framework and Discord adapter for functional remote control.
- Within Group 1, tasks rcmg-002 through rcmg-010 can be parallelized after rcmg-001 (scaffold) completes, respecting individual deps.
- Subagents executing tasks should load the full plan artefact before starting work.

## Risks / Rollback

See [full plan artefact — Risks & Mitigations](remote-control-messaging-gateway-PLAN-artefact.md#risks--mitigations) for the complete risk table.

Key risks: `vscode.chat.sendRequest` API instability (HIGH), E3 DB concurrent access (MEDIUM), Discord bot token leak (MEDIUM).

### Rollback Strategy

- Each group can be reverted independently by reverting its commits.
- The existing relay client remains functional until Phase 5 explicitly disables it.
- No database migrations or irreversible infrastructure changes.

## Validation

See [full plan artefact — Validation Checklist](remote-control-messaging-gateway-PLAN-artefact.md#validation-checklist) for the complete 14-item checklist.

---

## Archived Plans

| Plan | Artefact | Status | Completed |
|------|----------|--------|-----------|
| Relay Ecosystem Audit & Fix | (superseded by gateway plan) | `done` | 2026-02-08 |
