import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const MODE = process.argv[2] ?? 'all';
const TIMEOUT_MS = Number(process.env.CODEX_SPIKE_TIMEOUT_MS ?? 180_000);
const sandboxBinary = path.join(
  process.env.USERPROFILE ?? '',
  '.codex',
  '.sandbox-bin',
  'codex.exe',
);
const CODEX = process.env.CODEX_BIN
  ?? (process.platform === 'win32' && existsSync(sandboxBinary) ? sandboxBinary : 'codex');
const MODEL = process.env.CODEX_SPIKE_MODEL ?? 'gpt-5.4';
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
  const cwd = await mkdtemp(path.join(tmpdir(), 'codex-exec-spike-'));
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'user.name', 'Codex Spike']);
  git(cwd, ['config', 'user.email', 'codex-spike@example.invalid']);
  await writeFile(path.join(cwd, 'README.md'), '# Codex fixture\n', 'utf8');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '--quiet', '-m', 'fixture baseline']);
  return cwd;
}

async function removeFixture(cwd) {
  await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

function runCodex(cwd, args, { timeoutMs = TIMEOUT_MS, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const events = [];
    const stderr = [];
    let parseError = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);
        onEvent?.(event, child);
      } catch (error) {
        parseError = { line, message: error.message };
      }
    });
    const timer = setTimeout(() => {
      terminateTree(child.pid);
      reject(new Error(`Codex timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, events, stderr: stderr.join(''), parseError, pid: child.pid });
    });
  });
}

function terminateTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
}

function threadId(events) {
  return events.find((event) => event.type === 'thread.started')?.thread_id ?? null;
}

function finalMessage(events) {
  return events
    .filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
    .map((event) => event.item.text ?? '')
    .at(-1) ?? '';
}

async function runDispatch() {
  const cwd = await createFixtureRepo();
  try {
    const schemaPath = path.join(cwd, 'result.schema.json');
    const outputPath = path.join(cwd, 'result.json');
    await writeFile(schemaPath, JSON.stringify({
      type: 'object',
      properties: {
        file: { type: 'string', const: 'result.txt' },
        content: { type: 'string', const: 'CODEX_OK' },
      },
      required: ['file', 'content'],
      additionalProperties: false,
    }), 'utf8');
    git(cwd, ['add', 'result.schema.json']);
    git(cwd, ['commit', '--quiet', '-m', 'add output schema']);

    const run = await runCodex(cwd, [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--model',
      MODEL,
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '-C',
      cwd,
      'Create result.txt containing exactly CODEX_OK followed by one newline. Do not change other files. Return the schema result.',
    ]);
    if (run.code !== 0) fail('Codex dispatch failed', run);
    if (run.parseError) fail('Codex emitted non-JSON stdout', run.parseError);
    const content = await readFile(path.join(cwd, 'result.txt'), 'utf8');
    if (content !== 'CODEX_OK\n') fail('Fixture content mismatch', { content });
    const structured = JSON.parse(await readFile(outputPath, 'utf8'));
    const validStructured = structured.file === 'result.txt'
      && structured.content === 'CODEX_OK'
      && Object.keys(structured).length === 2;
    record('dispatch', validStructured ? 'passed' : 'failed', {
      threadId: threadId(run.events),
      eventTypes: [...new Set(run.events.map((event) => event.type))],
      itemTypes: [...new Set(run.events.map((event) => event.item?.type).filter(Boolean))],
      structured,
      changedFiles: git(cwd, ['status', '--short']).split(/\r?\n/).filter(Boolean),
    });
  } finally {
    await removeFixture(cwd);
  }
}

async function runResume() {
  const cwd = await createFixtureRepo();
  try {
    const first = await runCodex(cwd, [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--model',
      MODEL,
      '-C',
      cwd,
      'Remember the token ORCH_CODEX_RESUME_9137. Reply with only remembered.',
    ]);
    const id = threadId(first.events);
    if (first.code !== 0 || !id) fail('Initial resumable Codex run failed', first);

    const resumed = await runCodex(cwd, [
      'exec',
      'resume',
      '--json',
      '--model',
      MODEL,
      '-c',
      'sandbox_mode="read-only"',
      id,
      'Reply with only the token I asked you to remember.',
    ]);
    const text = finalMessage(resumed.events);
    record('resume', resumed.code === 0 && text.includes('ORCH_CODEX_RESUME_9137')
      ? 'passed'
      : 'failed', {
      threadId: id,
      finalMessage: text,
    });

    const schemaProbe = spawnSync(CODEX, [
      'exec',
      'resume',
      '--model',
      MODEL,
      '--output-schema',
      path.join(cwd, 'missing-schema.json'),
      id,
      'Return JSON.',
    ], { cwd, encoding: 'utf8', windowsHide: true });
    record('resume-output-schema', schemaProbe.status === 0 ? 'passed' : 'unsupported', {
      exitCode: schemaProbe.status,
      stderr: schemaProbe.stderr.trim(),
    });
  } finally {
    await removeFixture(cwd);
  }
}

async function runCancellation() {
  const cwd = await createFixtureRepo();
  try {
    let cancelledAt = null;
    const startedAt = Date.now();
    const run = await runCodex(cwd, [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--model',
      MODEL,
      '-C',
      cwd,
      'Run powershell -NoProfile -Command "Start-Sleep -Seconds 60". Do not modify files. Report only after it exits.',
    ], {
      timeoutMs: 90_000,
      onEvent(event, child) {
        if (
          !cancelledAt
          && event.type === 'item.started'
          && event.item?.type === 'command_execution'
        ) {
          cancelledAt = Date.now();
          terminateTree(child.pid);
        }
      },
    });
    const elapsedMs = Date.now() - startedAt;
    const status = git(cwd, ['status', '--short']);
    record('cancellation', cancelledAt && elapsedMs < 30_000 && !status
      ? 'passed'
      : 'failed', {
      processExitCode: run.code,
      processSignal: run.signal,
      elapsedMs,
      repositoryClean: !status,
      cancellationApi: 'none; supervised process-tree termination required',
    });
  } finally {
    await removeFixture(cwd);
  }
}

async function runMalformedSchema() {
  const cwd = await createFixtureRepo();
  try {
    const schemaPath = path.join(cwd, 'invalid.schema.json');
    await writeFile(schemaPath, '{"type":"not-a-json-schema-type"}', 'utf8');
    const rejected = await runCodex(cwd, [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--model',
      MODEL,
      '--output-schema',
      schemaPath,
      '-C',
      cwd,
      'Return any result.',
    ], { timeoutMs: 30_000 });
    const recovered = await runCodex(cwd, [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--model',
      MODEL,
      '-C',
      cwd,
      'Reply with only RECOVERED.',
    ]);
    record('malformed-schema', rejected.code !== 0 && recovered.code === 0
      ? 'passed'
      : 'failed', {
      rejectedExitCode: rejected.code,
      rejectedEvents: rejected.events.map((event) => event.type),
      recoveredFinalMessage: finalMessage(recovered.events),
    });
  } finally {
    await removeFixture(cwd);
  }
}

try {
  if (MODE === 'all' || MODE === 'dispatch') await runDispatch();
  if (MODE === 'all' || MODE === 'resume') await runResume();
  if (MODE === 'all' || MODE === 'cancel') await runCancellation();
  if (MODE === 'all' || MODE === 'malformed') await runMalformedSchema();
} catch (error) {
  record(MODE, 'failed', {
    error: error.message,
    code: error.code,
    stderr: error.stderr,
    events: error.events,
  });
}

const failed = results.some((result) => result.status === 'failed');
process.stdout.write(`${JSON.stringify({
  schemaVersion: 'codex-exec-spike/v1',
  codexVersion: spawnSync(CODEX, ['--version'], { encoding: 'utf8' }).stdout.trim(),
  model: MODEL,
  mode: MODE,
  results,
}, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
