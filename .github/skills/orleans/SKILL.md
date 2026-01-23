---
name: orleans
description: "Microsoft Orleans virtual actors. Creates grains, silos, and distributed state. Use this when asked to create Orleans grains, implement virtual actors, work with distributed state, or build Orleans functionality. Triggers on:"Orleans", "grain", "virtual actor"."
---

# Orleans Virtual Actors Skill

## Purpose
Orleans is a framework for building distributed, scalable applications using the Virtual Actor model. It provides a straightforward approach to building distributed high-scale computing applications without needing to learn complex distributed systems patterns.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Grain** | Virtual actor - the fundamental unit of computation |
| **Silo** | Host process that runs grains |
| **Cluster** | Group of silos working together |
| **Grain Interface** | Contract defining grain methods |
| **Grain Reference** | Proxy object to communicate with a grain |
| **Grain Identity** | Unique key identifying a grain instance |

## Grain Interface

Define what a grain can do using an interface:
```csharp
public interface IPlayerGrain : IGrainWithGuidKey
{
    Task<IGameGrain> GetCurrentGame();
    Task JoinGame(IGameGrain game);
    
    [ResponseTimeout("00:00:05")] // 5 second timeout
    Task LeaveGame(IGameGrain game);
}
```

### Key Types
| Interface | Key Type |
|-----------|----------|
| `IGrainWithGuidKey` | `Guid` |
| `IGrainWithIntegerKey` | `long` |
| `IGrainWithStringKey` | `string` |
| `IGrainWithGuidCompoundKey` | `Guid` + `string` |
| `IGrainWithIntegerCompoundKey` | `long` + `string` |

## Grain Implementation

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private IGameGrain? _currentGame;

    public Task<IGameGrain?> GetCurrentGame()
    {
        return Task.FromResult(_currentGame);
    }

    public Task JoinGame(IGameGrain game)
    {
        _currentGame = game;
        Console.WriteLine($"Player {this.GetPrimaryKey()} joined game {game.GetPrimaryKey()}");
        return Task.CompletedTask;
    }

    public Task LeaveGame(IGameGrain game)
    {
        _currentGame = null;
        Console.WriteLine($"Player {this.GetPrimaryKey()} left game {game.GetPrimaryKey()}");
        return Task.CompletedTask;
    }
}
```

## Grain References

### Get Grain Reference (from inside a grain)
```csharp
public class GameGrain : Grain, IGameGrain
{
    public async Task AddPlayer(Guid playerId)
    {
        // Get reference to another grain
        var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
        await player.JoinGame(this.AsReference<IGameGrain>());
    }
}
```

### Get Grain Reference (from client)
```csharp
public class GameService
{
    private readonly IClusterClient _client;
    
    public GameService(IClusterClient client) => _client = client;
    
    public async Task<Game> GetGameAsync(Guid gameId)
    {
        var grain = _client.GetGrain<IGameGrain>(gameId);
        return await grain.GetGameState();
    }
}
```

## Lifecycle Methods

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    public override async Task OnActivateAsync(CancellationToken ct)
    {
        // Called when grain is activated
        // Load state, initialize resources
        await base.OnActivateAsync(ct);
    }

    public override async Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        // Called when grain is deactivated (best-effort, not guaranteed)
        // Save state, cleanup resources
        await base.OnDeactivateAsync(reason, ct);
    }
}
```

## Grain Persistence

### Declare Persistent State
```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;

    public PlayerGrain(
        [PersistentState("player", "playerStore")] IPersistentState<PlayerState> state)
    {
        _state = state;
    }

    public async Task UpdateScore(int points)
    {
        _state.State.Score += points;
        await _state.WriteStateAsync();  // Persist changes
    }

    public Task<int> GetScore() => Task.FromResult(_state.State.Score);
}

[GenerateSerializer]
public class PlayerState
{
    [Id(0)] public int Score { get; set; }
    [Id(1)] public string Name { get; set; } = "";
}
```

