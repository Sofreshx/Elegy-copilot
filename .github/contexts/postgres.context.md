---
description: "Context: PostgreSQL database standards."
---

# PostgreSQL Context

## Overview
Relational database engine used for persistence.

## Standards
- **Naming**: `snake_case` for tables and columns.
- **Primary Keys**: `id` (UUID or BIGINT).
- **Foreign Keys**: `[table]_id`.
- **Indexes**: Create indexes on foreign keys and frequently queried columns.

## Extensions
- `uuid-ossp`: For UUID generation.
- `pg_trgm`: For text search.
- `vector`: For AI embeddings (if applicable).

## Migration
- Use migration scripts (e.g., Flyway, DbUp, or EF Core Migrations).
- Never modify schema manually in production.
