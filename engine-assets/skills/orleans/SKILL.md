---
name: orleans
description: "Microsoft Orleans 10.0 virtual actors with .NET Aspire integration. Creates grains, silos, and distributed state with PostgreSQL persistence and Redis clustering. Use this when asked to create Orleans grains, implement virtual actors, work with distributed state, configure Aspire+Orleans, or build Orleans functionality. Triggers on: Orleans, grain, virtual actor, silo, Aspire Orleans, grain persistence."
---

# Orleans 10.0 Virtual Actors Skill

> **Target Version**: Orleans 10.0.0 with .NET 10 and .NET Aspire

## Purpose
Orleans is a framework for building distributed, scalable applications using the Virtual Actor model. Orleans 10.0 brings improved serialization, better Aspire integration, and streamlined timer APIs.

## Key Changes in Orleans 10.0

| API | Orleans 7.x/8.x | Orleans 10.0 |
|-----|-----------------|--------------|
| **Timer** | `RegisterTimer()` | `RegisterGrainTimer()` with `GrainTimerCreationOptions` |
| **Serialization** | `[Serializable]` / custom | `[GenerateSerializer]` with `[Id(n)]` (mandatory) |
| **Lifecycle** | `OnActivateAsync()` | `OnActivateAsync(CancellationToken ct)` |
| **Aspire** | Manual config | `builder.AddOrleans()` / `builder.UseOrleans()` |

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Grain** | Virtual actor - the fundamental unit of computation |
| **Silo** | Host process that runs grains |
| **Cluster** | Group of silos working together |
| **Grain Interface** | Contract defining grain methods |
| **Grain Reference** | Proxy object to communicate with a grain |
| **Grain Identity** | Unique key identifying a grain instance |

---

## Aspire Integration

### AppHost Configuration (Orchestration)
```csharp
// AppHost/Program.cs or AppHost.cs
using Aspire.Hosting.Orleans;

var builder = DistributedApplication.CreateBuilder(args);

// Infrastructure
var postgres = builder.AddPostgres("default-db");
var redis = builder.AddRedis("redis");

// Orleans cluster (uses Redis for membership/pub-sub)
var orleans = builder.AddOrleans("orleans")
    .WithClustering(redis);

// Wire Orleans to API project
builder.AddProject<Projects.MyApi>("myapi")
    .WithReference(orleans)
    .WithReference(postgres);

await builder.Build().RunAsync();
```

### API Project Silo Configuration
```csharp
// Program.cs in API project
var connectionString = builder.Configuration.GetConnectionString("default-db")!;

builder.UseOrleans(siloBuilder =>
{
    // ADO.NET grain storage with PostgreSQL
    siloBuilder.AddAdoNetGrainStorage("Default", options =>
    {
        options.Invariant = "Npgsql";
        options.ConnectionString = connectionString;
    });
    
    // ADO.NET reminders (for persistent timers)
    siloBuilder.UseAdoNetReminderService(options =>
    {
        options.Invariant = "Npgsql";
        options.ConnectionString = connectionString;
    });
    
    // Memory storage for pub/sub (Orleans Streams internal state)
    siloBuilder.AddMemoryGrainStorage("PubSubStore");
});
```

### Required NuGet Packages
```xml
<!-- Abstractions project (interfaces + state) -->
<PackageReference Include="Microsoft.Orleans.Sdk" Version="10.0.0" />

<!-- Grains project (implementations) -->
<PackageReference Include="Microsoft.Orleans.Sdk" Version="10.0.0" />
<PackageReference Include="Microsoft.Orleans.Runtime" Version="10.0.0" />

<!-- API/Host project -->
<PackageReference Include="Microsoft.Orleans.Server" Version="10.0.0" />
<PackageReference Include="Microsoft.Orleans.Persistence.AdoNet" Version="10.0.0" />
<PackageReference Include="Microsoft.Orleans.Reminders.AdoNet" Version="10.0.0" />
<PackageReference Include="Npgsql" Version="10.0.0" />

<!-- Aspire host -->
<PackageReference Include="Aspire.Hosting.Orleans" Version="10.0.0" />
```

