---
name: aspire-apphost
description: ".NET Aspire AppHost orchestration. Configures service discovery, dependencies, and local development. Use this when asked to configure Aspire, add a service to AppHost, set up orchestration, or work on Aspire AppHost configuration. Triggers on:"AppHost", "Aspire AppHost", "Aspire orchestration", "Aspire"."
---

# .NET Aspire AppHost Skill

## Purpose
Aspire AppHost is the orchestration layer that defines your distributed application's architecture in code. It manages service discovery, dependency injection of configuration, and local development orchestration.

## Key Benefits
- **Unified Development**: Launch and debug entire distributed app with one command
- **Code-First Config**: Define architecture in C# - no YAML/config files
- **Auto Orchestration**: Handle service startup, dependencies, and connections
- **Type Safety**: Catch configuration errors at compile time

## Basic AppHost Structure

### Minimal AppHost
```csharp
// AppHost/Program.cs
var builder = DistributedApplication.CreateBuilder(args);

builder.Build().Run();
```

### Three-Tier Application
```csharp
var builder = DistributedApplication.CreateBuilder(args);

// 1. Add infrastructure resource
var postgres = builder.AddPostgres("db")
    .AddDatabase("appdata")
    .WithDataVolume();

// 2. Add API service with dependency
var api = builder.AddProject<Projects.Api>("api")
    .WithReference(postgres)
    .WaitFor(postgres);

// 3. Add frontend with API dependency
builder.AddViteApp("frontend", "../frontend")
    .WithHttpEndpoint(env: "PORT")
    .WithReference(api);

builder.Build().Run();
```

## Core Methods

### Adding Resources

| Method | Resource Type | Example |
|--------|--------------|---------|
| `AddProject<T>()` | .NET Project | `AddProject<Projects.Api>("api")` |
| `AddPostgres()` | PostgreSQL | `AddPostgres("db")` |
| `AddRedis()` | Redis Cache | `AddRedis("cache")` |
| `AddRabbitMQ()` | RabbitMQ | `AddRabbitMQ("messaging")` |
| `AddContainer()` | Docker Container | `AddContainer("nginx", "nginx:latest")` |
| `AddViteApp()` | Vite/Node.js | `AddViteApp("ui", "../frontend")` |

### Configuring Dependencies

```csharp
var db = builder.AddPostgres("db").AddDatabase("mydb");
var cache = builder.AddRedis("cache");

var api = builder.AddProject<Projects.Api>("api")
    .WithReference(db)        // Injects connection string
    .WithReference(cache)     // Injects cache endpoint
    .WaitFor(db)              // Wait for DB to be healthy
    .WaitFor(cache);          // Wait for cache to be ready
```

### Environment & Endpoints

```csharp
var api = builder.AddProject<Projects.Api>("api")
    .WithHttpEndpoint(port: 5000)                    // Fixed port
    .WithHttpsEndpoint(port: 5001)                   // HTTPS
    .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
    .WithEnvironment("Feature__Enabled", "true");
```

## Common Integration Patterns

### PostgreSQL + Database
```csharp
var postgres = builder.AddPostgres("postgres")
    .WithDataVolume()                    // Persist data across restarts
    .WithPgAdmin();                      // Add pgAdmin UI

var db = postgres.AddDatabase("app-db");

builder.AddProject<Projects.Api>("api")
    .WithReference(db);                  // ConnectionStrings__app-db injected
```

### Redis Cache
```csharp
var cache = builder.AddRedis("cache")
    .WithRedisCommander();               // Add Redis Commander UI

builder.AddProject<Projects.Api>("api")
    .WithReference(cache);               // ConnectionStrings__cache injected
```

### RabbitMQ Messaging
```csharp
var rabbit = builder.AddRabbitMQ("messaging")
    .WithManagementPlugin();             // Add management UI

builder.AddProject<Projects.Worker>("worker")
    .WithReference(rabbit);
```

### External Service (Existing Infrastructure)
```csharp
// Reference existing services not managed by Aspire
var externalApi = builder.AddConnectionString("external-api");

builder.AddProject<Projects.Api>("api")
    .WithReference(externalApi);
```

## Service-to-Service Communication

```csharp
var api = builder.AddProject<Projects.Api>("api");

var frontend = builder.AddProject<Projects.Frontend>("frontend")
    .WithReference(api);  // Frontend gets api's endpoint injected

// In Frontend project, inject configuration:
// services__api__http__0 = http://localhost:5001
```

### Accessing Injected Endpoints
```csharp
// In consuming service
public class ApiClient
{
    private readonly HttpClient _client;
    
    public ApiClient(IConfiguration config)
    {
        var apiUrl = config["services:api:http:0"];
        _client = new HttpClient { BaseAddress = new Uri(apiUrl) };
    }
}
```

## Lifecycle Events

```csharp
var builder = DistributedApplication.CreateBuilder(args);

// Hook into lifecycle
builder.Eventing.Subscribe<BeforeStartEvent>((evt, ct) =>
{
    Console.WriteLine("About to start services...");
    return Task.CompletedTask;
});

builder.Eventing.Subscribe<AfterEndpointsAllocatedEvent>((evt, ct) =>
{
    Console.WriteLine("Endpoints allocated, services starting...");
    return Task.CompletedTask;
});

builder.Eventing.Subscribe<AfterResourcesCreatedEvent>((evt, ct) =>
{
    Console.WriteLine("All resources ready!");
    return Task.CompletedTask;
});
```

## Service Defaults Integration

Every service in an Aspire app should add service defaults:

```csharp
// In each service's Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();  // Adds telemetry, health checks, resiliency

var app = builder.Build();

app.MapDefaultEndpoints();     // Maps /health, /alive endpoints

app.Run();
```

### What Service Defaults Provides
- **Telemetry**: Logging, tracing, metrics with OpenTelemetry
- **Health Checks**: HTTP endpoints for orchestration
- **Resiliency**: Retry policies, circuit breakers (via Polly)

## Best Practices

1. **Keep AppHost Minimal**: Start simple, add complexity as needed
2. **Explicit Dependencies**: Use `.WithReference()` to make wiring obvious
3. **Use WaitFor**: Ensure dependent services wait for their dependencies
4. **Descriptive Names**: Clear resource names help debugging
5. **Separate Configs**: Different configurations for dev/test/prod
6. **Data Volumes**: Use `.WithDataVolume()` for stateful services in dev

## Project Structure

```
MySolution/
+-- MySolution.AppHost/           # Orchestration project
�   +-- Program.cs                # AppHost definition
�   +-- apphost.run.json          # Local run configuration
+-- MySolution.ServiceDefaults/   # Shared service configuration
�   +-- Extensions.cs             # AddServiceDefaults() extension
+-- MySolution.Api/               # API service
+-- MySolution.Worker/            # Background worker
```

## Running the AppHost

```bash
# Run with .NET CLI
dotnet run --project MySolution.AppHost

# Or F5 in Visual Studio with AppHost as startup project
```

## Dashboard

Aspire provides a built-in dashboard showing:
- All running services and their status
- Logs from all services in one place
- Distributed traces
- Metrics
- Environment variables

Access at: `https://localhost:15888` (default)

## Common Gotchas

- **Project References**: AppHost must reference all service projects
- **Service Defaults**: Every service should call `AddServiceDefaults()`
- **Port Conflicts**: Let Aspire assign ports unless you need specific ones
- **Docker Required**: Container resources need Docker Desktop running
- **Health Checks**: Implement health checks for `WaitFor()` to work properly

````




