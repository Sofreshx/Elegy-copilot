---
name: alba-integration-tests
description: "Alba-based integration testing for .NET web apps. Use this when asked to write integration tests for endpoints, APIs, or cross-layer flows. Triggers on: Alba, integration test, endpoint test, WebApplicationFactory replacement, in-process HTTP tests."
---

# Alba Integration Tests Skill

## When to Use
- User asks for integration tests for APIs, endpoints, or HTTP workflows
- You need to validate middleware, routing, DI wiring, or persistence integration
- You want fast, in-process HTTP tests without starting a real server

## When NOT to Use
- Pure business logic tests -> use `testing-dotnet-unit`
- Frontend E2E/UI flows -> use `e2e-playwright-mcp`
- The user explicitly requests real network or external environment tests

## Purpose
Use Alba to run integration tests **in-process** against your ASP.NET Core app. Alba wraps the test host and provides a fluent `Scenario` API for HTTP calls, status checks, and response assertions.

## Key Concepts
- **`AlbaHost.For<Program>()`** bootstraps the app in-process.
- **`Scenario`** defines a request, expected status, and response checks.
- **Host customization** lets you override services, config, and auth for tests.

## Setup (Test Project)
1. Add NuGet package:
   - `Alba`
2. Reference the web app project (the `Program` entry point).
3. If your app uses minimal hosting, ensure `Program` is accessible to tests.

## Recommended Structure
- `IntegrationTests/` folder in the test project
- `AlbaFixture` (shared host setup)
- Per-feature test classes that reuse the fixture

## Example Fixture (Minimal API)
```csharp
using Alba;
using Microsoft.Extensions.DependencyInjection;

public sealed class AlbaFixture : IAsyncLifetime
{
    public IAlbaHost Host { get; private set; } = default!;

    public async Task InitializeAsync()
    {
        Host = await AlbaHost.For<Program>(builder =>
        {
            // Optional: override services for tests
            builder.ConfigureServices(services =>
            {
                // Replace external integrations with fakes if needed
            });
        });
    }

    public async Task DisposeAsync()
    {
        await Host.DisposeAsync();
    }
}
```

## Example Test (Endpoint)
```csharp
public class UsersEndpointTests : IClassFixture<AlbaFixture>
{
    private readonly IAlbaHost _host;

    public UsersEndpointTests(AlbaFixture fixture)
    {
        _host = fixture.Host;
    }

    [Fact]
    public async Task Get_users_returns_ok()
    {
        await _host.Scenario(s =>
        {
            s.Get.Url("/api/users");
            s.StatusCodeShouldBeOk();
        });
    }
}
```

## Auth and Claims
If endpoints require auth, prefer an in-process test identity. Common approaches:
- Add a test auth scheme in the host configuration (test-only)
- Use a custom policy or stub user in DI
- Add headers or tokens in the scenario if your app expects them

Example:
```csharp
await _host.Scenario(s =>
{
    s.Get.Url("/api/secure");
    s.WithHeader("Authorization", "Bearer test-token");
    s.StatusCodeShouldBeOk();
});
```

## Data Seeding
Seed required data inside a test scope:
```csharp
using var scope = _host.Services.CreateScope();
var store = scope.ServiceProvider.GetRequiredService<MyStore>();
// Seed data before scenario
```

## Response Assertions
- Use status helpers: `StatusCodeShouldBeOk`, `StatusCodeShouldBe(201)`
- Parse JSON when needed and assert strongly typed content
- Keep assertions focused on contract behavior, not internal details

## Common Pitfalls
- Missing `Program` visibility (ensure the test project can access it)
- Relying on external services without fakes
- Sharing host across tests with mutable state (reset between tests if needed)

## Execution Policy
- Do NOT execute tests directly.
- Delegate execution to `integration-test-runner` with explicit filters.

## Output Expectations
- Integration tests that exercise endpoints and cross-layer behavior
- Notes for any required test configuration, auth overrides, or data seeding

## Session Summary Format
- **Done**: [tests written]
- **Changes**: [files modified]
- **Warnings**: [if any external deps or flaky tests]
- **Next**: [suggested integration runs if requested]
