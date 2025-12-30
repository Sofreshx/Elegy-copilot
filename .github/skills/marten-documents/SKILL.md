---
name: marten-documents
description: "Marten document database. PostgreSQL document store with LINQ queries. Use for 'Marten query', 'document store', 'store document', or Marten document tasks."
tools: ['read', 'edit', 'search']
sources:
  - https://martendb.io/documents/sessions.html
  - https://martendb.io/documents/
---

# Marten Document Database Skill

## Purpose
Marten is a .NET library that turns PostgreSQL into a document database and event store. It provides a simple, powerful API for storing and querying JSON documents with full LINQ support.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **IDocumentStore** | Root object - creates sessions, manages schema |
| **IQuerySession** | Lightweight read-only session for queries |
| **IDocumentSession** | Read/write session with unit of work pattern |
| **Identity Map** | Caches loaded documents by ID within a session |
| **Dirty Tracking** | Automatically detects changes to loaded documents |

## Session Types

| Method | Access | Identity Map | Use Case |
|--------|--------|--------------|----------|
| `QuerySession()` | Read Only | No | Fast queries, no tracking overhead |
| `LightweightSession()` | Read/Write | No | CRUD without caching (recommended for most cases) |
| `IdentitySession()` | Read/Write | Yes | When you need document caching |
| `DirtyTrackedSession()` | Read/Write | Yes | Auto-detect changes (more overhead) |

## Configuration

### Basic Setup with DI
```csharp
builder.Services.AddMarten(opts =>
{
    opts.Connection(builder.Configuration.GetConnectionString("Postgres")!);
    
    // Auto-create/update schema on startup
    opts.AutoCreateSchemaObjects = AutoCreate.All;
});
```

### With Wolverine Integration
```csharp
builder.Host.UseWolverine(opts =>
{
    opts.Policies.AutoApplyTransactions();
    opts.UseMartenForPersistence();
});

builder.Services.AddMarten(opts =>
{
    opts.Connection(connectionString);
})
.IntegrateWithWolverine();
```

## Storing Documents

### Store (Insert or Update - Upsert)
```csharp
await using var session = store.LightweightSession();

var user = new User { FirstName = "John", LastName = "Doe" };
session.Store(user);  // Insert or update based on ID

await session.SaveChangesAsync();
```

### Insert Only (Throws if exists)
```csharp
session.Insert(user);  // Throws if document with ID exists
await session.SaveChangesAsync();
```

### Update Only (Throws if missing)
```csharp
session.Update(user);  // Throws if document doesn't exist
await session.SaveChangesAsync();
```

### Bulk Insert
```csharp
var users = new[] { user1, user2, user3 };
await store.BulkInsertAsync(users);
```

## Loading Documents

### By ID
```csharp
await using var session = store.QuerySession();

// Single document
var user = await session.LoadAsync<User>(userId);

// Multiple documents
var users = await session.LoadManyAsync<User>(id1, id2, id3);
```

### Write JSON Directly to Response (Fast Path)
```csharp
// In ASP.NET Core controller - writes JSON without deserialization
await session.Json.WriteById<User>(userId, HttpContext);
```

## Querying with LINQ

### Basic Queries
```csharp
await using var session = store.QuerySession();

// Where clause
var activeUsers = await session.Query<User>()
    .Where(x => x.IsActive)
    .ToListAsync();

// Single result
var admin = await session.Query<User>()
    .FirstOrDefaultAsync(x => x.Role == "Admin");

// Ordering
var sorted = await session.Query<User>()
    .OrderBy(x => x.LastName)
    .ThenBy(x => x.FirstName)
    .ToListAsync();

// Pagination
var page = await session.Query<User>()
    .Skip(20)
    .Take(10)
    .ToListAsync();
```

### String Contains/StartsWith
```csharp
var results = await session.Query<User>()
    .Where(x => x.Email.Contains("@company.com"))
    .ToListAsync();

var byPrefix = await session.Query<User>()
    .Where(x => x.LastName.StartsWith("Mc"))
    .ToListAsync();
```

### Collection Queries
```csharp
var tagged = await session.Query<Issue>()
    .Where(x => x.Tags.Contains("urgent"))
    .ToListAsync();

var withAnyTag = await session.Query<Issue>()
    .Where(x => x.Tags.Any(t => t.StartsWith("bug")))
    .ToListAsync();
```

