# Remote Control Messaging Gateway — Task Progress Tracker

## Session Metadata

| Field | Value |
|-------|-------|
| Session ID | `rcmg-session-001` |
| Date | 2026-02-16 |
| Owner | executive2 |
| Plan Artefact | [remote-control-messaging-gateway-PLAN-artefact.md](remote-control-messaging-gateway-PLAN-artefact.md) |
| Plan Index | [x-PLAN-artefact.md](x-PLAN-artefact.md) |
| Total Tasks | 26 |
| Groups | 5 |
| MVP | Groups 1 + 2 (rcmg-001 through rcmg-015) |

## Task Groups Overview

| Group | Title | Status | Depends On |
|-------|-------|--------|------------|
| `group-01-core-framework` | Core Framework | `not-started` | — |
| `group-02-discord-adapter` | Discord Adapter | `not-started` | `group-01-core-framework` |
| `group-03-extension-enhancements` | Extension Enhancements | `not-started` | `group-01-core-framework` |
| `group-04-remote-queuing` | Remote Queuing | `not-started` | Groups 1–3 |
| `group-05-deprecation-cleanup` | Deprecation & Cleanup | `not-started` | Groups 1–2 |

## Task Status Table

| Group | Task ID | Status | Next Task | Notes |
|-------|---------|--------|-----------|-------|
| `group-01-core-framework` | `rcmg-001` | `not-started` | `rcmg-002` thru `rcmg-010` | **Next up.** Create companion/ package scaffold |
| `group-01-core-framework` | `rcmg-002` | `not-started` | `rcmg-007`, `rcmg-010` | Define MessagePlatform interface + types |
| `group-01-core-framework` | `rcmg-003` | `not-started` | `rcmg-013`, `rcmg-014`, `rcmg-016` | Implement ExtensionBridge |
| `group-01-core-framework` | `rcmg-004` | `not-started` | `rcmg-018`, `rcmg-020` | Implement E3Monitor |
| `group-01-core-framework` | `rcmg-005` | `not-started` | — | Implement ArtefactsMonitor |
| `group-01-core-framework` | `rcmg-006` | `not-started` | — | Implement GitMonitor |
| `group-01-core-framework` | `rcmg-007` | `not-started` | `rcmg-011` | Implement CommandRouter |
| `group-01-core-framework` | `rcmg-008` | `not-started` | — | Implement Sanitizer |
| `group-01-core-framework` | `rcmg-009` | `not-started` | — | Implement AuditLogger |
| `group-01-core-framework` | `rcmg-010` | `not-started` | `rcmg-015` | Implement OutputFormatter |
| `group-02-discord-adapter` | `rcmg-011` | `not-started` | `rcmg-012`, `rcmg-013`, `rcmg-014`, `rcmg-015` | Implement DiscordPlatform adapter |
| `group-02-discord-adapter` | `rcmg-012` | `not-started` | `rcmg-020`, `rcmg-021` | Discord slash commands |
| `group-02-discord-adapter` | `rcmg-013` | `not-started` | `rcmg-023` | Streaming display |
| `group-02-discord-adapter` | `rcmg-014` | `not-started` | `rcmg-023` | Approval flow |
| `group-02-discord-adapter` | `rcmg-015` | `not-started` | — | Output handling |
| `group-03-extension-enhancements` | `rcmg-016` | `not-started` | — | Add executive3_query WS method |
| `group-03-extension-enhancements` | `rcmg-017` | `not-started` | — | Add get_workspace_info WS method |
| `group-03-extension-enhancements` | `rcmg-018` | `not-started` | — | Bridge session visibility gap |
| `group-03-extension-enhancements` | `rcmg-019` | `not-started` | — | Add plan lifecycle events |
| `group-04-remote-queuing` | `rcmg-020` | `not-started` | `rcmg-022` | E3 queue via CLI |
| `group-04-remote-queuing` | `rcmg-021` | `not-started` | `rcmg-022` | General request queue |
| `group-04-remote-queuing` | `rcmg-022` | `not-started` | — | Queue visibility commands |
| `group-05-deprecation-cleanup` | `rcmg-023` | `not-started` | `rcmg-024` | Disable relay client |
| `group-05-deprecation-cleanup` | `rcmg-024` | `not-started` | `rcmg-025` | Archive old packages |
| `group-05-deprecation-cleanup` | `rcmg-025` | `not-started` | — | Shut down relay.sfrsh.xyz |
| `group-05-deprecation-cleanup` | `rcmg-026` | `not-started` | — | Update docs and README |

## Checkpoints

| Group | Checkpoint | Trigger | Notes |
|-------|------------|---------|-------|
| `group-01-core-framework` | `unit-test-runner` | After `rcmg-010` completes (group done) | Run unit tests on companion/ package. Verify all core modules (ExtensionBridge, E3Monitor, CommandRouter, Sanitizer, etc.) pass. |
| `group-02-discord-adapter` | `unit-test-runner` | After `rcmg-015` completes (group done) | Run unit tests on Discord adapter. Verify DiscordPlatform, slash commands, streaming, approval flow, output handling. |
| `group-03-extension-enhancements` | `unit-test-runner` | After `rcmg-019` completes (group done) | Run unit tests on extension WS method additions (executive3_query, get_workspace_info, plan lifecycle events). |
| `group-04-remote-queuing` | `unit-test-runner` | After `rcmg-022` completes (group done) | Run unit tests on queue modules (E3 queue, general queue, visibility commands). |
| `group-05-deprecation-cleanup` | Manual verification | After `rcmg-026` completes (group done) | Verify: relay client disabled (opt-in only), old packages archived to `_archived/`, relay.sfrsh.xyz shut down, docs + README updated. |
| **Full E2E** | User-confirmed integration test | After all groups complete | End-to-end: Discord → gateway → extension WS → agent session → stream back to Discord. **Ask user before running.** |

## Execution Log

*(No entries yet — execution begins with rcmg-001)*
