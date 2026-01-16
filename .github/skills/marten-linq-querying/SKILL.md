---
name: marten-linq-querying
description: >
  
Marten LINQ querying (documents). Prevent queries that compile but fail at runtime. Use this when writing/debugging Marten LINQ filters, Include(), child collection queries, pagination, Stats(), or async enumeration.
  Triggers on: "Marten LINQ", "NotSupportedException", "Include()", "child collections", "Any", "Contains", "pagination", "Skip", "Take", "OrderBy", "Stats".
---

# Marten LINQ Querying Skill

## Purpose
Marten translates a supported subset of LINQ into PostgreSQL/JSONB queries. Some queries will **compile** in C# but **fail at runtime** (or behave differently than expected) if they use unsupported operators or unsupported expression shapes.

This skill is a checklist and set of safe patterns for:
- Filtering and supported operators
- Includes (related document loading)
- Child collection querying (Any/Contains)
- Pagination and total counts
- Async streaming with `ToAsyncEnumerable()`

## Primary Rules (High Signal)
1. Prefer **supported operators** only; avoid operators Marten does not translate (example: `GroupBy()` is not supported).
2. For pagination, always apply a **stable `OrderBy(...)`** before `Skip/Take` to keep paging deterministic.
3. Do not return `IAsyncEnumerable<T>` produced from Marten outside the **session lifetime**; consume it within the session scope to avoid connection bleed.
4. If you hit a runtime translation error, reduce the query to the simplest supported subset, then re-add filters one at a time.

## Quick “Does This Translate?” Triage
When a query compiles but fails at runtime:
1. Identify the first failing LINQ operator in the chain.
2. Compare it to Marten’s supported LINQ operators list.
3. Simplify the predicate shape (avoid complex nested expressions), then retry.
4. If you truly need unsupported behavior, switch to Marten’s raw/advanced SQL features instead of trying to force LINQ.

## Operators and Translation Limits
- Marten supports many common LINQ operators (Where/Any/Contains/etc), but **not all**.
- `GroupBy()` is explicitly not supported and will fail.

If someone proposes “clever” LINQ (especially with nested subqueries), assume it may compile but not translate.

## Filtering Patterns (Safe Defaults)
### Basic filters
Use comparisons and boolean logic inside a predicate.

### “IN” / One-of filters
Prefer Marten helpers like `IsOneOf()` / `In()` for one-of matching rather than relying on arbitrary expression shapes.

## Child Collections (Any / Contains)
Child-collection querying is powerful, but it has documented constraints.

### Critical constraint: `Contains()` inside `Any()`
Marten only supports specific shapes when doing something like “any element is in a set”. In particular, the docs call out limitations when `Contains()` is used within an `Any()` subquery:
- It only supports constant arrays of `string` or `Guid` expressions
- Both the document property and the compared values must be arrays

If a query like this compiles but throws at runtime, rewrite it to match the supported shape, or use Marten’s supported helpers.

## Includes (`Include()`)
Use `Include()` to load related documents while querying root documents.

Important behaviors from the docs:
- `Include()` is not implemented as SQL `JOIN` clauses (since V4), but still fetches related documents in a single database call.
- You can filter included documents (as of V7), but you cannot sort included documents server-side; sort included docs in memory if needed.
- Missing included documents do not prevent root documents from being returned (left-join-like behavior).

## Pagination and Total Counts
### Deterministic paging
Always order before paginating:
- Stable ordering: `OrderBy(x => x.Id)` or a domain-specific timestamp + tie-breaker
- Then: `Skip(page * pageSize).Take(pageSize)`

### Prefer `ToPagedListAsync` when you need totals
Use `ToPagedListAsync(pageNumber, pageSize)` when you need page metadata + total counts.

Performance note:
- By default, Marten uses a window-function strategy (`count(*) OVER()` / `Stats()`-style) to compute totals.
- On very large datasets, prefer `ToPagedListAsync(..., useCountQuery: true)` to use a separate count query when the default strategy is slow.

### `Stats()` caveat
`Stats()` can be combined with includes and batch queries, but (per docs) it is not supported inside compiled queries.

## Async Enumeration (`ToAsyncEnumerable()`)
`ToAsyncEnumerable()` is supported for streaming large result sets.

Critical: do not let the async enumerable outlive the session. Consume the results fully inside the session scope to avoid holding/bleeding database connections.

## Troubleshooting Checklist
When a query fails at runtime:
1. Replace the query body with a known-good baseline: `session.Query<T>()` + simple `Where`.
2. Add conditions back one-by-one until it fails.
3. If failure involves child collections, validate the query matches the documented `Any/Contains` constraints.
4. If you are paging, ensure `OrderBy` happens before `Skip/Take`.
5. If you are including related docs, remove Include and re-add once the root query translates.
6. If it still won’t translate, stop fighting LINQ and use raw/advanced SQL.

## Sources
- https://martendb.io/documents/querying/linq/
- https://martendb.io/documents/querying/linq/operators.html
- https://martendb.io/documents/querying/linq/child-collections.html
- https://martendb.io/documents/querying/linq/include.html
- https://martendb.io/documents/querying/linq/async-enumerable.html
- https://martendb.io/documents/querying/linq/paging
- https://martendb.io/llms-full.txt