---

## Grain Interface Definition

```csharp
using Orleans.Runtime;

// Use IGrainWithGuidKey for unique execution IDs
public interface IToolExecutionGrain : IGrainWithGuidKey
{
    Task<ToolExecutionState> ExecuteAsync(
        string toolId,
        Dictionary<string, object?> parameters,
        string? tenantId = null,
        string? userId = null);
    
    Task<ToolExecutionState> GetStatusAsync();
    Task<ToolExecutionState> CancelAsync();
}

// Use IGrainWithStringKey for natural IDs (user IDs, session IDs)
public interface IAgentSessionGrain : IGrainWithStringKey
{
    Task<SessionState> GetStateAsync();
    Task AddMessageAsync(ChatMessage message);
}

// Implement IRemindable for persistent scheduled work
public interface IWorkflowGrain : IGrainWithGuidKey, IRemindable
{
    Task<WorkflowState> StartAsync(List<WorkflowStep> steps);
    Task<WorkflowState> GetStateAsync();
    Task PauseAsync();
    Task ResumeAsync();
    Task CancelAsync();
}
```

### Key Types
| Interface | Key Type | Use Case |
|-----------|----------|----------|
| `IGrainWithGuidKey` | `Guid` | Execution IDs, workflow IDs |
| `IGrainWithStringKey` | `string` | User IDs, tenant IDs, session IDs |
| `IGrainWithIntegerKey` | `long` | Sequential IDs |
| `IGrainWithGuidCompoundKey` | `Guid` + `string` | Multi-tenant with GUID |
| `IGrainWithIntegerCompoundKey` | `long` + `string` | Multi-tenant with long |

---

## State Serialization (Orleans 10.0 Pattern)

**CRITICAL**: Orleans 10.0 requires `[GenerateSerializer]` on all state classes with `[Id(n)]` on each persisted property. IDs must be unique within the class and stable across versions.

```csharp
[GenerateSerializer]
public sealed class ToolExecutionState
{
    [Id(0)]
    public Guid ExecutionId { get; set; }

    [Id(1)]
    public string ToolId { get; set; } = "";

    [Id(2)]
    public ToolExecutionStatus Status { get; set; }

    [Id(3)]
    public DateTimeOffset StartedAt { get; set; }

    [Id(4)]
    public DateTimeOffset? CompletedAt { get; set; }

    [Id(5)]
    public Dictionary<string, object?> Parameters { get; set; } = new();

    [Id(6)]
    public string? TenantId { get; set; }

    [Id(7)]
    public string? UserId { get; set; }

    [Id(8)]
    public object? Result { get; set; }

    [Id(9)]
    public string? ErrorMessage { get; set; }

    [Id(10)]
    public ToolExecutionMetrics? Metrics { get; set; }
}

[GenerateSerializer]
public sealed record ToolExecutionMetrics
{
    [Id(0)] public TimeSpan Duration { get; init; }
    [Id(1)] public int TokensUsed { get; init; }
    [Id(2)] public int? InputTokens { get; init; }
    [Id(3)] public int? OutputTokens { get; init; }
}

public enum ToolExecutionStatus
{
    NotStarted = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4
}
```

### Serialization Rules
- **Add `[Id(n)]` to ALL properties** that need to persist (including nested types)
- **IDs must be unique** within a class; order doesn't matter
- **Never reuse IDs** after removing a property (causes deserialization errors)
- **Use records for immutable state** when appropriate
- **Collections work**: `List<T>`, `Dictionary<K,V>`, arrays are supported if `T`, `K`, `V` are serializable

---

## Grain Implementation with Persistent State

