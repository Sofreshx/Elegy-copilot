---
name: marten-documents
description: "Marten document database. PostgreSQL document store with LINQ queries. Use this when asked to work with Marten queries, document store operations, storing or querying documents in Marten."
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

## LINQ Query Limitations & Workarounds

Marten translates LINQ to SQL, but not all C# expressions are supported. Here are the most common issues and their solutions:

### ❌ DON'T: Null-Coalescing Operator (??) in OrderBy

**Problem**: Marten cannot translate `??` operator in `OrderBy()` expressions.

```csharp
// ❌ THROWS BadLinqExpressionException
var results = await session.Query<Question>()
    .OrderBy(q => q.Likes ?? 0)
    .ToListAsync();

// ❌ THROWS BadLinqExpressionException
var results = await session.Query<Question>()
    .OrderBy(q => (q.Likes ?? 0) - (q.Dislikes ?? 0))
    .ToListAsync();
```

**Solution**: Use `.OrderBySql()` with PostgreSQL `COALESCE()` function.

```csharp
// ✅ WORKS: Order by Likes with null as 0
var results = await session.Query<Question>()
    .OrderBySql("COALESCE((data->>'Likes')::int, 0)")
    .ToListAsync();

// ✅ WORKS: Order descending
var results = await session.Query<Question>()
    .OrderBySql("COALESCE((data->>'Likes')::int, 0) DESC")
    .ToListAsync();

// ✅ WORKS: Computed expression (ReactionScore = Likes - Dislikes)
var results = await session.Query<Question>()
    .OrderBySql("(COALESCE((data->>'Likes')::int,0) - COALESCE((data->>'Dislikes')::int,0)) DESC")
    .ToListAsync();
```

### ❌ DON'T: Chain Multiple `.Where()` with Complex Expressions

**Problem**: Chaining `.Where()` calls can create nested AND operators that Marten cannot parse.

```csharp
// ❌ THROWS BadLinqExpressionException: Unsupported nested operator 'And'
var results = await session.Query<QuestionCollection>()
    .Where(Filtering.IsPublished())  // Expression with bitwise flags
    .Where(c => c.LanguageCode == "en")
    .Where(c => !c.Metadata.IsSoftDeleted)
    .ToListAsync();
```

**Solution**: Combine all conditions into a single `.Where()` clause.

```csharp
// ✅ WORKS: Single Where with compound boolean expression
var results = await session.Query<QuestionCollection>()
    .Where(c => 
        (c.Section & QuestionCollectionSections.Published) == QuestionCollectionSections.Published
        && c.LanguageCode == "en"
        && !c.Metadata.IsSoftDeleted)
    .ToListAsync();
```

### ❌ DON'T: Conditional Expressions in Select/OrderBy

**Problem**: Ternary operators and complex conditionals in projections often fail.

```csharp
// ❌ MAY THROW BadLinqExpressionException
var results = await session.Query<User>()
    .Select(u => new { Name = u.Name ?? "Unknown" })
    .ToListAsync();
```

**Solution**: Use `.OrderBySql()` or post-process after materialization.

```csharp
// ✅ WORKS: Use SQL directly for complex ordering
var results = await session.Query<User>()
    .OrderBySql("CASE WHEN data->>'Name' IS NULL THEN 'Unknown' ELSE data->>'Name' END")
    .ToListAsync();

// ✅ WORKS: Materialize first, then transform
var results = await session.Query<User>()
    .ToListAsync();
var transformed = results.Select(u => new { Name = u.Name ?? "Unknown" });
```

### ❌ DON'T: String Interpolation in Where Clauses

**Problem**: String interpolation in LINQ expressions doesn't parameterize correctly.

```csharp
// ❌ DANGEROUS: SQL Injection risk
var search = userInput;
var results = await session.Query<User>()
    .Where(u => u.Name == $"{search}")  // Not parameterized!
    .ToListAsync();
```

**Solution**: Use variables directly or `.Where()` with captured variables.

```csharp
// ✅ WORKS: Direct variable reference (automatically parameterized)
var search = userInput;
var results = await session.Query<User>()
    .Where(u => u.Name == search)
    .ToListAsync();
```

### Supported LINQ Operations

These LINQ operations are **fully supported** and translate efficiently:

```csharp
// ✅ Basic comparisons
.Where(x => x.Status == "Active")
.Where(x => x.Age > 18)
.Where(x => x.CreatedAt <= DateTimeOffset.UtcNow)

// ✅ Boolean logic (in single Where)
.Where(x => x.IsActive && x.IsVerified)
.Where(x => x.Role == "Admin" || x.Role == "Owner")

// ✅ String operations
.Where(x => x.Email.Contains("@gmail.com"))
.Where(x => x.Name.StartsWith("John"))
.Where(x => x.Tags.Contains("urgent"))

// ✅ Collection operations
.Where(x => x.Tags.Any(t => t.StartsWith("bug")))
.Where(x => x.Items.Count() > 5)

// ✅ Simple ordering
.OrderBy(x => x.CreatedAt)
.OrderByDescending(x => x.UpdatedAt)

// ✅ Pagination
.Skip(20).Take(10)

// ✅ Aggregates
.CountAsync()
.AnyAsync(x => x.IsActive)
```

### When to Use Raw SQL

For very complex queries, consider using Marten's raw SQL support:

```csharp
// Complex computed columns or aggregations
var results = await session.QueryAsync<Question>(
    "SELECT data FROM mt_doc_question WHERE (data->>'Likes')::int > 10 ORDER BY (data->>'CreatedAt')::timestamp DESC");
```

## Common Gotchas

- **Identity Not Set**: Marten assigns IDs on `Store()` if using `Guid`/`CombGuid`
- **Session Scope**: Sessions are NOT thread-safe - one per request/handler
- **SaveChanges Required**: Nothing persists until `SaveChangesAsync()` is called
- **AutoCreateSchemaObjects**: Set to `None` in production, use migrations instead
- **Connection Pooling**: Always enable in connection string (default)
- **Chained Where Clauses**: Avoid chaining multiple `.Where()` calls with complex expressions - combine into one
- **Null-Coalescing in OrderBy**: Use `.OrderBySql()` with `COALESCE()` instead of `??` operator

````


