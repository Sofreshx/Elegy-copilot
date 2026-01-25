---
schema: task/v1
id: task-000064
title: "Add export functionality: CSV/JSON for markets, strategies, AI sessions, trades"
type: feature
status: done
priority: low
owner: "dylan"
skills: ["feature-creator", "design", "react-query", "testing-frontend-unit", "docs"]
depends_on: []
next_tasks: []
created: "2026-01-20"
updated: "2026-01-20"
---

## Context

We want a small, user-facing export capability to allow users to export key data entities (markets, strategies, AI sessions, trades) in CSV and JSON formats for analysis, backup, debugging, and accounting.

Common use cases:
- Export market data for external analysis (CSV)
- Export strategy definitions for backup/sharing (JSON)
- Export AI session traces for debugging (CSV/JSON)
- Export trade history for accounting (CSV)

**Notes:** Project conventions prefer server-side exports for large datasets and client-side for small/paged datasets. Follow existing patterns for file download and feature flags.

## Acceptance Criteria

- [ ] Export buttons present on list pages: Markets, Strategies, AI Sessions, Trades
- [ ] CSV export produces correctly formatted CSV (commas, quoting, dates)
- [ ] JSON export includes requested fields and metadata (exportedAt)
- [ ] Date range filtering works for time-series entities (sessions, trades)
- [ ] Field selection works (user can include/exclude columns)
- [ ] Filename customization used for downloaded file
- [ ] Large exports use server-side pagination/export endpoints or chunked download to avoid crashing the browser
- [ ] Tests exist for CSV generation, JSON export shape, and UI interactions (modal, file naming)

## Plan / Approach

1. UI: Add an `ExportButton.razor` (reusable) and `ExportOptionsModal.razor` to configure:
   - Format (CSV / JSON)
   - Fields (checkbox list)
   - Date range (from / to)
   - Include related data toggle (e.g., signals)
   - Filename input

2. Client service: `ExportService.cs` (client-side) — provides helpers to:
   - Convert JSON arrays to CSV with column ordering/escaping
   - Trigger browser downloads with correct MIME type and filename
   - For small/paged sets, generate in-browser

3. Server endpoints (preferred for large exports): add endpoints such as:
   - `GET /markets/export?format=csv&fields=id,question,volume&from=&to=`
   - `GET /strategies/export?format=json`
   - `GET /ai/sessions/export?format=csv&from=2026-01-01&to=`
   - `GET /trades/proposals/export?format=csv`
   Implement streaming or paged exports to avoid memory pressure.

4. Client-side alternative: for small datasets, reuse list APIs and convert to CSV/JSON in the browser using `ExportService`.

5. UI placement: follow T3 navigation and anchor export controls near list actions (T3 required). Per-entity pages should include export triggers in action bars.

6. Tests:
   - Unit tests for CSV generation and filename logic
   - Component tests for `ExportOptionsModal` (field selection, date filter)
   - Integration/E2E tests for export happy path (download triggered, correct filename)

7. Docs: Add short docs in `docs/` describing available export endpoints, formats, and usage examples. Add a short note in the UI README.

## Data Format Examples

**Markets CSV**

MarketId,Question,Active,Closed,Volume,Liquidity,EndDate,LastUpdated
0x123...,Will X happen?,true,false,50000,12000,2026-03-01,2026-01-20

**Strategies JSON**

{
  "exportedAt": "2026-01-20T12:00:00Z",
  "strategies": [
    {
      "id": "guid",
      "name": "My Strategy",
      "version": 3,
      "lifecycleState": "Active",
      "definition": { /* ... */ }
    }
  ]
}

## UI Components

- `ExportButton.razor` - Reusable export trigger
- `ExportOptionsModal.razor` - Configuration dialog
- `ExportService.cs` (client-side) - CSV/JSON generation and download helpers

## Acceptance / UX Notes

- Default file name pattern: `{entity}-{YYYYMMDD}-{short-id}.{csv|json}`
- For large data sets, provide a server-side job with an email or notification when ready (future improvement)
- Include a concise help tooltip describing size limits for client-side export vs. server-side

## Dependencies

- T3 (Navigation for consistent placement)
- T4, T5, T6 (specific pages where export button will be added)

## Next Steps

1. Decide whether to implement server-side endpoints now or start with client-side for MVP.
2. Implement `ExportButton` + `ExportOptionsModal` on Markets list (small scoped PR). ✅
3. Add `ExportService` and unit tests for CSV/JSON generation.
4. If required, add server-side `export` endpoints with streaming/paging and update client to call them.
5. Add E2E test: export file triggers and downloaded file content matches expectations.

## Suggested Adjacent Tasks
- Add tests task under `.instructions/test-tasks/` for export unit/integration/e2e
- Add docs entry to `docs/` describing export endpoints and limitations

---

**Notes:** Priority: LOW (nice-to-have). File created per request and is ready to be assigned.
