#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_PROJECTION_BYTES = 512 * 1024;
export const STABLE_READ_METHODS = Object.freeze([
  'thread/read',
  'thread/goal/get',
  'config/read',
  'configRequirements/read',
  'skills/list',
  'hooks/list',
  'mcpServerStatus/list',
]);

const REDACTED_PATH = '<redacted-path>';
const REDACTED_SECRET = '<redacted-secret>';
const MAX_STRING_LENGTH = 4096;

function requireThreadId(threadId) {
  if (typeof threadId !== 'string' || threadId.trim() === '') {
    throw new TypeError('An exact non-empty threadId is required.');
  }
  return threadId.trim();
}

function compactString(value) {
  if (typeof value !== 'string') return value;
  return redactString(value).slice(0, MAX_STRING_LENGTH);
}

function redactString(value) {
  return value
    .replace(/\b(?:(?:sk|pk|rk)[_-]|(?:ghp|gho|github_pat)_)[A-Za-z0-9_-]+\b/gi, REDACTED_SECRET)
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;]+/gi, '$&'.replace(/[^=:\s]+$/, REDACTED_SECRET))
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]+/g, REDACTED_PATH)
    .replace(/(?<![A-Za-z0-9_.-])\/(?:Users|home|private|tmp|var)\/[^^\s"'<>]+/g, REDACTED_PATH);
}

function safeValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return compactString(value);
  if (depth >= 4) return '<omitted-depth>';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(token|secret|password|credential|authorization|cookie|key)/i.test(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 100)
        .map(([key, child]) => [key, safeValue(child, depth + 1)]),
    );
  }
  return undefined;
}

function firstList(response, names) {
  for (const name of names) {
    if (Array.isArray(response?.[name])) return response[name];
  }
  return [];
}

function stateFor(item) {
  if (item?.blockedByPolicy === true || item?.policyBlocked === true || item?.status === 'policy-blocked') return 'policy-blocked';
  if (item?.callable === true || item?.status === 'callable') return 'callable';
  if (item?.enabled === true || item?.status === 'enabled') return 'enabled';
  if (item?.configured === true || item?.status === 'configured') return 'configured';
  return 'discovered';
}

function surfaceItem(item) {
  const allowedFields = [
    'id',
    'key',
    'name',
    'status',
    'scope',
    'owner',
    'loadMode',
    'configured',
    'discovered',
    'enabled',
    'callable',
    'available',
    'blockedByPolicy',
    'policyBlocked',
    'required',
  ];
  const source = Object.fromEntries(allowedFields
    .filter((field) => item?.[field] !== undefined)
    .map((field) => [field, safeValue(item[field])]));
  return {
    ...source,
    state: stateFor(item),
  };
}

function namedItems(response, names) {
  return firstList(response, names)
    .map(surfaceItem)
    .sort((left, right) => String(left.name ?? left.id ?? '').localeCompare(String(right.name ?? right.id ?? '')));
}

function paginated(items, pageSize, sourceCursor = null) {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 50;
  return {
    items: items.slice(0, safePageSize),
    page: {
      offset: 0,
      limit: safePageSize,
      nextCursor: typeof sourceCursor === 'string' && sourceCursor ? sourceCursor : (items.length > safePageSize ? String(safePageSize) : null),
    },
  };
}

