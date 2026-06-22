import { describe, it, expect, beforeAll } from 'vitest';
import patternAtlas from './patternAtlas.js';
const { register } = patternAtlas;

/**
 * Contract test for GET /api/pattern-atlas route handler.
 *
 * Verifies:
 * - Filter query parameters are read correctly via u.searchParams
 * - Response shape matches the frontend contract
 * - No crash when accessing detail fields like commonFailures/traits
 */

function buildCtx(queryString = '') {
  const url = `http://127.0.0.1/api/pattern-atlas${queryString}`;
  const u = new URL(url);
  const chunks = [];
  const res = {
    statusCode: 200,
    _headers: {},
    _body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      this._headers = headers;
    },
    end(body) {
      this._body = body || '';
    },
  };
  return { req: { method: 'GET', url }, res, u, pathname: '/api/pattern-atlas', match: null };
}

function parseBody(res) {
  return JSON.parse(res._body);
}

describe('GET /api/pattern-atlas', () => {
  let routes;
  let handler;

  beforeAll(() => {
    routes = register();
    handler = routes[0].handler;
    expect(routes[0].method).toBe('GET');
    expect(routes[0].path).toBe('/api/pattern-atlas');
  });

  it('returns entries and filters when no query params', () => {
    const ctx = buildCtx();
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries).toBeInstanceOf(Array);
    expect(body.total).toBeGreaterThan(0);
    expect(body.filteredTotal).toBe(body.entries.length);
    expect(body.filters).toBeDefined();
    expect(body.filters.types).toBeInstanceOf(Array);
    expect(body.filters.domains).toBeInstanceOf(Array);
    expect(body.filters.tags).toBeInstanceOf(Array);
  });

  it('filters entries by type query parameter', () => {
    const ctx = buildCtx('?type=visual-style');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.type).toBe('visual-style');
    }
    expect(body.filteredTotal).toBeLessThan(body.total);
  });

  it('filters entries by domain query parameter', () => {
    const ctx = buildCtx('?domain=ui-ux');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.domain).toBe('ui-ux');
    }
  });

  it('filters entries by confidence query parameter', () => {
    const ctx = buildCtx('?confidence=established');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.confidence).toBe('established');
    }
  });

  it('filters by search query', () => {
    const ctx = buildCtx('?q=gateway');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries.length).toBeGreaterThan(0);
    // Search should include the API Gateway entry
    const names = body.entries.map(e => e.name.toLowerCase());
    expect(names.some(n => n.includes('gateway'))).toBe(true);
  });

  it('combines multiple filters', () => {
    const ctx = buildCtx('?type=system-pattern&domain=software-architecture');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    for (const entry of body.entries) {
      expect(entry.type).toBe('system-pattern');
      expect(entry.domain).toBe('software-architecture');
    }
  });

  it('entries have all required fields', () => {
    const ctx = buildCtx();
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(body.entries.length).toBeGreaterThan(0);
    const entry = body.entries[0];
    expect(entry.id).toEqual(expect.any(String));
    expect(entry.name).toEqual(expect.any(String));
    expect(entry.type).toEqual(expect.any(String));
    expect(entry.domain).toEqual(expect.any(String));
    expect(entry.confidence).toEqual(expect.any(String));
    expect(entry.tagline).toEqual(expect.any(String));
    expect(entry.traits).toBeInstanceOf(Array);
    expect(entry.tags).toBeInstanceOf(Array);
    expect(entry.aliases).toBeInstanceOf(Array);
    expect(entry.bestFit).toBeInstanceOf(Array);
    expect(entry.avoidIf).toBeInstanceOf(Array);
    expect(entry.commonFailures).toBeInstanceOf(Array);
    expect(entry.contrasts).toBeInstanceOf(Array);
    expect(entry.compatibilities).toBeInstanceOf(Array);
    expect(entry.sources).toBeInstanceOf(Array);
  });

  it('commonFailures items are strings (not YAML colon-space objects)', () => {
    const ctx = buildCtx();
    handler(ctx);
    const body = parseBody(ctx.res);
    // Find an entry with commonFailures
    const entry = body.entries.find(e => e.commonFailures.length > 0);
    expect(entry).toBeDefined();
    for (const item of entry.commonFailures) {
      expect(typeof item).toBe('string');
    }
  });

  it('traits items are strings (not YAML colon-space objects)', () => {
    const ctx = buildCtx();
    handler(ctx);
    const body = parseBody(ctx.res);
    const entry = body.entries.find(e => e.traits.length > 0);
    expect(entry).toBeDefined();
    for (const item of entry.traits) {
      expect(typeof item).toBe('string');
    }
  });

  it('empty type filter returns no results for non-matching type', () => {
    const ctx = buildCtx('?type=nonexistent-type-xyz');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.entries.length).toBe(0);
    expect(body.filteredTotal).toBe(0);
  });

  it('response always includes filters metadata', () => {
    const ctx = buildCtx('?q=nonexistentsearchxyz123');
    handler(ctx);
    const body = parseBody(ctx.res);
    expect(ctx.res.statusCode).toBe(200);
    expect(body.filters.types.length).toBeGreaterThan(0);
    expect(body.filters.domains.length).toBeGreaterThan(0);
  });
});
