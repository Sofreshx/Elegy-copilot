---
name: marten-events
description: >
    Marten event sourcing. PostgreSQL event store with projections. Use this when asked to implement event sourcing, work with Marten events, create projections, or build event store functionality.
    Triggers on: "event sourcing", "Marten events", "event stream".
---

# Marten Event Sourcing Skill

## Purpose
Marten provides a powerful Event Store implementation on top of PostgreSQL, enabling event sourcing patterns with rich projection support.

## Core Concepts

| Term | Description |
|------|-------------|
| **Event** | Immutable business fact representing a state change |
| **Stream** | Related sequence of events for a single aggregate |
| **Aggregate** | Read-side view built from events in a stream |
| **Projection** | Strategy for building views from raw events |
| **Inline Projection** | Updates view in same transaction as event append |
| **Async Projection** | Updates view in background (eventually consistent) |
| **Live Aggregation** | Builds view on-demand from events |

## Defining Events

```csharp
// Events are simple POCOs or records
public record QuestStarted(Guid QuestId, string Name);
public record MembersJoined(Guid QuestId, string[] Members);
public record MembersDeparted(Guid QuestId, string[] Members);
public record QuestCompleted(Guid QuestId);
```

### Register Event Types
```csharp
var store = DocumentStore.For(opts =>
{
    opts.Connection(connectionString);
    
    // Register event types (optional but recommended for queries)
    opts.Events.AddEventType<QuestStarted>();
    opts.Events.AddEventType<MembersJoined>();
    opts.Events.AddEventType<MembersDeparted>();
    opts.Events.AddEventType<QuestCompleted>();
});
```

## Appending Events

### Start New Stream
```csharp
await using var session = store.LightweightSession();

var questId = Guid.NewGuid();

// Start a new stream with initial events
session.Events.StartStream<Quest>(questId,
    new QuestStarted(questId, "Dragon Hunt"),
    new MembersJoined(questId, ["Frodo", "Sam"]));

await session.SaveChangesAsync();
```

### Append to Existing Stream
```csharp
await using var session = store.LightweightSession();

session.Events.Append(questId,
    new MembersJoined(questId, ["Gandalf"]),
    new MembersDeparted(questId, ["Sam"]));

await session.SaveChangesAsync();
```

### Optimistic Concurrency
```csharp
// Append only if stream is at expected version
session.Events.Append(questId, expectedVersion: 3,
    new MembersJoined(questId, ["Aragorn"]));

await session.SaveChangesAsync(); // Throws if version mismatch
```

## Querying Events

### Fetch Stream
```csharp
await using var session = store.QuerySession();

// Get all events for a stream
var events = await session.Events.FetchStreamAsync(questId);

foreach (var @event in events)
{
    Console.WriteLine($"v{@event.Version}: {@event.Data.GetType().Name}");
}
```

### Query Events Across Streams
```csharp
// Query specific event type
var allQuestStarts = await session.Events
    .QueryAllRawEvents()
    .Where(e => e.EventType == typeof(QuestStarted))
    .ToListAsync();

// Query with LINQ
var recentEvents = await session.Events
    .QueryAllRawEvents()
    .Where(e => e.Timestamp > DateTime.UtcNow.AddHours(-1))
    .ToListAsync();
```

## Aggregates (Projections)

### Define Aggregate
```csharp
public sealed record QuestParty(Guid Id, List<string> Members)
{
    // Create method for first event
    public static QuestParty Create(QuestStarted started) 
        => new(started.QuestId, []);

    // Apply methods for subsequent events
    public static QuestParty Apply(MembersJoined joined, QuestParty party) 
        => party with { Members = party.Members.Union(joined.Members).ToList() };

    public static QuestParty Apply(MembersDeparted departed, QuestParty party) 
        => party with { Members = party.Members.Except(departed.Members).ToList() };
}
```

### Live Aggregation (On-Demand)
```csharp
await using var session = store.LightweightSession();

// Build aggregate from events on the fly
var party = await session.Events.AggregateStreamAsync<QuestParty>(questId);

// Aggregate at specific version
var partyV3 = await session.Events.AggregateStreamAsync<QuestParty>(questId, version: 3);

// Aggregate at specific timestamp
var partyYesterday = await session.Events.AggregateStreamAsync<QuestParty>(
    questId, 
    timestamp: DateTime.UtcNow.AddDays(-1));
```

