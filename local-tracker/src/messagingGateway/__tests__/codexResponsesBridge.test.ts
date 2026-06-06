import http from 'http';

import { CodexResponsesBridgeServer } from '../codexResponsesBridge';

function makeRequest(
  port: number,
  options: {
    method?: string;
    path: string;
    body?: string;
    token?: string;
    headers?: Record<string, string>;
  },
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: data,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('CodexResponsesBridgeServer', () => {
  let server: CodexResponsesBridgeServer;
  let port: number;
  const fetchMock = jest.fn();

  beforeAll(async () => {
    server = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: fetchMock as typeof fetch,
      defaultModel: 'kimi-k2.6',
    });
    await server.start();
    port = server.getPort() || 0;
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    delete process.env.OPENCODE_GO_API_KEY;
  });

  it('GET /v1/models returns the alias plus supported routed models', async () => {
    const res = await makeRequest(port, { path: '/v1/models' });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    const ids = payload.data.map((entry: { id: string }) => entry.id);
    expect(ids).toContain('opencode-go');
    expect(ids).toContain('opencode-go/kimi-k2.6');
    expect(ids).toContain('kimi-k2.6');
  });

  it('POST /v1/responses translates a text response into Responses format', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_123',
        created: 123,
        model: 'kimi-k2.6',
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'Hello from OpenCode Go',
          },
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
        },
      }),
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      token: 'go-key',
      body: JSON.stringify({
        model: 'opencode-go',
        input: 'Hello',
      }),
    });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.object).toBe('response');
    expect(payload.model).toBe('kimi-k2.6');
    expect(payload.output[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
    });
    expect(payload.output[0].content[0]).toEqual({
      type: 'output_text',
      text: 'Hello from OpenCode Go',
      annotations: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('POST /v1/responses translates function calls into Responses output items', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_tool',
        created: 123,
        model: 'kimi-k2.6',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'run_command',
                arguments: '{"command":"git status"}',
              },
            }],
          },
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      }),
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      token: 'go-key',
      body: JSON.stringify({
        model: 'opencode-go',
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: 'Run git status' }],
        }],
        tools: [{
          type: 'function',
          name: 'run_command',
          description: 'Runs a shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.output).toHaveLength(1);
    expect(payload.output[0]).toMatchObject({
      type: 'function_call',
      call_id: 'call_1',
      name: 'run_command',
      arguments: '{"command":"git status"}',
    });
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(upstreamBody.tools).toEqual([{ type: 'function', function: {
      name: 'run_command',
      description: 'Runs a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    } }]);
  });

  it('POST /v1/responses supports previous_response_id with function_call_output continuation', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({
          id: 'chatcmpl_tool',
          created: 123,
          model: 'kimi-k2.6',
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'run_command',
                  arguments: '{"command":"git status"}',
                },
              }],
            },
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({
          id: 'chatcmpl_done',
          created: 124,
          model: 'kimi-k2.6',
          choices: [{
            finish_reason: 'stop',
            message: {
              content: 'Tool completed.',
            },
          }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 3,
            total_tokens: 15,
          },
        }),
      });

    const first = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      token: 'go-key',
      body: JSON.stringify({ model: 'opencode-go', input: 'Run git status' }),
    });
    const firstPayload = JSON.parse(first.body);

    const second = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      token: 'go-key',
      body: JSON.stringify({
        model: 'opencode-go',
        previous_response_id: firstPayload.id,
        input: [{
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"stdout":"clean"}',
        }],
      }),
    });

    expect(second.statusCode).toBe(200);
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(upstreamBody.messages).toEqual([
      { role: 'user', content: 'Run git status' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'run_command',
            arguments: '{"command":"git status"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: '{"stdout":"clean"}',
      },
    ]);
  });

  it('POST /v1/responses streams semantic Responses events', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_stream',
        created: 123,
        model: 'kimi-k2.6',
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'Hello stream',
          },
        }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      }),
    });

    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/responses',
          method: 'POST',
          headers: {
            Authorization: 'Bearer go-key',
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
          });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ model: 'opencode-go', input: 'Hi', stream: true }));
      req.end();
    });

    expect(responseBody).toContain('event: response.created');
    expect(responseBody).toContain('event: response.output_item.added');
    expect(responseBody).toContain('event: response.output_text.delta');
    expect(responseBody).toContain('event: response.output_text.done');
    expect(responseBody).toContain('event: response.completed');
  });

  it('POST /v1/responses returns OpenAI-style errors for unsupported models', async () => {
    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      token: 'go-key',
      body: JSON.stringify({
        model: 'opencode-go/minimax-m2.7',
        input: 'Hello',
      }),
    });

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.body);
    expect(payload.error.message).toContain('not supported by the Codex Responses bridge');
  });

  it('POST /v1/responses uses OPENCODE_GO_API_KEY env fallback when Authorization is absent', async () => {
    process.env.OPENCODE_GO_API_KEY = 'env-fallback-key';
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_env',
        created: 123,
        model: 'kimi-k2.6',
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'Hello from env auth',
          },
        }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/responses',
      body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer env-fallback-key',
    });
  });
});