### Configure Storage Provider
```csharp
builder.Host.UseOrleans(siloBuilder =>
{
    siloBuilder.AddAzureTableGrainStorage(
        name: "playerStore",
        configureOptions: options =>
        {
            options.ConfigureTableServiceClient(connectionString);
        });
});
```

## Timers and Reminders

### Timers (in-memory, lost on deactivation)
```csharp
public class MonitorGrain : Grain, IMonitorGrain
{
    private IDisposable? _timer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        _timer = RegisterTimer(
            CheckStatus,           // Callback
            null,                  // State
            TimeSpan.FromSeconds(5),   // Due time
            TimeSpan.FromSeconds(30)); // Period
        
        return base.OnActivateAsync(ct);
    }

    private async Task CheckStatus(object? state)
    {
        // Periodic work
    }
}
```

### Reminders (persistent, survives deactivation)
```csharp
public class SubscriptionGrain : Grain, ISubscriptionGrain, IRemindable
{
    public async Task StartBillingReminder()
    {
        await RegisterOrUpdateReminder(
            "billing",
            TimeSpan.FromDays(30),  // Due time
            TimeSpan.FromDays(30)); // Period
    }

    public Task ReceiveReminder(string reminderName, TickStatus status)
    {
        if (reminderName == "billing")
        {
            // Process billing
        }
        return Task.CompletedTask;
    }
}
```

## Configuration

### Basic Silo Setup
```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Host.UseOrleans(siloBuilder =>
{
    siloBuilder.UseLocalhostClustering();  // Dev only
    siloBuilder.AddMemoryGrainStorage("Default");
});

var app = builder.Build();
app.Run();
```

### Production Clustering (Azure)
```csharp
builder.Host.UseOrleans(siloBuilder =>
{
    siloBuilder.UseAzureStorageClustering(options =>
    {
        options.ConfigureTableServiceClient(connectionString);
    });
    
    siloBuilder.AddAzureTableGrainStorage("Default", options =>
    {
        options.ConfigureTableServiceClient(connectionString);
    });
});
```

### Client Configuration
```csharp
builder.Services.AddOrleansClient(clientBuilder =>
{
    clientBuilder.UseLocalhostClustering();  // Dev only
});
```

## Calling Patterns

### Parallel Calls
```csharp
public async Task NotifyAllPlayers(IEnumerable<Guid> playerIds, string message)
{
    var tasks = playerIds.Select(id =>
    {
        var player = GrainFactory.GetGrain<IPlayerGrain>(id);
        return player.Notify(message);
    });
    
    await Task.WhenAll(tasks);
}
```

### Grain-to-Grain Communication
```csharp
public class LobbyGrain : Grain, ILobbyGrain
{
    public async Task<IGameGrain> CreateGame(Guid gameId)
    {
        var game = GrainFactory.GetGrain<IGameGrain>(gameId);
        await game.Initialize();
        return game;
    }
}
```

## Best Practices

1. **Keep Grains Small**: Single responsibility - one grain type per domain concept
2. **Avoid Long-Running Operations**: Grains are single-threaded, don't block
3. **Use Async/Await**: All grain methods should be async
4. **Prefer Fire-and-Forget Carefully**: Use `InvokeOneWay()` only when you don't need results
5. **Design for Failure**: Grains can be deactivated anytime, persist important state
6. **Use Reminders for Reliability**: For periodic work that must survive restarts

## Common Gotchas

- **Single-Threaded**: Each grain processes one request at a time (turn-based concurrency)
- **Activation**: Grains activate on first call, deactivate after idle timeout
- **OnDeactivateAsync Not Guaranteed**: Don't rely on it for critical operations
- **Serialization Required**: All grain method parameters and return values must be serializable
- **No Static State**: Don't store state in static fields - grains can move between silos
- **Exceptions Propagate**: Exceptions in grains propagate to callers

````




