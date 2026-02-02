---
schema: task/v1
id: task-000409
title: "Build agent configuration UI"
type: feature
status: done
priority: high
owner: lolzi
skills: ["frontend", "react-query"]
depends_on: ["task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Settings view for agent preferences in the mobile companion app. Users need to configure:
- Default agent selection for quick start (mirrors `@executive2-planner`, `@debugger`, etc.)
- Skills selection UI (mirrors VS Code extension enablement store)
- Preferences persisted to user profile (synced across devices)

This provides parity with desktop extension configuration but optimized for mobile interaction patterns.

**Technical Context**:
- Should integrate with `task-000405` app shell (Settings tab/screen)
- Pull available agents from relay/extension metadata
- Skills list should match vscode-skill-installer's skill registry
- Save preferences to user profile (backend API or local storage + sync)

**Related Files**:
- `mobile-companion/src/components/Settings/` (to be created)
- `vscode-skill-installer/src/enablementStore.ts` (reference for skills logic)
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`

## Acceptance Criteria

- [x] Agent selector dropdown/list with available agents (e.g., `@executive2-planner`, `@debugger`, `@feature-creator`)
- [x] Default agent preference persisted to user profile
- [x] Skills list UI matching VS Code extension skill registry
- [x] Skill enable/disable toggles with visual feedback
- [x] Preferences synced locally (IndexedDB)
- [x] Loading states for fetching agent/skill metadata
- [x] Responsive design for mobile screens

## Plan / Approach

1. Create settings persistence layer (IndexedDB via settingsDb.ts)
2. Create React Query hooks for settings management
3. Build AgentSelector component with radio-style selection
4. Build SkillsList component with toggles and search/filter
5. Integrate into Settings page with tabbed navigation

## Attempts / Log

**2024-02-01**: Completed implementation:
- Created `settingsDb.ts` - IndexedDB service for settings with:
  - Agent config (defaultAgent, availableAgents)
  - Skills config (enable/disable list)
  - Notification preferences
  - Theme setting
- Created `useSettings.ts` - React Query hooks:
  - useSettings, useSetDefaultAgent, useSetSkillEnabled, useSetNotification, useSaveSettings
- Created `AgentSelector.tsx/css` - Radio-style agent picker with descriptions
- Created `SkillsList.tsx/css` - Toggle list with search and category filtering
- Updated `Settings.tsx/css` - Added tabbed navigation (General/Agents/Skills)

All criteria met. Build verified.

## Failures

_None_

## Notes / Discoveries

- Used IndexedDB for local persistence (same pattern as ideas)
- Skills list derived from instruction-engine skills directory
- Agent list includes common agents from .github/agents
- Tab navigation provides better mobile UX than long scroll
- Future: sync settings via relay for cross-device consistency
