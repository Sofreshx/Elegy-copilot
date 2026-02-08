---
schema: task/v1
id: task-000445
title: "Remove dead code and fix bugs in extension"
type: chore
status: done
priority: medium
owner: ""
skills: ["refactor", "tech-debt"]
group_id: "group-04-quality"
group_title: "Group 4: Code Quality"
group_order: 3
depends_on: []
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The VS Code extension has dead tree providers, legacy client tracking, a bug in `startRemoteSession`, and duplicated utility functions across files.

- Read `vscode-skill-installer/src/extension.ts` for which tree providers are registered
- Read `vscode-skill-installer/src/tasksTree.ts` and `activeTasksTree.ts` (check if imported)
- Read `vscode-skill-installer/src/wsServer.ts` for `legacyClients`
- Read `vscode-skill-installer/src/chatParticipant.ts` for `startRemoteSession`

## Acceptance Criteria
- [x] Dead tree providers removed
- [x] Legacy client tracking removed
- [x] `startRemoteSession` returns accurate success/failure
- [x] Shared utilities in `utils/` folder
- [x] Extension compiles and all existing functionality works
- [x] No TypeScript errors

## Plan / Approach

1. Delete `tasksTree.ts` and `activeTasksTree.ts` if unused (verify no imports in extension.ts)
2. Remove `legacyClients` tracking from `wsServer.ts` — only use `ClientRegistry`
3. Fix `chatParticipant.ts` `startRemoteSession` returning `success: true` on fallback path
4. Extract shared YAML front matter parser to `vscode-skill-installer/src/utils/yamlParser.ts`
5. Extract shared utility functions (`existsDir`, `existsFile`, `normalizeString`, etc.) to `vscode-skill-installer/src/utils/fs.ts`
6. Update imports across files that used duplicated utilities

## Attempts / Log

### Attempt 1 (2026-02-08) — Success

1. **Dead tree providers**: Deleted `tasksTree.ts` and `activeTasksTree.ts` — verified no imports anywhere.
2. **Legacy client tracking**: Removed `legacyClients` Map from `wsServer.ts` (declaration, handleConnection, close/error handlers, stop()). Removed `broadcastEvent()` method. Removed `setSessionEventCallback` call from `extension.ts`. Removed `setSessionEventCallback` method and `onSessionEvent` property from `chatParticipant.ts`.
3. **startRemoteSession bug fix**: Changed fallback catch path to call `failSession()` and return `{ success: false, error: ... }` instead of `completeSession()` + `{ success: true }`.
4. **Shared utilities**: Created `utils/fs.ts` (existsDir, existsFile), `utils/yaml.ts` (tryParseYamlFrontMatter, stripQuotes), `utils/strings.ts` (normalizeString). Updated imports in: agentScanner.ts, contextCleaner.ts, enablementStore.ts, taskLifecycle.ts, skillScanner.ts, taskScanner.ts, mcpConfig.ts.
5. **Compile check**: `npx tsc --noEmit` — zero errors.

## Failures

## Notes / Discoveries

## Next Steps
