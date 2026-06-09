import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  E2E: Quality route integration test                               */
/*                                                                     */
/*  Tests the GET /api/catalog/quality route handler end-to-end by      */
/*  mocking child_process.execFile and verifying the handler produces  */
/*  correct JSON responses for valid and error cases.                  */
/* ------------------------------------------------------------------ */

const mockExecFile = vi.fn();
const mockSendJson = vi.fn();

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(_data?: string) {},
  };
}

function mockCtx(res = mockRes()) {
  return { res };
}

const validReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary: {
    totalSkills: 5,
    skillsWithIssues: 2,
    missingMetadata: 0,
    weakDescriptions: 1,
    duplicateNames: 1,
    duplicateAliases: 0,
    overlappingTriggers: 0,
    purposeOverlaps: 0,
  },
  skills: [
    {
      skillId: 'test-skill',
      name: 'Test Skill',
      sourcePath: 'engine-assets/skills/test/SKILL.md',
      sourceRoot: 'engine-assets',
      description: 'A short desc',
      descriptionLength: 12,
      aliases: [],
      triggers: [],
      diagnostics: [{ kind: 'weak-description', severity: 'warning', message: 'Description is too short' }],
    },
  ],
  overlapClusters: [],
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Catalog quality route (e2e)', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockSendJson.mockReset();
  });

  it('returns 200 with valid JSON report on successful analysis', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, callback: Function) => {
        callback(null, JSON.stringify(validReport), '');
      },
    );

    const deps = {
      childProcess: { execFile: mockExecFile },
      sendJson: mockSendJson,
      path: { resolve: (...args: string[]) => args.join('/') },
      engineRoot: '/test/root',
    };

    // Dynamic import to get the handler from the route module
    const routeModule = await import('../routes/catalog.js');
    const routes = routeModule.register(deps);
    const qualityRoute = routes.find(
      (r: any) => r.method === 'GET' && r.path === '/api/catalog/quality',
    );

    const ctx = mockCtx();
    await qualityRoute.handler(ctx, deps);

    expect(mockSendJson).toHaveBeenCalledTimes(1);
    expect(mockSendJson).toHaveBeenCalledWith(ctx.res, 200, validReport);
  });

  it('returns 422 when analyzer produces invalid JSON', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, callback: Function) => {
        callback(null, 'not valid json {{{', '');
      },
    );

    const deps = {
      childProcess: { execFile: mockExecFile },
      sendJson: mockSendJson,
      path: { resolve: (...args: string[]) => args.join('/') },
      engineRoot: '/test/root',
    };

    const routeModule = await import('../routes/catalog.js');
    const routes = routeModule.register(deps);
    const qualityRoute = routes.find(
      (r: any) => r.method === 'GET' && r.path === '/api/catalog/quality',
    );

    const ctx = mockCtx();
    await qualityRoute.handler(ctx, deps);

    expect(mockSendJson).toHaveBeenCalledTimes(1);
    const callArgs = mockSendJson.mock.calls[0];
    expect(callArgs[0]).toBe(ctx.res);
    expect(callArgs[1]).toBe(422);
    expect(callArgs[2]).toHaveProperty('kind', 'catalog.quality.parse-error');
  });

  it('returns 500 when analyzer execution fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, callback: Function) => {
        callback(new Error('Script not found'), '', 'stderr: ENOENT');
      },
    );

    const deps = {
      childProcess: { execFile: mockExecFile },
      sendJson: mockSendJson,
      path: { resolve: (...args: string[]) => args.join('/') },
      engineRoot: '/test/root',
    };

    const routeModule = await import('../routes/catalog.js');
    const routes = routeModule.register(deps);
    const qualityRoute = routes.find(
      (r: any) => r.method === 'GET' && r.path === '/api/catalog/quality',
    );

    const ctx = mockCtx();
    await qualityRoute.handler(ctx, deps);

    expect(mockSendJson).toHaveBeenCalledTimes(1);
    const callArgs = mockSendJson.mock.calls[0];
    expect(callArgs[0]).toBe(ctx.res);
    expect(callArgs[1]).toBe(500);
    expect(callArgs[2]).toHaveProperty('kind', 'catalog.quality.exec-error');
    expect(callArgs[2]).toHaveProperty('error', 'Quality analysis failed');
  });

  it('passes --no-write-md flag to the analyzer script', async () => {
    let capturedArgs: string[] = [];
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], _opts: any, callback: Function) => {
        capturedArgs = args;
        callback(null, JSON.stringify(validReport), '');
      },
    );

    const deps = {
      childProcess: { execFile: mockExecFile },
      sendJson: mockSendJson,
      path: { resolve: (...args: string[]) => args.join('/') },
      engineRoot: '/test/root',
    };

    const routeModule = await import('../routes/catalog.js');
    const routes = routeModule.register(deps);
    const qualityRoute = routes.find(
      (r: any) => r.method === 'GET' && r.path === '/api/catalog/quality',
    );

    const ctx = mockCtx();
    await qualityRoute.handler(ctx, deps);

    expect(capturedArgs).toContain('--no-write-md');
  });

  it('registers the quality route in the route table', async () => {
    const deps = {
      childProcess: { execFile: mockExecFile },
      sendJson: mockSendJson,
      path: { resolve: (...args: string[]) => args.join('/') },
      engineRoot: '/test/root',
    };

    const routeModule = await import('../routes/catalog.js');
    const routes = routeModule.register(deps);

    const qualityRoute = routes.find(
      (r: any) => r.method === 'GET' && r.path === '/api/catalog/quality',
    );
    expect(qualityRoute).toBeDefined();
    expect(qualityRoute.method).toBe('GET');
    expect(qualityRoute.path).toBe('/api/catalog/quality');
    expect(typeof qualityRoute.handler).toBe('function');
  });
});