describe('CodexResponsesBridgeServer with resolveOpencodeGoApiKey', () => {
  let port = 0;

  beforeAll(async () => {
    delete process.env.OPENCODE_GO_API_KEY;
  });

  it('uses the resolver result over env when no Authorization header is present', async () => {
    process.env.OPENCODE_GO_API_KEY = 'should-not-be-used';
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_resolver',
        created: 1,
        model: 'kimi-k2.6',
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const resolverServer = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: fetchMock as typeof fetch,
      defaultModel: 'kimi-k2.6',
      resolveOpencodeGoApiKey: () => 'keychain-active-key',
    });
    await resolverServer.start();
    port = resolverServer.getPort() || 0;
    try {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/v1/responses',
        body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
      });
      expect(res.statusCode).toBe(200);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer keychain-active-key',
      });
    } finally {
      await resolverServer.stop();
    }
  });

  it('falls back to OPENCODE_GO_API_KEY env when resolver returns null', async () => {
    process.env.OPENCODE_GO_API_KEY = 'env-fallback-key';
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_env_only',
        created: 1,
        model: 'kimi-k2.6',
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const resolverServer = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: fetchMock as typeof fetch,
      defaultModel: 'kimi-k2.6',
      resolveOpencodeGoApiKey: () => null,
    });
    await resolverServer.start();
    port = resolverServer.getPort() || 0;
    try {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/v1/responses',
        body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
      });
      expect(res.statusCode).toBe(200);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer env-fallback-key',
      });
    } finally {
      await resolverServer.stop();
    }
  });

  it('prefers bearer token over resolver and env', async () => {
    process.env.OPENCODE_GO_API_KEY = 'env-fallback-key';
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_bearer',
        created: 1,
        model: 'kimi-k2.6',
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const resolverServer = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: fetchMock as typeof fetch,
      defaultModel: 'kimi-k2.6',
      resolveOpencodeGoApiKey: () => 'resolver-key',
    });
    await resolverServer.start();
    port = resolverServer.getPort() || 0;
    try {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/v1/responses',
        token: 'bearer-key',
        body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
      });
      expect(res.statusCode).toBe(200);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer bearer-key',
      });
    } finally {
      await resolverServer.stop();
    }
  });

  it('returns 401 when resolver and env both yield no key', async () => {
    delete process.env.OPENCODE_GO_API_KEY;
    const resolverServer = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: jest.fn() as typeof fetch,
      defaultModel: 'kimi-k2.6',
      resolveOpencodeGoApiKey: () => null,
    });
    await resolverServer.start();
    port = resolverServer.getPort() || 0;
    try {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/v1/responses',
        body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await resolverServer.stop();
    }
  });

  it('swallows resolver errors and falls back to env', async () => {
    process.env.OPENCODE_GO_API_KEY = 'env-fallback-key';
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl_throw_resolver',
        created: 1,
        model: 'kimi-k2.6',
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const resolverServer = new CodexResponsesBridgeServer({
      port: 0,
      fetchImpl: fetchMock as typeof fetch,
      defaultModel: 'kimi-k2.6',
      resolveOpencodeGoApiKey: () => {
        throw new Error('keyring offline');
      },
    });
    await resolverServer.start();
    port = resolverServer.getPort() || 0;
    try {
      const res = await makeRequest(port, {
        method: 'POST',
        path: '/v1/responses',
        body: JSON.stringify({ model: 'opencode-go', input: 'Hello' }),
      });
      expect(res.statusCode).toBe(200);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer env-fallback-key',
      });
    } finally {
      await resolverServer.stop();
    }
  });
});
