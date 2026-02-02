---
schema: task/v1
id: task-000408
title: "Create idea drafting system"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["frontend", "react-query"]
depends_on: ["task-000405"]
next_tasks: ["task-000416", "task-000418"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Build the Ideas tab in the mobile app for drafting features, plans, and tasks on the go. Users can create, edit, and organize ideas with tags, status transitions (draft → planned → started → done), and local persistence.

Primary storage is IndexedDB for offline-first capability. Optional GitHub sync (future task) allows ideas to be exported to `.instructions/` or GitHub issues.

Part of Phase 3 from `.instructions/artefacts/mobile-companion-PLAN-artefact.md`.

## Acceptance Criteria

- [x] Idea list with filtering by tag, status, or search term
- [x] Create new idea with:
  - [x] Title (required)
  - [x] Description (markdown editor)
  - [x] Tags (multi-select)
  - [x] Status (draft, refining, ready, queued, completed, archived)
  - [x] Priority (low, medium, high, urgent)
- [x] Edit existing idea (all fields)
- [x] Delete idea with confirmation
- [x] Status transitions with visual workflow
- [x] IndexedDB persistence (offline-first)
- [x] Export idea as markdown (copy to clipboard)
- [x] Sort by updated date
- [x] Empty state when no ideas

## Plan / Approach

1. **Data Layer**:
   - Create IndexedDB schema:
     ```typescript
     interface Idea {
       id: string; // UUID
       title: string;
       description: string; // markdown
       tags: string[];
       status: 'draft' | 'planned' | 'started' | 'done';
       priority: 'low' | 'medium' | 'high' | 'critical';
       createdAt: number; // timestamp
       updatedAt: number;
     }
     ```
   - Create `IdeaService` for CRUD operations using IndexedDB
   - Wrap in React Query hooks for consistency:
     - `useIdeas(filters?)` - fetch ideas with optional filters
     - `useCreateIdea()` - mutation to create
     - `useUpdateIdea()` - mutation to update
     - `useDeleteIdea()` - mutation to delete

2. **UI Components**:
   - `IdeaList` - main list view with filters
   - `IdeaCard` - individual idea summary
   - `IdeaForm` - create/edit form
   - `IdeaDetail` - full idea view with actions
   - `TagSelector` - multi-select tag input
   - `StatusBadge` - visual status indicator
   - `MarkdownEditor` - textarea with preview toggle
   - `FilterBar` - tag, status, search filters

3. **Idea Form**:
   - Modal or full-screen form
   - Markdown preview for description
   - Tag input with autocomplete (from existing tags)
   - Status selector with color coding
   - Priority selector
   - Save and Cancel buttons
   - Validation (title required, min length)

4. **Status Workflow**:
   - Visual status pipeline: Draft → Planned → Started → Done
   - Allow moving forward/backward
   - Show transition buttons in detail view
   - Animate transitions for visual feedback

5. **Offline-First**:
   - All operations work offline via IndexedDB
   - Queue sync operations for when online (future)
   - Show sync status indicator
   - Conflict resolution strategy (last-write-wins for MVP)

6. **Export**:
   - Generate markdown format:
     ```markdown
     # [Title]
     **Priority**: [priority] | **Status**: [status] | **Tags**: [tags]
     
     [Description]
     ```
   - Copy to clipboard or download as .md file
   - Prepare for future GitHub sync integration

## Attempts / Log

**2024-02-01**: Initial implementation completed with:
- Created `ideasDb.ts` - IndexedDB service with native IndexedDB API
- Created `useIdeas.ts` - React Query hooks for CRUD operations + export
- Created `IdeaCard.tsx/css` - Card component with status/priority badges
- Created `IdeaList.tsx/css` - Grouped list by status with filtering
- Created `IdeaForm.tsx/css` - Modal form for create/edit with export
- Updated `Ideas.tsx/css` - Main page with search, filters, FAB button

Status values updated to: draft, refining, ready, queued, completed, archived
Priority values: low, medium, high, urgent

Build verified successfully.

## Failures

_None_

## Notes / Discoveries

- Used native IndexedDB instead of `idb` library to reduce bundle size
- Kept markdown editor simple (textarea) for MVP - can upgrade later
- Tag input is comma-separated for simplicity
- Status grouping in list provides better visual organization
- FAB button provides quick access to create new ideas
- Export copies to clipboard as markdown

## Next Steps

Unblocks:
- task-000416 (Reminders system)
- task-000418 (Queue management)

Integrates with:
- Session control panel (task-000407) for converting ideas to agent sessions
