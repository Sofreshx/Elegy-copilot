import crypto from 'crypto';
import http from 'http';

const DEFAULT_CODEX_RESPONSES_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_CODEX_RESPONSES_BRIDGE_PORT = 4318;
const DEFAULT_OPENCODE_GO_MODEL = 'kimi-k2.6';
const OPENCODE_GO_CHAT_COMPLETIONS_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const OPENCODE_GO_MODEL_ALIAS = 'opencode-go';
const OPENCODE_GO_SUPPORTED_CHAT_MODELS = [
  'glm-5',
  'glm-5.1',
  'kimi-k2.5',
  'kimi-k2.6',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'qwen3.5-plus',
  'qwen3.6-plus',
] as const;
const OPENCODE_GO_SUPPORTED_CHAT_MODEL_SET = new Set<string>(OPENCODE_GO_SUPPORTED_CHAT_MODELS);
const MAX_RESPONSE_STATE_ENTRIES = 200;

type FetchLike = typeof fetch;

interface ResponseState {
  id: string;
  requestedModel: string;
  upstreamModel: string;
  messages: ChatCompletionMessage[];
  createdAtMs: number;
}

interface ModelResolution {
  requestedModel: string;
  upstreamModel: string;
}

interface TranslatedResponseRequest {
  modelResolution: ModelResolution;
  inputMessages: ChatCompletionMessage[];
  combinedMessages: ChatCompletionMessage[];
  upstreamTools: ChatCompletionTool[] | undefined;
  upstreamToolChoice: unknown;
  upstreamBody: Record<string, unknown>;
  previousResponseId: string | null;
  originalBody: Record<string, unknown>;
}

interface ResponseOutputTextPart {
  type: 'output_text';
  text: string;
  annotations: unknown[];
}

interface ResponseMessageOutputItem {
  id: string;
  type: 'message';
  status: 'completed';
  role: 'assistant';
  content: ResponseOutputTextPart[];
}

interface ResponseFunctionCallOutputItem {
  id: string;
  type: 'function_call';
  status: 'completed';
  call_id: string;
  name: string;
  arguments: string;
}

type ResponseOutputItem = ResponseMessageOutputItem | ResponseFunctionCallOutputItem;

interface ResponsesApiResponse {
  id: string;
  object: 'response';
  created_at: number;
  completed_at: number | null;
  status: 'completed' | 'incomplete';
  error: null;
  incomplete_details: Record<string, unknown> | null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: ResponseOutputItem[];
  parallel_tool_calls: boolean;
  previous_response_id: string | null;
  reasoning: Record<string, unknown>;
  store: boolean;
  temperature: number | null;
  text: Record<string, unknown>;
  tool_choice: unknown;
  tools: unknown[];
  top_p: number | null;
  truncation: string;
  usage: Record<string, unknown>;
  user: string | null;
  metadata: Record<string, unknown>;
}

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCall[];
}

interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionChoiceMessage {
  content?: unknown;
  tool_calls?: unknown;
}

interface ChatCompletionChoice {
  message?: ChatCompletionChoiceMessage;
  finish_reason?: string | null;
}

interface ChatCompletionResponseEnvelope {
  id?: string;
  created?: number;
  model?: string;
  choices?: unknown;
  usage?: ChatCompletionUsage;
}

export interface CodexResponsesBridgeServerOptions {
  host?: string;
  port?: number;
  fetchImpl?: FetchLike;
  defaultModel?: string;
}

export class CodexResponsesBridgeServer {
  private server: http.Server | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly fetchImpl: FetchLike;
  private readonly defaultModel: string;
  private readonly responseStates = new Map<string, ResponseState>();

  constructor(options: CodexResponsesBridgeServerOptions = {}) {
    this.host = options.host ?? DEFAULT_CODEX_RESPONSES_BRIDGE_HOST;
    this.port = options.port ?? DEFAULT_CODEX_RESPONSES_BRIDGE_PORT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultModel = resolveDefaultOpenCodeGoModel(options.defaultModel);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = null;
    if (!activeServer) {
      return;
    }

    await new Promise<void>((resolve) => {
      activeServer.close(() => resolve());
    });
  }

  getPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = String(req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    try {
      if (method === 'GET' && (url.pathname === '/' || url.pathname === '/v1')) {
        this.sendJson(res, 200, {
          ok: true,
          service: 'codex-responses-bridge',
          defaultModel: `${OPENCODE_GO_MODEL_ALIAS}/${this.defaultModel}`,
          upstream: 'OpenCode Go',
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/models') {
        this.sendJson(res, 200, buildModelListResponse());
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/responses') {
        await this.handleCreateResponse(req, res);
        return;
      }

      this.sendOpenAiError(res, 404, 'Not found', 'invalid_request_error', 'not_found');
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      this.sendOpenAiError(
        res,
        statusCode,
        error instanceof Error ? error.message : String(error),
        statusCode >= 500 ? 'server_error' : 'invalid_request_error',
      );
    }
  }

  private async handleCreateResponse(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) {
      throw withStatusCode(new Error('Request body must be a JSON object.'), 400);
    }

    const apiKey = readAuthorizationBearerToken(req) || String(process.env.OPENCODE_GO_API_KEY || '').trim();
    if (!apiKey) {
      throw withStatusCode(new Error('Missing Authorization bearer token for OpenCode Go.'), 401);
    }

    const translatedRequest = this.translateRequest(body);
    const upstreamResponse = await this.callOpenCodeGo(apiKey, translatedRequest.upstreamBody);
    const response = this.buildResponsesApiResponse(translatedRequest, upstreamResponse);

    if (body.stream === true) {
      this.sendResponsesStream(res, response);
      return;
    }

    this.sendJson(res, 200, response);
  }

  private translateRequest(body: Record<string, unknown>): TranslatedResponseRequest {
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
    const modelResolution = resolveRequestedModel(requestedModel, this.defaultModel);
    const previousResponseId = typeof body.previous_response_id === 'string' && body.previous_response_id.trim()
      ? body.previous_response_id.trim()
      : null;
    const previousState = previousResponseId ? this.responseStates.get(previousResponseId) : undefined;
    if (previousResponseId && !previousState) {
      throw withStatusCode(new Error(`Unknown previous_response_id: ${previousResponseId}`), 404);
    }

    const inputMessages = translateInputToChatMessages(body.input);
    if (inputMessages.length === 0) {
      throw withStatusCode(new Error('Responses input must include at least one supported message item.'), 400);
    }

    const upstreamMessages = previousState ? [...previousState.messages] : [];
    if (!previousState) {
      const instructions = typeof body.instructions === 'string' && body.instructions.trim()
        ? body.instructions.trim()
        : '';
      if (instructions) {
        upstreamMessages.push({ role: 'system', content: instructions });
      }
    }
    upstreamMessages.push(...inputMessages);

    const upstreamTools = translateResponsesTools(body.tools);
    const upstreamToolChoice = translateToolChoice(body.tool_choice);

    const upstreamBody: Record<string, unknown> = {
      model: modelResolution.upstreamModel,
      messages: upstreamMessages.map((message) => toChatCompletionMessagePayload(message)),
    };
    if (upstreamTools && upstreamTools.length > 0) {
      upstreamBody.tools = upstreamTools;
    }
    if (upstreamToolChoice !== undefined) {
      upstreamBody.tool_choice = upstreamToolChoice;
    }
    if (typeof body.parallel_tool_calls === 'boolean') {
      upstreamBody.parallel_tool_calls = body.parallel_tool_calls;
    }
    if (typeof body.temperature === 'number') {
      upstreamBody.temperature = body.temperature;
    }
    if (typeof body.top_p === 'number') {
      upstreamBody.top_p = body.top_p;
    }
    if (typeof body.max_output_tokens === 'number') {
      upstreamBody.max_tokens = body.max_output_tokens;
    }
    if (typeof body.user === 'string' && body.user.trim()) {
      upstreamBody.user = body.user.trim();
    }

    return {
      modelResolution,
      inputMessages,
      combinedMessages: upstreamMessages,
      upstreamTools,
      upstreamToolChoice,
      upstreamBody,
      previousResponseId,
      originalBody: body,
    };
  }

  private async callOpenCodeGo(apiKey: string, body: Record<string, unknown>): Promise<ChatCompletionResponseEnvelope> {
    const response = await this.fetchImpl(OPENCODE_GO_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await parseFetchPayload(response);
    if (!response.ok) {
      const message = extractUpstreamErrorMessage(payload)
        || `OpenCode Go request failed with status ${response.status}.`;
      throw withStatusCode(new Error(message), response.status);
    }

    if (!isRecord(payload)) {
      throw withStatusCode(new Error('OpenCode Go returned a non-JSON response body.'), 502);
    }

    return payload as ChatCompletionResponseEnvelope;
  }

  private buildResponsesApiResponse(
    request: TranslatedResponseRequest,
    upstreamResponse: ChatCompletionResponseEnvelope,
  ): ResponsesApiResponse {
    const responseId = `resp_${crypto.randomUUID().replace(/-/g, '')}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const choices = Array.isArray(upstreamResponse.choices) ? upstreamResponse.choices : [];
    const firstChoice = choices.length > 0 && isRecord(choices[0]) ? choices[0] as ChatCompletionChoice : null;
    if (!firstChoice || !isRecord(firstChoice.message)) {
      throw withStatusCode(new Error('OpenCode Go chat completion did not return a usable message.'), 502);
    }

    const choiceMessage = firstChoice.message;
    const text = normalizeContentText(choiceMessage.content);
    const toolCalls = normalizeToolCalls(choiceMessage.tool_calls);
    const output: ResponseOutputItem[] = [];

    if (text) {
      output.push({
        id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text,
          annotations: [],
        }],
      });
    }

    for (const toolCall of toolCalls) {
      output.push({
        id: `fc_${crypto.randomUUID().replace(/-/g, '')}`,
        type: 'function_call',
        status: 'completed',
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
    }

    if (output.length === 0) {
      throw withStatusCode(new Error('OpenCode Go chat completion returned no text or tool calls.'), 502);
    }

    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    this.storeResponseState({
      id: responseId,
      requestedModel: request.modelResolution.requestedModel,
      upstreamModel: request.modelResolution.upstreamModel,
      messages: [...request.combinedMessages, assistantMessage],
      createdAtMs: Date.now(),
    });

    const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : 'stop';
    const incompleteDetails = finishReason === 'length'
      ? { reason: 'max_output_tokens' }
      : null;

    return {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      completed_at: createdAt,
      status: incompleteDetails ? 'incomplete' : 'completed',
      error: null,
      incomplete_details: incompleteDetails,
      instructions: typeof request.originalBody.instructions === 'string' ? request.originalBody.instructions : null,
      max_output_tokens: typeof request.originalBody.max_output_tokens === 'number' ? request.originalBody.max_output_tokens : null,
      model: request.modelResolution.upstreamModel,
      output,
      parallel_tool_calls: request.originalBody.parallel_tool_calls !== false,
      previous_response_id: request.previousResponseId,
      reasoning: isRecord(request.originalBody.reasoning) ? request.originalBody.reasoning : { effort: null, summary: null },
      store: request.originalBody.store !== false,
      temperature: typeof request.originalBody.temperature === 'number' ? request.originalBody.temperature : null,
      text: isRecord(request.originalBody.text) ? request.originalBody.text : { format: { type: 'text' } },
      tool_choice: request.originalBody.tool_choice ?? 'auto',
      tools: Array.isArray(request.originalBody.tools) ? request.originalBody.tools : [],
      top_p: typeof request.originalBody.top_p === 'number' ? request.originalBody.top_p : null,
      truncation: typeof request.originalBody.truncation === 'string' ? request.originalBody.truncation : 'disabled',
      usage: buildResponsesUsage(upstreamResponse.usage),
      user: typeof request.originalBody.user === 'string' ? request.originalBody.user : null,
      metadata: isRecord(request.originalBody.metadata) ? request.originalBody.metadata : {},
    };
  }

  private storeResponseState(state: ResponseState): void {
    this.responseStates.set(state.id, state);
    if (this.responseStates.size <= MAX_RESPONSE_STATE_ENTRIES) {
      return;
    }

    const oldestEntry = [...this.responseStates.values()]
      .sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
    if (oldestEntry) {
      this.responseStates.delete(oldestEntry.id);
    }
  }

  private sendResponsesStream(res: http.ServerResponse, response: ResponsesApiResponse): void {
    let sequenceNumber = 1;
    writeSseHeaders(res);
    sendSseEvent(res, 'response.created', {
      type: 'response.created',
      response: {
        ...response,
        status: 'in_progress',
        completed_at: null,
        output: [],
      },
      sequence_number: sequenceNumber++,
    });
    sendSseEvent(res, 'response.in_progress', {
      type: 'response.in_progress',
      response: {
        ...response,
        status: 'in_progress',
        completed_at: null,
      },
      sequence_number: sequenceNumber++,
    });

    response.output.forEach((item, outputIndex) => {
      if (item.type === 'message') {
        const part = item.content[0] || { type: 'output_text', text: '', annotations: [] };
        sendSseEvent(res, 'response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: {
            ...item,
            status: 'in_progress',
            content: [],
          },
          sequence_number: sequenceNumber++,
        });
        sendSseEvent(res, 'response.content_part.added', {
          type: 'response.content_part.added',
          item_id: item.id,
          output_index: outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text: '',
            annotations: [],
          },
          sequence_number: sequenceNumber++,
        });
        if (part.text) {
          sendSseEvent(res, 'response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            delta: part.text,
            sequence_number: sequenceNumber++,
          });
          sendSseEvent(res, 'response.output_text.done', {
            type: 'response.output_text.done',
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            text: part.text,
            sequence_number: sequenceNumber++,
          });
        }
        sendSseEvent(res, 'response.content_part.done', {
          type: 'response.content_part.done',
          item_id: item.id,
          output_index: outputIndex,
          content_index: 0,
          part,
          sequence_number: sequenceNumber++,
        });
        sendSseEvent(res, 'response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item,
          sequence_number: sequenceNumber++,
        });
        return;
      }

      sendSseEvent(res, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: {
          ...item,
          status: 'in_progress',
          arguments: '',
        },
        sequence_number: sequenceNumber++,
      });
      if (item.arguments) {
        sendSseEvent(res, 'response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: item.id,
          output_index: outputIndex,
          delta: item.arguments,
          sequence_number: sequenceNumber++,
        });
        sendSseEvent(res, 'response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: item.id,
          output_index: outputIndex,
          arguments: item.arguments,
          sequence_number: sequenceNumber++,
        });
      }
      sendSseEvent(res, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item,
        sequence_number: sequenceNumber++,
      });
    });

    sendSseEvent(res, 'response.completed', {
      type: 'response.completed',
      response,
      sequence_number: sequenceNumber++,
    });
    res.end();
  }

  private sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  }

  private sendOpenAiError(
    res: http.ServerResponse,
    statusCode: number,
    message: string,
    type: string,
    code?: string,
  ): void {
    this.sendJson(res, statusCode, {
      error: {
        message,
        type,
        param: null,
        code: code || null,
      },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function withStatusCode(error: Error, statusCode: number): Error & { statusCode: number } {
  return Object.assign(error, { statusCode });
}

function resolveDefaultOpenCodeGoModel(explicitDefaultModel?: string): string {
  const configured = String(explicitDefaultModel || process.env.OPENCODE_GO_MODEL || '').trim();
  const candidate = configured || DEFAULT_OPENCODE_GO_MODEL;
  if (!OPENCODE_GO_SUPPORTED_CHAT_MODEL_SET.has(candidate)) {
    return DEFAULT_OPENCODE_GO_MODEL;
  }
  return candidate;
}

function resolveRequestedModel(requestedModel: string, defaultModel: string): ModelResolution {
  const normalizedRequestedModel = requestedModel || OPENCODE_GO_MODEL_ALIAS;
  if (normalizedRequestedModel === OPENCODE_GO_MODEL_ALIAS) {
    return {
      requestedModel: normalizedRequestedModel,
      upstreamModel: defaultModel,
    };
  }

  if (normalizedRequestedModel.startsWith(`${OPENCODE_GO_MODEL_ALIAS}/`)) {
    const upstreamModel = normalizedRequestedModel.slice(OPENCODE_GO_MODEL_ALIAS.length + 1).trim();
    if (!OPENCODE_GO_SUPPORTED_CHAT_MODEL_SET.has(upstreamModel)) {
      throw withStatusCode(
        new Error(`Model ${normalizedRequestedModel} is not supported by the Codex Responses bridge.`),
        400,
      );
    }
    return {
      requestedModel: normalizedRequestedModel,
      upstreamModel,
    };
  }

  if (!OPENCODE_GO_SUPPORTED_CHAT_MODEL_SET.has(normalizedRequestedModel)) {
    throw withStatusCode(
      new Error(`Model ${normalizedRequestedModel} is not supported by the Codex Responses bridge.`),
      400,
    );
  }

  return {
    requestedModel: normalizedRequestedModel,
    upstreamModel: normalizedRequestedModel,
  };
}

function buildModelListResponse(): Record<string, unknown> {
  const created = Math.floor(Date.now() / 1000);
  const data = [
    buildModelListEntry(OPENCODE_GO_MODEL_ALIAS, created),
    ...OPENCODE_GO_SUPPORTED_CHAT_MODELS.map((modelId) => buildModelListEntry(`${OPENCODE_GO_MODEL_ALIAS}/${modelId}`, created)),
    ...OPENCODE_GO_SUPPORTED_CHAT_MODELS.map((modelId) => buildModelListEntry(modelId, created)),
  ];

  return {
    object: 'list',
    data,
  };
}

function buildModelListEntry(id: string, created: number): Record<string, unknown> {
  return {
    id,
    object: 'model',
    created,
    owned_by: 'opencode-go',
  };
}

function normalizeContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (!isRecord(entry)) {
          return '';
        }
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        return '';
      })
      .filter((entry) => entry.length > 0)
      .join('');
  }

  if (isRecord(content) && typeof content.text === 'string') {
    return content.text;
  }

  return '';
}

function normalizeToolCalls(toolCalls: unknown): ChatCompletionToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.function)) {
        return null;
      }
      const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `call_${crypto.randomUUID().replace(/-/g, '')}`;
      const name = typeof entry.function.name === 'string' ? entry.function.name.trim() : '';
      const argumentsText = typeof entry.function.arguments === 'string'
        ? entry.function.arguments
        : JSON.stringify(entry.function.arguments ?? {});
      if (!name) {
        return null;
      }
      return {
        id,
        type: 'function' as const,
        function: {
          name,
          arguments: argumentsText,
        },
      };
    })
    .filter((entry): entry is ChatCompletionToolCall => entry !== null);
}

function translateInputToChatMessages(input: unknown): ChatCompletionMessage[] {
  if (typeof input === 'string' && input.length > 0) {
    return [{ role: 'user', content: input }];
  }

  const entries = Array.isArray(input)
    ? input
    : (isRecord(input) ? [input] : []);
  const messages: ChatCompletionMessage[] = [];

  for (const entry of entries) {
    if (typeof entry === 'string' && entry.length > 0) {
      messages.push({ role: 'user', content: entry });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    if (entry.type === 'function_call_output') {
      const callId = typeof entry.call_id === 'string' ? entry.call_id.trim() : '';
      if (!callId) {
        continue;
      }
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: stringifyToolOutput(entry.output),
      });
      continue;
    }

    if (entry.type === 'function_call') {
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const callId = typeof entry.call_id === 'string' ? entry.call_id.trim() : '';
      if (!name || !callId) {
        continue;
      }
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: typeof entry.arguments === 'string' ? entry.arguments : JSON.stringify(entry.arguments ?? {}),
          },
        }],
      });
      continue;
    }

    const role = typeof entry.role === 'string' ? entry.role.trim() : '';
    if (!role) {
      continue;
    }

    if (role === 'tool') {
      const toolCallId = typeof entry.tool_call_id === 'string'
        ? entry.tool_call_id.trim()
        : (typeof entry.call_id === 'string' ? entry.call_id.trim() : '');
      if (!toolCallId) {
        continue;
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: stringifyToolOutput(entry.content ?? entry.output),
      });
      continue;
    }

    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      continue;
    }

    const message: ChatCompletionMessage = {
      role,
      content: normalizeContentText(entry.content) || null,
    };
    const toolCalls = normalizeToolCalls(entry.tool_calls);
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      message.content = message.content || null;
    }
    messages.push(message);
  }

  return messages;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  return JSON.stringify(output ?? null);
}

function translateResponsesTools(tools: unknown): ChatCompletionTool[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.map((entry, index) => {
    if (!isRecord(entry)) {
      throw withStatusCode(new Error(`Tool at index ${index} must be an object.`), 400);
    }

    if (entry.type !== 'function') {
      throw withStatusCode(new Error(`Unsupported Responses tool type: ${String(entry.type || 'unknown')}`), 501);
    }

    const functionConfig = isRecord(entry.function) ? entry.function : entry;
    const name = typeof functionConfig.name === 'string' ? functionConfig.name.trim() : '';
    if (!name) {
      throw withStatusCode(new Error(`Tool at index ${index} is missing function.name.`), 400);
    }

    const tool: ChatCompletionTool = {
      type: 'function',
      function: {
        name,
      },
    };
    if (typeof functionConfig.description === 'string' && functionConfig.description.trim()) {
      tool.function.description = functionConfig.description.trim();
    }
    if (isRecord(functionConfig.parameters)) {
      tool.function.parameters = functionConfig.parameters;
    }
    return tool;
  });
}

function translateToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === undefined) {
    return undefined;
  }
  if (typeof toolChoice === 'string') {
    return toolChoice;
  }
  if (!isRecord(toolChoice)) {
    return undefined;
  }

  if (toolChoice.type === 'function') {
    const functionConfig = isRecord(toolChoice.function) ? toolChoice.function : toolChoice;
    const name = typeof functionConfig.name === 'string' ? functionConfig.name.trim() : '';
    if (name) {
      return {
        type: 'function',
        function: { name },
      };
    }
  }

  return undefined;
}

function toChatCompletionMessagePayload(message: ChatCompletionMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    role: message.role,
  };
  if (message.content !== undefined) {
    payload.content = message.content;
  }
  if (message.tool_call_id) {
    payload.tool_call_id = message.tool_call_id;
  }
  if (message.tool_calls && message.tool_calls.length > 0) {
    payload.tool_calls = message.tool_calls;
  }
  return payload;
}

function buildResponsesUsage(usage: ChatCompletionUsage | undefined): Record<string, unknown> {
  const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : inputTokens + outputTokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    total_tokens: totalTokens,
  };
}

function readAuthorizationBearerToken(req: http.IncomingMessage): string {
  const headerValue = req.headers.authorization;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header !== 'string') {
    return '';
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 512 * 1024): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(withStatusCode(new Error('Request body too large.'), 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(withStatusCode(new Error('Invalid JSON body.'), 400));
      }
    });
    req.on('error', reject);
  });
}

async function parseFetchPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return await response.json();
  }
  return await response.text();
}

function extractUpstreamErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }
  if (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  return '';
}

function writeSseHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sendSseEvent(res: http.ServerResponse, eventName: string, payload: unknown): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}
