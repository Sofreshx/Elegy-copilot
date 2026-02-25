# Plan Pack
<!-- IE_PLAN_PACK_VERSION: 1 -->

## Goal + Success Criteria
- Goal:
- Success Criteria:
  -

## Context Loaded (exact files)
-

## Assumptions + Constraints
-

## Decisions (with rationale)
-

## Dropped / Deferred
-

## Work Unit Groups
| Group | Title | Depends On | Parallel Notes |
| --- | --- | --- | --- |
| G-01-example | Group 1: Example |  |  |

## Work Unit Graph
| Group | Work Unit ID | Title | Depends On | Next Units | Parallel Safe |
| --- | --- | --- | --- | --- | --- |
| G-01-example | WU-001 |  | [] | [] | yes |

## Work Unit Index
| Group | Work Unit ID | Title | Spec Heading |
| --- | --- | --- | --- |
| G-01-example | WU-001 |  | ### WU-001 —  |

## Work Unit Specs

### WU-001 — <Title>

#### Context

#### Acceptance Criteria
-

#### Plan / Approach
-

#### Expected Files (optional)
-

#### Validation
-

#### Risks / Notes
-

## Execution Notes
- The plan pack is read-only during execution. Update progress only in the session progress tracker (typically `x-PLANPACK-PROGRESS-<SESSION_ID>.md`).
- Each work unit is executed via `work-unit-runner`.
- For versioned planpacks, ensure the progress tracker includes `## Stream Evidence` rows for `G-01`..`G-04` and corresponding completion evidence.

## Risks / Rollback
-

## Validation
- Default: unit-test-runner after each group completes.
- Optional: integration/E2E tests only with user confirmation.
