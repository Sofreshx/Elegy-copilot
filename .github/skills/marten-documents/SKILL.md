---
name: marten-documents
description: "Marten document database. PostgreSQL document store with LINQ queries. Use this when asked to work with Marten queries, document store operations, storing or querying documents in Marten."
---

# Marten Document Database Skill

## Purpose
Marten turns PostgreSQL into a document database and event store with LINQ support.

## Core Concepts & Sessions

| Concept | Description |
|---------|-------------|
| **IDocumentStore** | Root object, creates sessions, manages schema. |
| **IQuerySession** | Read-only, no tracking. Fastest for reads. |
| **IDocumentSession** | Read/write unit of work. |
| **LightweightSession** | Read/write, no tracking. Default choice. |
| **IdentitySession** | Read/write, identity map (caching). |
| **DirtyTrackedSession** | Read/write, auto-change detection. |

## Configuration

```csharp
// Basic
builder.Services.AddMarten(opts => {
    opts.Connection(connString);
    opts.AutoCreateSchemaObjects = AutoCreate.All; // Dev only
});

// With Wolverine
builder.Host.UseWolverine(opts => {
    opts.Policies.AutoApplyTransactions(); // Wolverine manages sessions
    opts.UseMartenForPersistence();
});
```

## Basic Operations

```csharp
await using var session = store.LightweightSession(); // Or store.QuerySession() for reads

// Load
var user = await session.LoadAsync<User>(userId);
var users = await session.LoadManyAsync<User>(id1, id2);

// Query
var active = await session.Query<User>().Where(x => x.IsActive).ToListAsync();
var sorted = await session.Query<User>().OrderBy(x => x.Name).Skip(10).Take(10).ToListAsync();

// Store (Upsert) / Insert / Update
session.Store(new User { Name = "Jane" });
session.Insert(newUser); // Throws if exists
session.Update(existing); // Throws if missing
await store.BulkInsertAsync(users);

// Delete
session.Delete(user);
session.Delete<User>(userId);
session.DeleteWhere<User>(x => x.IsDeactivated);

// Save (Transaction)
await session.SaveChangesAsync();
```

## Common Filtering Patterns

### LINQ Translation: Prefer Simple Predicates
Marten translates a subset of LINQ. Some expression shapes can compile in C# but fail at runtime if they cannot be translated.

Practical rule: keep predicates simple, and when debugging a translation failure, consider collapsing conditions into a single predicate to isolate what Marten can translate.

For deeper guidance on supported operators, `Include()`, child collections (`Any/Contains` constraints), pagination, and async enumeration, use: `.github/skills/marten-linq-querying/SKILL.md`.

### Filtering Examples
```csharp
// String Operations (Case-insensitive by default)
var matches = await session.Query<User>()
    .Where(x => x.Email.Contains("@company.com") && x.Name.StartsWith("Mc"))
    .ToListAsync();

// Collection/Array Containment
var tagged = await session.Query<Issue>()
    .Where(x => x.Tags.Contains("urgent")) // Array contains value
    .ToListAsync();

// Collection Properties
var hasBugTag = await session.Query<Issue>()
    .Where(x => x.Tags.Any(t => t.StartsWith("bug"))) // Any item matches
    .ToListAsync();

// Complex Boolean Logic
var complex = await session.Query<User>()
    .Where(x => x.IsActive && (x.Role == "Admin" || x.Role == "Mod"))
    .ToListAsync();
```

## Advanced Features

- **Identity Map**: `IdentitySession` ensures same instance for same ID.
- **Dirty Tracking**: `DirtyTrackedSession` detects changes without explicit `Store()`.
- **Ejecting**: `session.Eject(doc)` removes from tracking.
- **Direct JSON**: `session.Json.WriteById<User>(id, context)` writes directly to HTTP response.

## LINQ Limitations & Workarounds

Marten translates LINQ to SQL. Some C# expressions (nested `Where`, `??` in `OrderBy`) fail translation.

| Issue | Solution | Example |
|-------|----------|---------|
| `??` in `OrderBy` | Use `OrderBySql` + `COALESCE` | `.OrderBySql("COALESCE((data->>'Likes')::int, 0)")` |
| Chained `.Where` | Combine into single `.Where` | `.Where(x => x.A && x.B)` instead of `.Where(A).Where(B)` |
| Complex Select | Materialize then transform | `.ToListAsync()` then `.Select()` |
| String Interpolation | Use variables | `.Where(x => x.Name == searchVar)` |

## Best Practices

1. **Default to `LightweightSession()`** for writes, `QuerySession()` for reads.
2. **Batch Operations**: Multiple `Store`/`Delete` calls share one `SaveChangesAsync()` transaction.
3. **Wolverine Integration**: Let Wolverine manage session lifecycle and transactions.
4. **Avoid Complex LINQ**: Keep `Where` clauses simple or use `OrderBySql` for complex sorting.
5. **Production Schema**: Set `AutoCreateSchemaObjects = None` and use migrations.


