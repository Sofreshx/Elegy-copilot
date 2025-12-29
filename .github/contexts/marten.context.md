---
description: "Context: Marten DB configuration and patterns."
---

# Marten Context

## Overview
Marten is a .NET Transactional Document DB and Event Store on PostgreSQL.

## Configuration
- **Connection**: `ConnectionStrings:Marten` (User Secrets).
- **Schema**: `public` (default) or tenant-specific.
- **Mode**: `AutoCreate.All` (Dev), `AutoCreate.None` (Prod).

## Patterns
- **Document Session**: Use `IDocumentSession` for unit of work.
- **Event Sourcing**: Use `IEventStore` to append events.
- **Projections**:
  - `SingleStreamProjection`: Aggregates a single stream.
  - `MultiStreamProjection`: Aggregates across streams.
  - `ViewProjection`: Flat table projection.

## Best Practices
- Use `[Identity]` attribute for custom IDs.
- Use `session.SaveChangesAsync()` for atomic commits.
- Avoid `session.SaveChanges()` (sync) in async flows.
