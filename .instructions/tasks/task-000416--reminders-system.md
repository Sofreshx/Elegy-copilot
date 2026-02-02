---
schema: task/v1
id: task-000416
title: "Build reminders system for unprogressed ideas"
type: feature
status: done
priority: low
owner: "lolzi"
skills: ["frontend"]
depends_on: ["task-000408"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Build a reminders system to nudge users for stale/unprogressed ideas. The system should support configurable reminder intervals and push notifications to help users stay on top of their ideas.

## Acceptance Criteria

- [ ] Reminder rules configurable (intervals, criteria for "stale")
- [ ] Push notifications for stale ideas
- [ ] Snooze/dismiss options for reminders
- [ ] Analytics: track progress rate and reminder effectiveness

## Plan / Approach

1. Define data model for reminder rules and user preferences
2. Implement background job to check for stale ideas
3. Build notification system (push notifications)
4. Create UI for configuring reminder settings
5. Add snooze/dismiss functionality
6. Implement analytics tracking for reminder engagement

## Attempts / Log

## Failures

## Notes / Discoveries

## Next Steps
