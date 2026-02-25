# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Session Metadata
- Session ID:
- Date:
- Owner:
- Plan Pack: ~/.copilot/session-state/<SESSION_ID>/plan.md

## Work Unit Groups Overview
| Group | Title | Status | Depends On |
| --- | --- | --- | --- |
| G-01-example | Group 1: Example | not-started |  |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01-example | WU-001 | not-started | WU-002 |  |

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01-example | unit-tests | after group completion | unit-test-runner |
| ALL | integration-or-e2e (optional) | after all groups done | user-confirmed |

## Stream Evidence
| Group | Predicate | Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| G-01 | execution-log and/or stream-marker |  | pending | status: pending |
| G-02 | execution-log and/or stream-marker |  | pending | status: pending |
| G-03 | execution-log and/or stream-marker |  | pending | status: pending |
| G-04 | execution-log and/or stream-marker |  | pending | status: pending |

## Final Gate Controls
| Control | Status | Waiver Scope | Waiver Release | Waiver Audit | Notes |
| --- | --- | --- | --- | --- | --- |
| evidencePredicates | pending |  |  |  | required |
| finalGateWaiverPrecedence | pending |  |  |  | required |
| trustedEvidenceBindingRetention | pending |  |  |  | required |

## Trusted Evidence Binding
| Commit SHA | Release Tag | Channel | Producer Identity | Attestation Status | Evidence Timestamp | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  | pending |  |  | populate when trustedEvidenceBindingRetention is set to passed |

## Evidence Retention
| Policy | Retention Days | Retained | Release Tag | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| opsLogs | 30 | pending |  |  | minimum required ops log retention is 30d |
| perReleaseEvidence | 365 | pending |  |  | set retained=true when release evidence is present |

## Execution Log
- YYYY-MM-DD HH:MM: Started group G-01-example
