---
schema: task/v1
id: task-000394
title: "Bug Fix: Replace Results.Forbid() with StatusCode(403) across APIs"
type: bugfix
status: blocked
priority: critical
owner: ""
skills: ["csharp-expert", "wolverine-http"]
depends_on: []
next_tasks: ["task-000395", "task-000396"]
created: "2026-01-31"
updated: "2026-01-31"
---

## Context

`Results.Forbid()` requires ASP.NET Core authentication middleware (`services.AddAuthentication()`), which SAASTools doesn't configure (uses Firebase Admin SDK directly). This causes a 500 error on `GET /offers` when user is null.

Error:
```
System.InvalidOperationException: Unable to find the required 'IAuthenticationService' service.
```

## Acceptance Criteria

- [ ] All `Results.Forbid()` calls replaced with `Results.StatusCode(StatusCodes.Status403Forbidden)`
- [ ] No compile errors
- [ ] `GET /offers` returns 403 when user is null (not 500)
- [ ] Existing tests pass

## Files to Modify

Search and replace in:
- `Api/AccountManager.Api/**/*.cs`
- `Api/Tools.Api/**/*.cs`

Known locations:
- `Api/AccountManager.Api/Features/Offers/OfferEndpoints.cs` (lines 31, 58, 82, 137, etc.)

## Implementation

Replace:
```csharp
return Results.Forbid();
```

With:
```csharp
return Results.StatusCode(StatusCodes.Status403Forbidden);
```

## Validation

- `dotnet build SAASTools.sln`
- Run: `dotnet test Api/AccountManager.Api.Tests`
- Manual: Call `GET /offers` without auth header → expect 403

## Notes / Discoveries

- Plan artefact .instructions/artefacts/skills-ui-security-bugfix-PLAN-artefact.md not found in repo.
- AccountManager.Api.Tests has multiple ForbidHttpResult assertions; update them to assert status code 403 via `IStatusCodeHttpResult`.
- Found remaining `TypedResults.Forbid()`/`ForbidHttpResult` usage in Tools.Api endpoints (HubLayouts, Alerts, ExternalApis). These still rely on ASP.NET auth and must be replaced with 403 status results to satisfy the acceptance criteria.

## Attempts / Log

- 2026-01-31: Updated AccountManager.Api.Tests forbid assertions to check status code 403. Validation pending (requires test-runner for `dotnet test Api/AccountManager.Api.Tests`).
- 2026-01-31: Began replacing remaining Tools.Api `TypedResults.Forbid()` with `TypedResults.StatusCode(StatusCodes.Status403Forbidden)` and updated endpoint result unions from `ForbidHttpResult` to `StatusCodeHttpResult`.
- 2026-01-31: Ran `dotnet build SAASTools.sln -nologo` → failed due to existing AppHost test errors (`TenantIsolationSecurityTests` missing `AutoCreate`/`ConfigureMultiTenancy`). Build warnings include known NU1901 advisories.
