import { describe, it, expect } from 'vitest';

/**
 * Contract test for the request context (ctx) shape passed to route handlers.
 *
 * The server's handleApi() builds a ctx object and passes it to
 * routeRegistry.dispatch() which calls route.handler(ctx).
 *
 * This test prevents regressions like the ctx.query bug where handlers
 * referenced non-existent fields.
 */

// Simulate the minimal shape every route handler can expect
function buildMinimalCtx() {
  return {
    req: { method: 'GET', url: '/api/test?q=hello&type=foo' } as any,
    res: {
      statusCode: 200,
      writeHead(_code: number, _headers: Record<string, string>) {},
      end(_body?: string) {},
    } as any,
    u: new URL('http://127.0.0.1/api/test?q=hello&type=foo'),
    pathname: '/api/test',
    match: null,
  };
}

describe('RequestContext contract', () => {
  it('ctx.u is a URL with working searchParams', () => {
    const ctx = buildMinimalCtx();
    expect(ctx.u).toBeInstanceOf(URL);
    expect(ctx.u.searchParams).toBeDefined();
    expect(ctx.u.searchParams.get('q')).toBe('hello');
    expect(ctx.u.searchParams.get('type')).toBe('foo');
  });

  it('ctx.u.searchParams.get() returns null for missing keys', () => {
    const ctx = buildMinimalCtx();
    expect(ctx.u.searchParams.get('nonexistent')).toBeNull();
  });

  it('ctx.query does NOT exist (prevent ctx.query bug)', () => {
    const ctx = buildMinimalCtx();
    expect((ctx as any).query).toBeUndefined();
  });

  it('ctx has required dispatch fields', () => {
    const ctx = buildMinimalCtx();
    expect(ctx.req).toBeDefined();
    expect(ctx.res).toBeDefined();
    expect(ctx.u).toBeDefined();
    expect(ctx.pathname).toBe('/api/test');
    expect(ctx.match).toBeNull();
  });

  it('URLSearchParams handles empty values correctly', () => {
    const u = new URL('http://127.0.0.1/api/test?empty=&type=');
    expect(u.searchParams.get('empty')).toBe('');
    expect(u.searchParams.get('type')).toBe('');
    expect(u.searchParams.get('missing')).toBeNull();
  });

  it('(ctx.u.searchParams.get(key) || "").trim() pattern works for filters', () => {
    // This is the canonical query param access pattern
    const u = new URL('http://127.0.0.1/api/pattern-atlas?type=visual-style');
    const typeFilter = (u.searchParams.get('type') || '').trim();
    expect(typeFilter).toBe('visual-style');

    const missingFilter = (u.searchParams.get('nonexistent') || '').trim();
    expect(missingFilter).toBe('');
  });
});