### Inline Projection (Transactional)
```csharp
var store = DocumentStore.For(opts =>
{
    opts.Connection(connectionString);
    
    // Register as inline snapshot projection
    opts.Projections.Snapshot<QuestParty>(SnapshotLifecycle.Inline);
});

// Now QuestParty documents are updated in same transaction
await using var session = store.LightweightSession();

session.Events.StartStream<Quest>(questId,
    new QuestStarted(questId, "Dragon Hunt"),
    new MembersJoined(questId, ["Frodo", "Sam"]));

await session.SaveChangesAsync();

// Query as regular document
var party = await session.LoadAsync<QuestParty>(questId);
```

### Async Projection (Eventually Consistent)
```csharp
var store = DocumentStore.For(opts =>
{
    opts.Connection(connectionString);
    
    // Register as async projection
    opts.Projections.Snapshot<QuestParty>(SnapshotLifecycle.Async);
});

// Start the async daemon
await using var daemon = await store.BuildProjectionDaemonAsync();
await daemon.StartAllAsync();
```

## Projection Types

### Single Stream Projection
Aggregates events from one stream into one document (shown above).

### Multi-Stream Projection
Aggregates across multiple streams:
```csharp
public class DailyQuestSummary
{
    public string Id { get; set; } // Date string
    public int QuestsStarted { get; set; }
    public int QuestsCompleted { get; set; }
}

public class DailyQuestSummaryProjection : MultiStreamProjection<DailyQuestSummary, string>
{
    public DailyQuestSummaryProjection()
    {
        // Group by date
        Identity<QuestStarted>(e => e.Timestamp.Date.ToString("yyyy-MM-dd"));
        Identity<QuestCompleted>(e => e.Timestamp.Date.ToString("yyyy-MM-dd"));
    }

    public static DailyQuestSummary Create(QuestStarted started) 
        => new() { QuestsStarted = 1 };

    public static void Apply(QuestCompleted completed, DailyQuestSummary summary) 
        => summary.QuestsCompleted++;
}
```

### Event Projection (One Event ? Document)
```csharp
public class QuestStartedProjection : EventProjection
{
    public QuestLog Transform(IEvent<QuestStarted> @event)
    {
        return new QuestLog
        {
            Id = @event.StreamId,
            Name = @event.Data.Name,
            StartedAt = @event.Timestamp
        };
    }
}
```

## Configuration with Wolverine

```csharp
builder.Host.UseWolverine(opts =>
{
    // Auto-apply transactions with Marten
    opts.Policies.AutoApplyTransactions();
    
    // Integrate events with Wolverine message handling
    opts.IntegrateWithMarten()
        .EventForwardingToWolverineLocalQueue();
});

builder.Services.AddMarten(opts =>
{
    opts.Connection(connectionString);
    opts.Projections.Snapshot<QuestParty>(SnapshotLifecycle.Inline);
});
```

## Rebuilding Projections

```csharp
await using var daemon = await store.BuildProjectionDaemonAsync();

// Rebuild a specific projection
await daemon.RebuildProjectionAsync<QuestParty>(CancellationToken.None);

// Rebuild all projections
await daemon.RebuildAllProjectionsAsync(CancellationToken.None);
```

## Event Metadata

```csharp
// Access metadata on events
var events = await session.Events.FetchStreamAsync(questId);

foreach (var evt in events)
{
    var version = evt.Version;          // Position in stream
    var sequence = evt.Sequence;        // Global sequence
    var timestamp = evt.Timestamp;      // When appended
    var eventType = evt.EventType;      // CLR type
    var data = evt.Data;                // The actual event
}
```

### Add Custom Metadata
```csharp
session.Events.Append(questId, new MembersJoined(questId, ["Gandalf"]));

// Add correlation/causation headers
session.CorrelationId = correlationId;
session.CausationId = causationId;

await session.SaveChangesAsync();
```

## Best Practices

1. **Events are Immutable**: Never modify event definitions after deployment
2. **Events are Facts**: Name them in past tense (QuestStarted, not StartQuest)
3. **Keep Events Small**: Only include necessary data
4. **Version Events**: Use schema versioning for evolution
5. **Use Inline for Critical**: When projection must be consistent with events
6. **Use Async for Scale**: For high-volume, read-heavy projections
7. **Idempotent Projections**: Handle replays gracefully

## Common Gotchas

- **Event Ordering**: Events in a stream are ordered; across streams, use Sequence
- **Projection Rebuild**: May be needed when projection logic changes
- **Quick vs Rich Append**: Quick mode doesn't populate all metadata inline
- **Serialization**: Events must be JSON serializable
- **Stream Identity**: Use meaningful IDs (aggregate ID, not random)
- **No Default Constructor**: Marten creates uninitialized objects if no default constructor

````