function projectionSize(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function responseExceedsLimit(response) {
  try {
    return projectionSize(response) > MAX_PROJECTION_BYTES;
  } catch {
    return true;
  }
}

function enforceProjectionLimit(result) {
  if (projectionSize(result) <= MAX_PROJECTION_BYTES) return result;

  for (const surface of [...Object.values(result.configuration), ...Object.values(result.surfaces)]) {
    if (surface?.items) {
      surface.items = surface.items.map((item) => ({
        name: item.name,
        id: item.id,
        state: item.state,
      }));
    }
  }
  result.thread = { id: result.thread.id, status: result.thread.status };
  result.goal = { status: result.goal.status };
  result.structuralEvents = {
    contextCompactions: result.structuralEvents.contextCompactions.slice(0, 10),
    subAgentActivityStarts: result.structuralEvents.subAgentActivityStarts.slice(0, 10),
  };
  result.projection.truncated = true;
  result.projection.reason = 'size-limit';

  if (projectionSize(result) > MAX_PROJECTION_BYTES) {
    for (const surface of [...Object.values(result.configuration), ...Object.values(result.surfaces)]) {
      if (surface?.items) surface.items = surface.items.slice(0, 10);
    }
  }
  if (projectionSize(result) > MAX_PROJECTION_BYTES) {
    result.configuration = { layers: paginated([], 1), requirements: paginated([], 1) };
    result.surfaces = {
      skills: paginated([], 1),
      hooks: paginated([], 1),
      mcpServers: paginated([], 1),
    };
    result.filesystem = { instructions: [], customAgents: [] };
    result.structuralEvents = { contextCompactions: [], subAgentActivityStarts: [] };
  }
  return result;
}

function allowlistedThread(response, threadId) {
  const thread = response?.thread ?? response ?? {};
  return {
    id: compactString(thread.id ?? threadId),
    identityStatus: compactString(thread.identityStatus ?? 'matched'),
    status: compactString(thread.status),
    title: compactString(thread.title ?? thread.name),
    createdAt: compactString(thread.createdAt),
    updatedAt: compactString(thread.updatedAt),
  };
}

function allowlistedGoal(response) {
  const goal = response?.goal ?? response ?? {};
  return {
    id: compactString(goal.id),
    status: compactString(goal.status),
    objective: compactString(goal.objective),
  };
}

function structuralEvent(item, turnId) {
  const agent = item?.agent ?? item?.agentRef ?? {};
  return {
    id: compactString(item?.id),
    turnId: compactString(turnId),
    type: compactString(item?.type ?? item?.kind),
    status: compactString(item?.status ?? item?.state),
    createdAt: compactString(item?.createdAt ?? item?.timestamp),
    updatedAt: compactString(item?.updatedAt),
    agentId: compactString(agent?.id ?? item?.agentId),
    agentName: compactString(agent?.name ?? item?.agentName),
  };
}

function structuralEvents(response) {
  const thread = response?.thread ?? response ?? {};
  const contextCompactions = [];
  const subAgentActivityStarts = [];
  for (const turn of Array.isArray(thread.turns) ? thread.turns.slice(0, 100) : []) {
    for (const item of Array.isArray(turn?.items) ? turn.items.slice(0, 100) : []) {
      const type = String(item?.type ?? item?.kind ?? '').toLowerCase();
      const status = String(item?.status ?? item?.state ?? '').toLowerCase();
      if (type === 'contextcompaction') contextCompactions.push(structuralEvent(item, turn?.id));
      if (type === 'subagentactivity' && (status === 'started' || status === 'start')) {
        subAgentActivityStarts.push(structuralEvent(item, turn?.id));
      }
    }
  }
  const sortEvents = (events) => events.sort((left, right) => `${left.createdAt ?? ''}\u0000${left.id ?? ''}`.localeCompare(`${right.createdAt ?? ''}\u0000${right.id ?? ''}`));
  return {
    contextCompactions: sortEvents(contextCompactions).slice(0, 100),
    subAgentActivityStarts: sortEvents(subAgentActivityStarts).slice(0, 100),
  };
}

export function readBoundedFilesystem({ activeInstructionPaths = [], customAgentRoots = [] } = {}) {
  const instructions = [...new Set(activeInstructionPaths)]
    .filter((filePath) => path.basename(filePath).toUpperCase() === 'AGENTS.MD')
    .sort((left, right) => left.localeCompare(right))
    .flatMap((filePath) => {
      try {
        const content = fs.readFileSync(filePath);
        return [{ name: path.basename(filePath), sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }];
      } catch {
        return [];
      }
    });

  const customAgents = [...new Set(customAgentRoots)]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((root) => {
      try {
        return fs.readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.toml'))
          .sort((left, right) => left.name.localeCompare(right.name))
          .flatMap((entry) => {
            try {
              const content = fs.readFileSync(path.join(root, entry.name));
              return [{ name: entry.name, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }];
            } catch {
              return [];
            }
          });
      } catch {
        return [];
      }
    });

  return { instructions, customAgents };
}

export async function collectCodexWorkflow({ transport, threadId, pageSize, filesystemOptions } = {}) {
  const selectedThreadId = requireThreadId(threadId);
  if (!transport || typeof transport.request !== 'function') {
    throw new TypeError('A transport with request(method, params) is required.');
  }

  const responses = {};
  const readStatus = {};
  for (const method of STABLE_READ_METHODS) {
    const params = method === 'thread/read'
      ? { threadId: selectedThreadId, includeTurns: true }
      : method === 'thread/goal/get' ? { threadId: selectedThreadId } : {};
    try {
      responses[method] = await transport.request(method, params);
      readStatus[method] = 'available';
    } catch {
      responses[method] = {};
      readStatus[method] = 'unavailable';
    }
  }
  const returnedThread = responses['thread/read']?.thread ?? responses['thread/read'] ?? {};
  if (typeof returnedThread.id === 'string' && returnedThread.id.trim() !== selectedThreadId) {
    responses['thread/read'] = { thread: { id: selectedThreadId, identityStatus: 'mismatch' } };
    readStatus['thread/read'] = 'unavailable';
  }
  const sourceOversized = Object.values(responses).some(responseExceedsLimit);

  const result = {
    schemaVersion: '2',
    kind: 'codex.workflow.inspection',
    collector: {
      version: compactString(transport.version ?? responses['thread/read']?.version ?? 'unavailable'),
      methods: [...STABLE_READ_METHODS],
      readStatus,
      selector: { threadId: selectedThreadId },
    },
    thread: allowlistedThread(responses['thread/read'], selectedThreadId),
    goal: allowlistedGoal(responses['thread/goal/get']),
    structuralEvents: structuralEvents(responses['thread/read']),
    configuration: {
      layers: paginated(namedItems(responses['config/read'], ['layers', 'configLayers']), pageSize, responses['config/read']?.nextCursor),
      requirements: paginated(namedItems(responses['configRequirements/read'], ['requirements', 'items']), pageSize, responses['configRequirements/read']?.nextCursor),
    },
    surfaces: {
      skills: paginated(namedItems(responses['skills/list'], ['skills', 'items']), pageSize, responses['skills/list']?.nextCursor),
      hooks: paginated(namedItems(responses['hooks/list'], ['hooks', 'items']), pageSize, responses['hooks/list']?.nextCursor),
      mcpServers: paginated(namedItems(responses['mcpServerStatus/list'], ['servers', 'mcpServers', 'items']), pageSize, responses['mcpServerStatus/list']?.nextCursor),
    },
    filesystem: filesystemOptions ? readBoundedFilesystem(filesystemOptions) : { instructions: [], customAgents: [] },
    projection: {
      maxBytes: MAX_PROJECTION_BYTES,
      truncated: sourceOversized,
      ...(sourceOversized ? { reason: 'source-size-limit' } : {}),
    },
  };
  return enforceProjectionLimit(result);
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--thread-id' || argument === '--transport-module') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${argument}.`);
      options[argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  requireThreadId(options.threadId);
  if (!options.transportModule) throw new TypeError('--transport-module is required; this collector does not define an app-server protocol.');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const moduleUrl = pathToFileURL(path.resolve(options.transportModule)).href;
  const adapter = await import(moduleUrl);
  const transport = adapter.transport ?? adapter.default;
  const result = await collectCodexWorkflow({ transport, threadId: options.threadId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
