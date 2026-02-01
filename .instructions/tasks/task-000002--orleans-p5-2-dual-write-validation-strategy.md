---
schema: task/v1
id: task-000002
title: "ORLEANS-P5-2: Dual-Write Validation Strategy"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["orleans","testing-dotnet-unit","feature-creator"]
depends_on: ["ORLEANS-P1-1", "ORLEANS-P2-4"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- Dual-write (shadow/write-to-both) is necessary to validate parity between existing ADO.NET storage and new Marten-based grains, and between the old `WorkflowExecutionEngine` and grain-based workflow execution.
- Must capture diffs without affecting production behavior or significantly increasing latency.

## Acceptance Criteria
- [ ] Dual-write mode for grain storage (Marten + ADO.NET)
- [ ] Shadow execution for workflow engine (grain vs engine)
- [ ] Comparison logic with detailed diff logging
- [ ] Alerting on discrepancies
- [ ] Performance impact < 10% additional latency

## Plan / Approach
1. Implement a pluggable dual-write storage wrapper: `Libraries/SAASTools.Orleans.Grains/Migration/DualWriteGrainStorage.cs`.
2. Implement a shadow execution comparator for workflow executions: `Libraries/Workflow/Migration/WorkflowExecutionComparator.cs`.
3. Add sampled logging and a bounded diff store for analyzing mismatches.
4. Integrate metrics and alerts (Prometheus/Grafana or existing metrics pipeline).
5. Add benchmarks and load tests to validate the <10% latency goal.

## Files to Create
- `Libraries/SAASTools.Orleans.Grains/Migration/DualWriteGrainStorage.cs`
- `Libraries/Workflow/Migration/WorkflowExecutionComparator.cs`

## Acceptance Tests / Validation
- Integration tests that run both paths and assert parity on a representative workload.
- Performance tests and benchmarks to quantify overhead.

## Next Steps
- Assign an owner and create a spike PR that implements a minimal dual-write storage wrapper and end-to-end test in integration test harness.
