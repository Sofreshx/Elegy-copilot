---
id: task-000016
title: "Extension Enhancement - Audit View"
status: done
priority: medium
owner: agent
depends_on: ["task-000008", "task-000009", "task-000010", "task-000011", "task-000012", "task-000013", "task-000014", "task-000015"]
skills: []
created: 2026-01-31
updated: 2026-01-31
---

# task-000016: Extension Enhancement - Audit View

## Summary
Add audit results view to the VS Code extension with stats display and one-click audit triggering.

## Acceptance Criteria
- [x] New file `vscode-skill-installer/src/auditTree.ts`
- [x] Update `extension.ts` to register audit view
- [x] Update `package.json` with new view, commands, settings
- [x] Audit Results tree view with pass/warn/fail badges
- [x] "Run Audit" command with type selection dropdown
- [x] Stats display: coverage %, security issues, drift items
- [x] Settings: `skillInstaller.audit.autoStack`, `skillInstaller.audit.e2eMode`

## Implementation Notes
- Follow existing tree provider patterns (`tree.ts`, `tasksTree.ts`)
- Parse audit reports from `.instructions-output/`
- Use report schema from task-000015
- Commands: `skillInstaller.runAudit`, `skillInstaller.refreshAudit`
- Icons for pass (✓), warn (⚠), fail (✗)

## Completion Log

### Implementation Summary
Created [auditTree.ts](vscode-skill-installer/src/auditTree.ts):
- `AuditTreeProvider` class following existing tree patterns
- Scans `.instructions-output/` for 5 audit types: deploy, stack, test, e2e, security
- Parses YAML front matter for stats (pass/warn/fail)
- Shows overall status icons per repo and per audit
- Expandable stats nodes showing pass/warn/fail counts

Updated [extension.ts](vscode-skill-installer/src/extension.ts):
- Registered `AuditTreeProvider` for `skillInstaller.auditView`
- Added `skillInstaller.runAudit` command with QuickPick for audit types
- Added `skillInstaller.refreshAudit` command
- Added `auditProvider.invalidateCache()` to global refresh

Updated [package.json](vscode-skill-installer/package.json):
- Added view: `skillInstaller.auditView` with name "Audit Results"
- Added activation events for `onView:skillInstaller.auditView`
- Added commands: `skillInstaller.runAudit`, `skillInstaller.refreshAudit`
- Added settings: `skillInstaller.audit.autoStack` (boolean), `skillInstaller.audit.e2eMode` (enum)
- Added view/title menus with play and refresh icons

Updated [types.ts](vscode-skill-installer/src/types.ts):
- Added `AuditType`, `AuditStats`, `AuditReport` interfaces

### Validation
- TypeScript compilation: ✓ No errors
