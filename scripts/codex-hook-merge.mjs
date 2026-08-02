import path from 'path';

export const ELEGY_HOOK_EVENTS = Object.freeze([
  'Stop',
  'PreCompact',
  'SessionStart',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
]);

export const MANAGED_SUBAGENT_TYPES = Object.freeze([
  'explorer',
  'reviewer',
  'reviewer_strong',
  'worker',
  'test-runner',
  'sweeper',
]);

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function quoteCommandPath(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function toPortableCommandPath(value) {
  return String(value).replace(/\\/g, '/');
}

function commandFor(runtimeFile, event) {
  return `node ${quoteCommandPath(toPortableCommandPath(runtimeFile))} ${event}`;
}

function commandForWindows(runtimeFile, event) {
  return `node ${quoteCommandPath(runtimeFile)} ${event}`;
}

function handler(runtimeFile, event, options = {}) {
  return {
    type: 'command',
    command: commandFor(runtimeFile, event),
    commandWindows: commandForWindows(runtimeFile, event),
    timeout: options.timeout || 3,
    ...(options.additionalContextLimit ? { additionalContextLimit: options.additionalContextLimit } : {}),
  };
}

export function buildElegyHookDefinitions(runtimeFile) {
  if (!path.isAbsolute(runtimeFile)) {
    throw new Error('Elegy hook runtime path must be absolute');
  }
  const managedAgentMatcher = `^(?:${MANAGED_SUBAGENT_TYPES.map((value) => value.replace(/[-_]/g, '\\$&')).join('|')})$`;
  return [
    { event: 'Stop', group: { hooks: [handler(runtimeFile, 'Stop')] } },
    { event: 'PreCompact', group: { matcher: 'manual|auto', hooks: [handler(runtimeFile, 'PreCompact')] } },
    {
      event: 'SessionStart',
      group: { matcher: 'compact', hooks: [handler(runtimeFile, 'SessionStart', { additionalContextLimit: 1500 })] },
    },
    {
      event: 'SubagentStart',
      group: { matcher: managedAgentMatcher, hooks: [handler(runtimeFile, 'SubagentStart', { additionalContextLimit: 600 })] },
    },
    { event: 'SubagentStop', group: { matcher: managedAgentMatcher, hooks: [handler(runtimeFile, 'SubagentStop')] } },
    { event: 'SessionEnd', group: { hooks: [handler(runtimeFile, 'SessionEnd')] } },
  ];
}

function validateHandler(value, label) {
  const handlerValue = asObject(value, label);
  if (handlerValue.type !== 'command' || typeof handlerValue.command !== 'string' || !handlerValue.command.trim()) {
    throw new Error(`${label} must be a command hook with a command`);
  }
  if (handlerValue.commandWindows !== undefined && typeof handlerValue.commandWindows !== 'string') {
    throw new Error(`${label}.commandWindows must be a string when present`);
  }
}

export function validateHooksDocument(document) {
  const root = asObject(document, 'hooks.json');
  if (root.hooks === undefined) {
    return true;
  }
  const hooks = asObject(root.hooks, 'hooks.json.hooks');
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      throw new Error(`hooks.json.hooks.${event} must be an array`);
    }
    for (const [index, group] of groups.entries()) {
      const groupValue = asObject(group, `hooks.json.hooks.${event}[${index}]`);
      if (!Array.isArray(groupValue.hooks)) {
        throw new Error(`hooks.json.hooks.${event}[${index}].hooks must be an array`);
      }
      groupValue.hooks.forEach((hook, hookIndex) => validateHandler(hook, `hooks.json.hooks.${event}[${index}].hooks[${hookIndex}]`));
    }
  }
  return true;
}

export function parseHooksDocument(text = '') {
  if (!String(text).trim()) {
    return { hooks: {} };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`Existing hooks.json is invalid JSON: ${error.message}`);
  }
  validateHooksDocument(document);
  return document;
}

function handlerSignature(handlerValue) {
  return {
    command: typeof handlerValue?.command === 'string' ? handlerValue.command : '',
    commandWindows: typeof handlerValue?.commandWindows === 'string' ? handlerValue.commandWindows : '',
  };
}

function handlerSignatures(definition) {
  const item = definition?.group?.hooks?.[0] || {};
  return [handlerSignature(item)];
}

function receiptSignatures(receipt) {
  return Array.isArray(receipt?.managedHandlers)
    ? receipt.managedHandlers.map(handlerSignature)
    : [];
}

function isExactManagedHandler(value, knownSignatures) {
  if (!value || typeof value !== 'object' || value.type !== 'command') {
    return false;
  }
  const signature = handlerSignature(value);
  return knownSignatures.some((known) => known.command === signature.command && known.commandWindows === signature.commandWindows);
}

function isManagedGroupEnvelope(group) {
  return Object.keys(group).every((key) => key === 'matcher' || key === 'hooks');
}

function removeManagedHandlers(document, definitions, receipt) {
  const knownSignatures = [
    ...definitions.flatMap(handlerSignatures),
    ...receiptSignatures(receipt),
  ];
  if (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) {
    document.hooks = {};
  }
  for (const [event, groups] of Object.entries(document.hooks)) {
    if (!Array.isArray(groups)) continue;
    document.hooks[event] = groups.filter((group) => {
      if (!group || !Array.isArray(group.hooks)) return true;
      const originalHooks = group.hooks;
      group.hooks = originalHooks.filter((value) => !isExactManagedHandler(value, knownSignatures));
      const removedManagedHandler = group.hooks.length !== originalHooks.length;
      return !(removedManagedHandler && group.hooks.length === 0 && isManagedGroupEnvelope(group));
    });
  }
}

function countExactHandlers(document, definition) {
  const expected = definition.group.hooks[0];
  const groups = document?.hooks?.[definition.event];
  if (!Array.isArray(groups)) return 0;
  return groups.flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : [])
    .filter((candidate) => candidate?.command === expected.command && candidate?.commandWindows === expected.commandWindows)
    .length;
}

export function mergeElegyHooksDocument(existingText, definitions, receipt = {}) {
  const document = clone(parseHooksDocument(existingText));
  removeManagedHandlers(document, definitions, receipt);
  for (const definition of definitions) {
    if (!Array.isArray(document.hooks[definition.event])) {
      document.hooks[definition.event] = [];
    }
    document.hooks[definition.event].push(clone(definition.group));
  }
  validateHooksDocument(document);
  for (const definition of definitions) {
    if (countExactHandlers(document, definition) !== 1) {
      throw new Error(`Merged hooks.json must contain exactly one managed ${definition.event} command`);
    }
  }
  return document;
}

export function uninstallElegyHooksDocument(existingText, definitions, receipt = {}) {
  const document = clone(parseHooksDocument(existingText));
  removeManagedHandlers(document, definitions, receipt);
  validateHooksDocument(document);
  return document;
}

export function createHookReceipt(runtimeDirectory, definitions, runtimeHash = '') {
  return {
    schemaVersion: 1,
    runtimeDirectory,
    runtimeHash,
    managedHandlers: definitions.map((definition) => ({
      event: definition.event,
      command: definition.group.hooks[0].command,
      commandWindows: definition.group.hooks[0].commandWindows,
    })),
  };
}

export function serializeHooksDocument(document) {
  validateHooksDocument(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}
