import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const MODE = process.argv[2] ?? 'all';
const TIMEOUT_MS = Number(process.env.ACP_SPIKE_TIMEOUT_MS ?? 120_000);
const windowsNpmBinary = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
  : '';
const OPENCODE = process.env.OPENCODE_BIN
  ?? (process.platform === 'win32' && existsSync(windowsNpmBinary) ? windowsNpmBinary : 'opencode');
const results = [];

function record(name, status, details = {}) {
  results.push({ name, status, ...details });
}

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  throw error;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed`, { stdout: result.stdout, stderr: result.stderr });
  }
  return result.stdout.trim();
}

async function createFixtureRepo() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'opencode-acp-spike-'));
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'user.name', 'ACP Spike']);
  git(cwd, ['config', 'user.email', 'acp-spike@example.invalid']);
  await writeFile(path.join(cwd, 'README.md'), '# ACP fixture\n', 'utf8');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '--quiet', '-m', 'fixture baseline']);
  return cwd;
}

class AcpClient {
  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.requests = [];
    this.stderr = [];
    this.child = null;
    this.closed = false;
    this.initializeResult = null;
  }

  async start() {
    this.child = spawn(OPENCODE, ['acp', '--cwd', this.cwd], {
      cwd: this.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => this.stderr.push(chunk));
    this.child.on('error', (error) => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`OpenCode ACP exited before responding (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => this.onLine(line));
    this.initializeResult = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'elegy-copilot-acp-spike',
        title: 'Elegy Copilot ACP Spike',
        version: '1.0.0',
      },
    });
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      record('parse-agent-message', 'failed', { line });
      return;
    }
    if (message.method && Object.hasOwn(message, 'id')) {
      this.requests.push(message);
      this.respondToAgentRequest(message);
      return;
    }
    if (message.method) {
      this.notifications.push(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(message.error.message ?? 'ACP request failed');
      error.rpcError = message.error;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  respondToAgentRequest(message) {
    if (message.method !== 'session/request_permission') {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Unsupported client method: ${message.method}` },
      });
      return;
    }
    const selected = (message.params?.options ?? [])
      .find((option) => option.kind === 'allow_once');
    this.send({
      jsonrpc: '2.0',
      id: message.id,
      result: selected
        ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
        : { outcome: { outcome: 'cancelled' } },
    });
  }

  send(message) {
    if (!this.child || this.closed) fail('Cannot write to closed ACP process');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async stop() {
    if (!this.child || this.closed) return;
    this.child.stdin.end();
    await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (!this.closed) this.child.kill();
  }
}

async function withClient(run) {
  const cwd = await createFixtureRepo();
  const client = new AcpClient(cwd);
  try {
    await client.start();
    await run({ client, cwd });
  } finally {
    await client.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}

async function newSession(client, cwd) {
  const result = await client.request('session/new', { cwd, mcpServers: [] });
  if (!result?.sessionId) fail('session/new did not return a sessionId', { result });
  return result.sessionId;
}

function agentText(client) {
  return client.notifications
    .filter((message) => message.params?.update?.sessionUpdate === 'agent_message_chunk')
    .map((message) => message.params.update.content?.text ?? '')
    .join('');
}

async function runDispatchAndContinuation() {
  await withClient(async ({ client, cwd }) => {
    const sessionId = await newSession(client, cwd);
    const first = await client.request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'Create result.txt containing exactly ACP_OK followed by one newline. Do not change any other file.',
      }],
    });
    const content = await readFile(path.join(cwd, 'result.txt'), 'utf8');
    if (content !== 'ACP_OK\n') fail('Fixture task produced unexpected content', { content });
    const notificationsAtFirstResponse = client.notifications.length;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const lateNotifications = client.notifications.length - notificationsAtFirstResponse;
    const second = await client.request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'Reply with only the exact filename you created in the previous turn. Do not use tools.',
      }],
    });
    const text = agentText(client);
    record('dispatch', 'passed', {
      sessionId,
      firstStopReason: first?.stopReason,
      lateNotificationsAfterResponse: lateNotifications,
      changedFiles: git(cwd, ['status', '--short']).split(/\r?\n/).filter(Boolean),
    });
    record('continuation', text.includes('result.txt') ? 'passed' : 'failed', {
      secondStopReason: second?.stopReason,
      agentTextTail: text.slice(-500),
    });
    record('permissions', 'observed', {
      requestCount: client.requests.filter(
        (request) => request.method === 'session/request_permission',
      ).length,
    });
    record('events', 'observed', {
      notificationCount: client.notifications.length,
      updateKinds: [...new Set(client.notifications.map(
        (message) => message.params?.update?.sessionUpdate,
      ).filter(Boolean))],
    });
    record('capabilities', 'observed', { initializeResult: client.initializeResult });
  });
}

async function runResume() {
  const cwd = await createFixtureRepo();
  const firstClient = new AcpClient(cwd);
  const secondClient = new AcpClient(cwd);
  try {
    await firstClient.start();
    const sessionId = await newSession(firstClient, cwd);
    await firstClient.request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'Remember the token ORCH_RESUME_7421. Reply with only remembered.',
      }],
    });
    await firstClient.stop();

    await secondClient.start();
    const capabilities = secondClient.initializeResult?.agentCapabilities ?? {};
    const method = capabilities.sessionCapabilities?.resume
      ? 'session/resume'
      : (capabilities.loadSession ? 'session/load' : null);
    if (!method) fail('OpenCode advertised neither session/resume nor session/load');
    await secondClient.request(method, { sessionId, cwd, mcpServers: [] });
    const response = await secondClient.request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'Reply with only the token I asked you to remember in the previous process.',
      }],
    });
    const text = agentText(secondClient);
    record('resume', text.includes('ORCH_RESUME_7421') ? 'passed' : 'failed', {
      method,
      sessionId,
      stopReason: response?.stopReason,
      agentTextTail: text.slice(-500),
    });
  } finally {
    await firstClient.stop();
    await secondClient.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}

async function runCancellation() {
  await withClient(async ({ client, cwd }) => {
    const sessionId = await newSession(client, cwd);
    const prompt = client.request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'Use the shell tool to execute: powershell -NoProfile -Command "Start-Sleep -Seconds 60". Do not modify any files. Report only after it exits.',
      }],
    });
    const waitStarted = Date.now();
    while (
      Date.now() - waitStarted < 10_000
      && !client.notifications.some((message) => {
        const kind = message.params?.update?.sessionUpdate;
        return kind === 'tool_call' || kind === 'tool_call_update';
      })
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    client.notify('session/cancel', { sessionId });
    const response = await prompt;
    const status = git(cwd, ['status', '--short']);
    if (status) fail('Cancellation left fixture repository dirty', { status });
    const elapsedMs = Date.now() - waitStarted;
    record('cancellation', elapsedMs < 30_000 ? 'passed' : 'failed', {
      stopReason: response?.stopReason,
      stopReasonConformant: response?.stopReason === 'cancelled',
      repositoryClean: true,
      cancelLatencyMs: elapsedMs,
      terminatedBeforeCommandDeadline: elapsedMs < 30_000,
    });
  });
}

async function runMalformedInput() {
  await withClient(async ({ client, cwd }) => {
    let rpcError;
    try {
      await client.request('session/prompt', { sessionId: 42, prompt: 'not-an-array' }, 15_000);
    } catch (error) {
      rpcError = error.rpcError ?? { message: error.message };
    }
    const sessionId = await newSession(client, cwd);
    record('malformed-input', rpcError ? 'passed' : 'failed', {
      rpcError,
      processRecovered: Boolean(sessionId),
    });
  });
}

try {
  if (MODE === 'all' || MODE === 'dispatch') await runDispatchAndContinuation();
  if (MODE === 'all' || MODE === 'resume') await runResume();
  if (MODE === 'all' || MODE === 'cancel') await runCancellation();
  if (MODE === 'all' || MODE === 'malformed') await runMalformedInput();
} catch (error) {
  record(MODE, 'failed', {
    error: error.message,
    rpcError: error.rpcError,
    stdout: error.stdout,
    stderr: error.stderr,
  });
}

const failed = results.some((result) => result.status === 'failed');
process.stdout.write(`${JSON.stringify({
  schemaVersion: 'opencode-acp-spike/v1',
  opencodeVersion: spawnSync(OPENCODE, ['--version'], { encoding: 'utf8' }).stdout.trim(),
  mode: MODE,
  results,
}, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