```csharp
public sealed class ToolExecutionGrain : Grain, IToolExecutionGrain
{
    private readonly IPersistentState<ToolExecutionState> _state;
    private readonly ILogger<ToolExecutionGrain> _logger;
    private CancellationTokenSource? _executionCts;

    public ToolExecutionGrain(
        [PersistentState("toolExecution", "Default")]
        IPersistentState<ToolExecutionState> state,
        ILogger<ToolExecutionGrain> logger)
    {
        _state = state;
        _logger = logger;
    }

    public async Task<ToolExecutionState> ExecuteAsync(
        string toolId,
        Dictionary<string, object?> parameters,
        string? tenantId = null,
        string? userId = null)
    {
        var executionId = this.GetPrimaryKey();

        // Idempotency: return existing state if already terminal
        if (_state.State.Status is ToolExecutionStatus.Completed
            or ToolExecutionStatus.Failed
            or ToolExecutionStatus.Cancelled)
        {
            return _state.State;
        }

        // Initialize state
        _state.State = new ToolExecutionState
        {
            ExecutionId = executionId,
            ToolId = toolId,
            Status = ToolExecutionStatus.Running,
            StartedAt = DateTimeOffset.UtcNow,
            Parameters = parameters,
            TenantId = tenantId,
            UserId = userId
        };
        await _state.WriteStateAsync();

        _executionCts = new CancellationTokenSource();
        var startTime = DateTimeOffset.UtcNow;

        try
        {
            // Execute tool logic here...
            var result = await ExecuteToolLogicAsync(toolId, parameters, _executionCts.Token);

            _state.State.Status = ToolExecutionStatus.Completed;
            _state.State.Result = result;
            _state.State.CompletedAt = DateTimeOffset.UtcNow;
            _state.State.Metrics = new ToolExecutionMetrics
            {
                Duration = DateTimeOffset.UtcNow - startTime
            };
        }
        catch (OperationCanceledException)
        {
            _state.State.Status = ToolExecutionStatus.Cancelled;
            _state.State.CompletedAt = DateTimeOffset.UtcNow;
        }
        catch (Exception ex)
        {
            _state.State.Status = ToolExecutionStatus.Failed;
            _state.State.ErrorMessage = ex.Message;
            _state.State.CompletedAt = DateTimeOffset.UtcNow;
            _logger.LogError(ex, "Tool execution {ExecutionId} failed", executionId);
        }
        finally
        {
            _executionCts?.Dispose();
            _executionCts = null;
        }

        await _state.WriteStateAsync();
        return _state.State;
    }

    public Task<ToolExecutionState> GetStatusAsync()
    {
        if (_state.State.ExecutionId == Guid.Empty)
        {
            return Task.FromResult(new ToolExecutionState
            {
                ExecutionId = this.GetPrimaryKey(),
                Status = ToolExecutionStatus.NotStarted
            });
        }
        return Task.FromResult(_state.State);
    }

    public Task<ToolExecutionState> CancelAsync()
    {
        if (_state.State.Status == ToolExecutionStatus.Running)
        {
            _executionCts?.Cancel();
        }
        return Task.FromResult(_state.State);
    }

    private Task<object?> ExecuteToolLogicAsync(
        string toolId, 
        Dictionary<string, object?> parameters, 
        CancellationToken ct)
    {
        // Your tool execution logic
        throw new NotImplementedException();
    }
}
```

### PersistentState Attribute Pattern
```csharp
[PersistentState("stateName", "storageName")]
IPersistentState<TState> state
```
- **stateName**: Key for this grain's state in storage (unique per grain type)
- **storageName**: Matches the storage provider name in silo config (`"Default"`, `"PubSubStore"`, etc.)

---

## Timers (RegisterGrainTimer - Orleans 10.0)

**IMPORTANT**: Orleans 10.0 uses `RegisterGrainTimer()` with `GrainTimerCreationOptions`. The legacy `RegisterTimer()` is deprecated.

