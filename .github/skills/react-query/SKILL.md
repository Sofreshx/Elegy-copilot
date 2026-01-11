---
name: react-query
description: "TanStack React Query conventions for this org: prevent 'Query data cannot be undefined', standardize empty-state vs error handling, and guide openapi-fetch/openapi-react-query usage. Use this when working with useQuery/useMutation, query keys, enabled gating, or debugging React Query runtime errors."
---

# React Query (TanStack) Skill

## Primary Rule: `queryFn` must never resolve to `undefined`
React Query treats `undefined` as a programmer error for resolved query results.

**Allowed outcomes**
- Return a real value (object/array/primitive)
- Return `null` for expected absence / empty state
- `throw` for real errors

**Common ways `undefined` sneaks in**
- Falling off the end of an `async` function (missing `return`)
- A `.catch(() => {})` handler that returns nothing
- Status-specific branches (404/204/401) that don’t return a value
- Using wrappers that hide `undefined` return paths

## Endpoint Semantics: decide “empty state” vs “error”
Typical conventions:
- **Stats/profile**: `404` means "no data yet" → return `null` and render empty state
- **Auth/session**: `401` means "expired" → handle with sign-in/refresh UX (either return typed value if your UI expects it, or throw a typed error you handle centrally)
- **Everything else**: treat as error → throw

## Recommended Pattern: `openapi-fetch` + explicit status mapping
Prefer direct `openapi-fetch` calls for endpoints with known 404/401/204 semantics.

```ts
import { useQuery } from '@tanstack/react-query';

type StatusError = Error & { status?: number; error?: unknown };

return useQuery<T | null, StatusError>({
  queryKey: ['feature', id],
  enabled: !!id,
  queryFn: async () => {
    const { data, error, response } = await client.GET('/path', {
      params: { /* ... */ },
    });

    // Expected absence (pick semantics per endpoint)
    if (response?.status === 404) return null;

    // No Content: treat as empty state unless endpoint guarantees body
    if (response?.status === 204) return null;

    if (!response?.ok || error) {
      const err: StatusError = Object.assign(new Error('Failed to fetch feature'), {
        status: response?.status,
        error,
      });
      throw err;
    }

    // Ensure we never return undefined
    return data ?? null;
  },
});
```

## When to avoid `openapi-react-query` wrappers
`openapi-react-query` is convenient, but wrappers can obscure edge-cases and produce `undefined` results (or treat 404 inconsistently), which then triggers runtime errors.

Prefer `openapi-fetch + useQuery` when:
- You need **explicit 404/401/204 behavior**
- The endpoint returns **optional/nullable** data
- You’ve seen “Query data cannot be undefined” for that callsite

## Query Keys: stable and specific
- Always include identity/params in the key: `['user-stats', 'profile', userId]`
- Avoid keys that omit inputs (causes cache collisions)

## Use `enabled` to prevent invalid calls
- Gate queries on required params and auth readiness: `enabled: !!userId && isAuthed`
- Reduces noisy 400/401s and cache pollution

## Prefer `null` over throwing for expected absence
If the UI has a friendly empty state, returning `null` keeps the query in `success` state and avoids error UI flashes.

## Debug checklist: “Query data cannot be undefined”
- Ensure every codepath `return`s `T | null` (never falls through)
- Look for `.catch(() => {})` and missing `return` in catch blocks
- Inspect 404/204 branches: return `null` explicitly
- If using `openapi-react-query`, switch the callsite to `openapi-fetch + useQuery`
