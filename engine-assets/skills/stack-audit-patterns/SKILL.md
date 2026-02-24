---
name: stack-audit-patterns
description: "Framework-specific audit patterns for Marten, Wolverine, Orleans, SignalR, and Aspire. Triggers on: stack audit, framework audit, pattern check, stack-audit-patterns, runtime failure patterns."
---

# Stack Audit Patterns

## Severity Definitions

| Severity | Definition |
|----------|------------|
| Critical | Will fail at runtime or cause data corruption |
| High | Likely to cause bugs or operational issues |
| Medium | Best practice violations that may cause issues at scale |
| Low | Style/convention issues, minor improvements |

## Marten (PostgreSQL Document/Event Store)

| Severity | Pattern | What to Check |
|----------|---------|---------------|
| Critical | No GroupBy in LINQ | `GroupBy(` in Marten query context — not supported, throws at runtime |
| Critical | Stats() outside compiled queries | `Stats(` inside `[CompiledQuery]` classes — must be outside |
| Critical | IAsyncEnumerable session scope | Returning `IAsyncEnumerable` from methods that close the session before enumeration |
| High | OrderBy before Skip/Take | `Skip(` or `Take(` without preceding `OrderBy` — undefined ordering |
| Medium | Nested Contains | `Contains(` inside `Any(` — complex nested LINQ may fail translation |

## Wolverine (Message Handler Framework)

| Severity | Pattern | What to Check |
|----------|---------|---------------|
| High | UseWolverine configured | `UseWolverine` must exist in Program.cs or host config |
| High | Discovery configured | `Discovery.IncludeAssembly` required for multi-assembly projects |
| Medium | AutoApplyTransactions | `AutoApplyTransactions()` recommended when Marten is co-present |
| Medium | Handler naming | Classes should end in `Handler` or `Consumer` for discovery |
| Low | Handle method visibility | Public `Handle`/`HandleAsync` methods required for auto-discovery |

## Orleans (Virtual Actor Framework)

| Severity | Pattern | What to Check |
|----------|---------|---------------|
| Critical | GenerateSerializer on state | All grain state classes need `[GenerateSerializer]` attribute |
| Critical | Id(n) on properties | All serialized properties in state classes need `[Id(n)]` attribute |
| Critical | OnActivateAsync signature | Orleans 10.0 requires `CancellationToken` parameter |
| High | RegisterGrainTimer | `RegisterTimer(` is deprecated — use `RegisterGrainTimer` |
| Medium | Grain state persistence | `AddGrainStorage` or `AddMemoryGrainStorage` must be configured |

## SignalR (Real-Time Communication)

| Severity | Pattern | What to Check |
|----------|---------|---------------|
| High | Hub inheritance | Hub classes must inherit from `Hub` or `Hub<T>` |
| Medium | Strongly-typed hub | Prefer `Hub<IClient>` over untyped `Hub` for compile-time safety |
| Low | Connection management | Verify `Groups.AddToGroupAsync` usage for group-based messaging |

## Aspire (.NET Orchestration)

| Severity | Pattern | What to Check |
|----------|---------|---------------|
| High | Orleans integration | `AddOrleans()` required in AppHost when Orleans is detected |
| Medium | Service references | `WithReference` calls must match actual registered services |
| Medium | Health checks | `WithHealthCheck` or `MapHealthChecks` should be configured |
| Low | Environment config | Verify different configs exist for dev vs prod environments |