```csharp
public sealed class WorkflowGrain : Grain, IWorkflowGrain
{
    private async Task ScheduleNextStepAsync()
    {
        var delay = TimeSpan.FromSeconds(30);

        // One-shot timer (non-persistent, lost on deactivation)
        this.RegisterGrainTimer(
            static (state, ct) => state.AdvanceAsync(),  // Callback (static to avoid closure)
            this,                                         // State passed to callback
            new GrainTimerCreationOptions
            {
                DueTime = delay,
                Period = Timeout.InfiniteTimeSpan,  // One-shot (no repeat)
                Interleave = true                    // Allow concurrent grain calls
            });
    }

    // Callback must match: Func<TState, CancellationToken, Task>
    private Task AdvanceAsync()
    {
        // Process next workflow step
        return Task.CompletedTask;
    }
}
```

### Timer vs Reminder Decision
| Feature | Timer | Reminder |
|---------|-------|----------|
| **Persistence** | Lost on deactivation | Survives silo restart |
| **Min interval** | Any | 1 minute minimum |
| **Use case** | Short delays, polling | Scheduled jobs, billing cycles |
| **API** | `RegisterGrainTimer()` | `RegisterOrUpdateReminder()` |

---

## Reminders (Persistent Timers)

```csharp
public sealed class WorkflowGrain : Grain, IWorkflowGrain, IRemindable
{
    private const string AdvanceReminderName = "workflow-advance";

    public async Task ScheduleDelayedStep(TimeSpan delay)
    {
        // Reminders require minimum 1-minute period
        if (delay >= TimeSpan.FromMinutes(1))
        {
            await this.RegisterOrUpdateReminder(
                AdvanceReminderName,
                delay,                      // Due time (when to first fire)
                TimeSpan.FromMinutes(1));   // Period (minimum allowed)
        }
        else
        {
            // Use timer for short delays
            this.RegisterGrainTimer(
                static (state, _) => state.AdvanceAsync(),
                this,
                new GrainTimerCreationOptions
                {
                    DueTime = delay,
                    Period = Timeout.InfiniteTimeSpan
                });
        }
    }

    // IRemindable implementation - called when reminder fires
    public async Task ReceiveReminder(string reminderName, TickStatus status)
    {
        if (reminderName == AdvanceReminderName)
        {
            await AdvanceAsync();
            await UnregisterReminderAsync();  // One-shot behavior
        }
    }

    private async Task UnregisterReminderAsync()
    {
        try
        {
            var reminder = await this.GetReminder(AdvanceReminderName);
            if (reminder is not null)
            {
                await this.UnregisterReminder(reminder);
            }
        }
        catch (Exception ex)
        {
            // Reminder may not exist - safe to ignore
        }
    }
}
```

---

## Grain Lifecycle (Orleans 10.0)

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;

    public PlayerGrain(
        [PersistentState("player", "Default")] IPersistentState<PlayerState> state)
    {
        _state = state;
    }

    // Orleans 10.0: CancellationToken parameter is required
    public override async Task OnActivateAsync(CancellationToken ct)
    {
        // State is auto-loaded before this is called
        // Use for additional initialization (timers, subscriptions)
        await base.OnActivateAsync(ct);
    }

    public override async Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        // Best-effort cleanup (NOT guaranteed to run)
        // Don't rely on this for critical persistence - use WriteStateAsync() explicitly
        await base.OnDeactivateAsync(reason, ct);
    }
}
```

---

## Grain-to-Grain Communication

```csharp
public sealed class WorkflowGrain : Grain, IWorkflowGrain
{
    private readonly IGrainFactory _grainFactory;

    public WorkflowGrain(IGrainFactory grainFactory)
    {
        _grainFactory = grainFactory;
    }

    public async Task ExecuteStepAsync(Guid executionId, string toolId)
    {
        // Get reference to tool execution grain
        var toolGrain = _grainFactory.GetGrain<IToolExecutionGrain>(executionId);
        
        // Execute tool via grain
        var result = await toolGrain.ExecuteAsync(
            toolId,
            new Dictionary<string, object?>(),
            tenantId: "tenant-123",
            userId: "user-456");

        if (result.Status == ToolExecutionStatus.Completed)
        {
            // Continue workflow
        }
    }

