---
schema: task/v1
id: task-000448
title: "Update extension display name and add relay status UI"
type: feature
status: done
priority: low
owner: ""
skills: ["frontend"]
group_id: "group-06-polish"
group_title: "Group 6: Polish"
group_order: 1
depends_on: ["task-000440"]
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The extension's display name still says "Skill Installer" despite its expanded scope. The relay connection status is not visible in the UI.

- Read `vscode-skill-installer/package.json` for current displayName
- Read `vscode-skill-installer/src/operationsConnectionsTree.ts` for connections tree

## Acceptance Criteria
- [x] Display name updated to "Instruction Engine"
- [x] Relay status visible in Operations tree
- [x] `skillInstaller.relayStatus` command works
- [x] README updated

## Plan / Approach

1. Update `displayName` in `package.json` from "Instruction Engine Skill Installer" to "Instruction Engine"
2. Update `description` to remove "Skill Installer" language
3. Add relay connection node to Operations connections tree view
4. Register `skillInstaller.relayStatus` command in package.json
5. Update README.md to reflect expanded scope

## Attempts / Log

### Attempt 1 (2026-02-08) — Success
1. **package.json**: Changed `displayName` from "Instruction Engine Skill Installer" to "Instruction Engine". Added `skillInstaller.relayStatus` command with `$(cloud)` icon and "Instruction Engine" category. Added activation event.
2. **relayClient.ts**: Added `getUserId(): string | null` and `getReconnectInfo(): { attempts: number; maxAttempts: number } | null` public methods.
3. **operationsConnectionsTree.ts**: Added `RelayClient` import. Constructor now accepts optional `relayClient` parameter and subscribes to `onStatusChanged` for auto-refresh. Added "Cloud Relay" section with status, client ID, user ID, reconnect info, and URL children. Status uses color-coded ThemeIcons (green=connected, red=disconnected, orange=reconnecting).
4. **extension.ts**: Hoisted `relayClient` declaration outside the `if (relayEnabled)` block. Pass `relayClient` to `ConnectionsTreeProvider`. Registered `skillInstaller.relayStatus` command showing info message with status/client/user.
5. **README.md**: Updated title to "Instruction Engine". Added Cloud Relay section. Added Relay Status command to table. Added `skillInstaller.relay.*` settings. Updated Mobile Companion section.
6. **Validation**: `npx tsc --noEmit` — zero errors.

## Failures

## Notes / Discoveries

## Next Steps