## Deleting Documents

### By Document
```csharp
session.Delete(user);
await session.SaveChangesAsync();
```

### By ID
```csharp
session.Delete<User>(userId);
await session.SaveChangesAsync();
```

### By Predicate (Bulk Delete)
```csharp
session.DeleteWhere<User>(x => x.IsDeactivated);
await session.SaveChangesAsync();
```

## Identity Map Pattern

```csharp
// With IdentitySession, same document loads once
await using var session = store.IdentitySession();

var user1 = await session.LoadAsync<User>(id);
var user2 = await session.LoadAsync<User>(id);

// user1 and user2 are the SAME instance
Assert.Same(user1, user2);
```

## Dirty Tracking

```csharp
await using var session = store.DirtyTrackedSession();

var user = await session.LoadAsync<User>(id);
user.LastLoginAt = DateTime.UtcNow;  // Modification tracked automatically

// No need to call Store() - changes detected automatically
await session.SaveChangesAsync();
```

## Unit of Work

```csharp
await using var session = store.LightweightSession();

// Queue up multiple operations
session.Store(newUser);
session.Update(existingUser);
session.Delete(oldUser);

// All operations execute in a single transaction
await session.SaveChangesAsync();
```

## Transactions

### Default Behavior
```csharp
// SaveChangesAsync() wraps everything in a transaction
await session.SaveChangesAsync();
```

### Explicit Transaction Control
```csharp
await session.BeginTransactionAsync();
try
{
    session.Store(doc1);
    session.Store(doc2);
    await session.SaveChangesAsync();
}
catch
{
    // Transaction automatically rolls back on dispose
    throw;
}
```

### Serializable Isolation (for Sagas)
```csharp
await using var session = await store.LightweightSerializableSessionAsync(ct);

var saga = await session.LoadAsync<MySaga>(sagaId);
// Work with saga state...
await session.SaveChangesAsync();
```

## Ejecting from Session

### Eject Single Document
```csharp
session.Store(doc1, doc2);
session.Eject(doc2);  // Remove from identity map and pending changes

await session.SaveChangesAsync();  // Only doc1 is saved
```

### Eject All Pending Changes
```csharp
session.Store(doc1, doc2, doc3);
session.EjectAllPendingChanges();  // Clear all pending operations

await session.SaveChangesAsync();  // Nothing saved
```

## ASP.NET Core Integration

### Inject IQuerySession for Read Operations
```csharp
public class GetUserController : ControllerBase
{
    private readonly IQuerySession _session;

    public GetUserController(IQuerySession session) => _session = session;

    [HttpGet("/users/{id}")]
    public Task<User?> Get(Guid id) => _session.LoadAsync<User>(id);
}
```

### Inject IDocumentSession for Writes
```csharp
public class CreateUserController : ControllerBase
{
    private readonly IDocumentSession _session;

    public CreateUserController(IDocumentSession session) => _session = session;

    [HttpPost("/users")]
    public async Task<IActionResult> Post(CreateUserRequest request)
    {
        var user = new User { Name = request.Name };
        _session.Store(user);
        await _session.SaveChangesAsync();
        return Created($"/users/{user.Id}", user);
    }
}
```

## Best Practices

1. **Use `LightweightSession()`**: Default choice for most operations - lowest overhead
2. **Use `QuerySession()` for Reads**: Even lighter than LightweightSession
3. **Batch Operations**: Queue multiple Store/Delete calls, single SaveChangesAsync
4. **Dispose Sessions**: Always use `await using` or `using` for sessions
5. **Prefer Async**: Use `*Async` methods for all I/O operations
6. **Let Wolverine Manage Sessions**: With `AutoApplyTransactions()`, Wolverine handles session lifecycle

## Common Gotchas

- **Identity Not Set**: Marten assigns IDs on `Store()` if using `Guid`/`CombGuid`
- **Session Scope**: Sessions are NOT thread-safe - one per request/handler
- **SaveChanges Required**: Nothing persists until `SaveChangesAsync()` is called
- **AutoCreateSchemaObjects**: Set to `None` in production, use migrations instead
- **Connection Pooling**: Always enable in connection string (default)

````