    // Cancel a child grain
    public async Task CancelStepAsync(Guid executionId)
    {
        var toolGrain = _grainFactory.GetGrain<IToolExecutionGrain>(executionId);
        await toolGrain.CancelAsync();
    }
}
```

---

## Client Access (from Services/Controllers)

```csharp
public class WorkflowService
{
    private readonly IClusterClient _client;

    public WorkflowService(IClusterClient client)
    {
        _client = client;
    }

    public async Task<WorkflowState> StartWorkflowAsync(Guid workflowId, List<WorkflowStep> steps)
    {
        var grain = _client.GetGrain<IWorkflowGrain>(workflowId);
        return await grain.StartAsync(steps);
    }

    public async Task<WorkflowState> GetWorkflowStatusAsync(Guid workflowId)
    {
        var grain = _client.GetGrain<IWorkflowGrain>(workflowId);
        return await grain.GetStateAsync();
    }
}
```

---

## PostgreSQL Persistence Setup

### ADO.NET Schema
Orleans requires schema tables. Run these SQL scripts (included in Orleans packages):
```bash
# PostgreSQL schema scripts are in the NuGet package:
# Microsoft.Orleans.Persistence.AdoNet/Content/PostgreSQL-Main.sql
# Microsoft.Orleans.Persistence.AdoNet/Content/PostgreSQL-Clustering.sql
# Microsoft.Orleans.Persistence.AdoNet/Content/PostgreSQL-Reminders.sql
```

Or use Marten's auto-create for development (separate from Orleans persistence).

### Connection String Pattern
```json
{
  "ConnectionStrings": {
    "default-db": "Host=localhost;Database=myapp;Username=postgres;Password=secret"
  }
}
```

---

## Best Practices

1. **Use `[GenerateSerializer]` everywhere** - All state classes, DTOs, and method parameters
2. **Keep grains small** - Single responsibility per grain type
3. **Persist state explicitly** - Call `WriteStateAsync()` after mutations
4. **Design for idempotency** - Check terminal states before re-executing
5. **Use reminders for > 1 minute delays** - Timers are lost on deactivation
6. **Inject `IGrainFactory`** for grain-to-grain calls
7. **Pass `CancellationToken`** in lifecycle methods
8. **Never block** - Grains are single-threaded, use async/await

## Common Gotchas

- **Single-Threaded**: Each grain processes one request at a time (turn-based concurrency)
- **[Id(n)] required**: Missing `[Id]` attributes cause silent serialization failures
- **Reminder minimum**: 1-minute minimum period; use timers for shorter delays
- **OnDeactivateAsync not guaranteed**: Always persist critical state explicitly
- **No static state**: Grains can move between silos
- **RegisterTimer deprecated**: Use `RegisterGrainTimer()` with options object in Orleans 10.0

---

## Project Structure (Recommended)

```
MyApp/
├── MyApp.Orleans.Abstractions/     # Interfaces + State classes
│   ├── Grains/
│   │   ├── IToolExecutionGrain.cs
│   │   └── IWorkflowGrain.cs
│   └── State/
│       ├── ToolExecutionState.cs
│       └── WorkflowGrainState.cs
│
├── MyApp.Orleans.Grains/           # Grain implementations
│   └── Grains/
│       ├── ToolExecutionGrain.cs
│       └── WorkflowGrain.cs
│
├── MyApp.Api/                      # Host with silo config
│   └── Program.cs                  # builder.UseOrleans(...)
│
└── MyApp.AppHost/                  # Aspire orchestration
    └── Program.cs                  # builder.AddOrleans(...)
```

---

## External References

- [Orleans Documentation](https://learn.microsoft.com/en-us/dotnet/orleans/)
- [Grain Persistence](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-persistence)
- [Timers and Reminders](https://learn.microsoft.com/en-us/dotnet/orleans/grains/timers-and-reminders)
- [Aspire Orleans Integration](https://learn.microsoft.com/en-us/dotnet/aspire/frameworks/orleans)
- [ADO.NET Persistence Provider](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-persistence/adonet-storage)




