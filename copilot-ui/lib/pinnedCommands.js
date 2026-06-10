'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ELEGY_HOME = path.join(os.homedir(), '.elegy');
const REPO_STATE_DIR = path.join(ELEGY_HOME, 'repo-state');

function getPinnedFilePath(repoId) {
  const sanitized = repoId.replace(/[<>:"/\\|?*]/g, '_');
  return path.join(REPO_STATE_DIR, sanitized, 'pinned-commands.json');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readPinnedCommands(repoId) {
  const filePath = getPinnedFilePath(repoId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writePinnedCommands(repoId, commands) {
  const filePath = getPinnedFilePath(repoId);
  ensureDir(filePath);
  // Write atomically
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(commands, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Pinned command shape (promoted from elegy.workspace.json shape):
 * {
 *   id: string,
 *   label: string,
 *   kind: string,           // dev|test|check|build|lint|clean|deploy|custom
 *   command: string,        // executable name
 *   args: string[],         // arguments array
 *   cwd?: string,           // relative path inside repo
 *   confirm: boolean,
 *   longRunning: boolean,
 *   // Source metadata
 *   sourceDocPath?: string,       // doc path where command was found
 *   sourceBlockId?: string,       // code block or line identifier
 *   sourceDocHash?: string,       // hash of source doc at pin time
 *   createdAt: string,            // ISO timestamp
 *   lastRunAt?: string,           // ISO timestamp
 *   lastExitCode?: number,
 *   pinnedBySourceHash?: string,  // hash to detect stale pins
 *   description?: string,
 * }
 */

const MAX_PINNED = 100;

function normalizePinnedCommand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!id || !label || !command) return null;

  return {
    id,
    label,
    kind: typeof raw.kind === 'string' ? raw.kind : 'custom',
    command,
    args: Array.isArray(raw.args) ? raw.args.filter(a => typeof a === 'string') : [],
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    confirm: Boolean(raw.confirm),
    longRunning: Boolean(raw.longRunning),
    sourceDocPath: typeof raw.sourceDocPath === 'string' ? raw.sourceDocPath : undefined,
    sourceBlockId: typeof raw.sourceBlockId === 'string' ? raw.sourceBlockId : undefined,
    sourceDocHash: typeof raw.sourceDocHash === 'string' ? raw.sourceDocHash : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : undefined,
    lastExitCode: typeof raw.lastExitCode === 'number' ? raw.lastExitCode : undefined,
    pinnedBySourceHash: typeof raw.pinnedBySourceHash === 'string' ? raw.pinnedBySourceHash : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
  };
}

function addPinnedCommand(repoId, commandData) {
  const normalized = normalizePinnedCommand(commandData);
  if (!normalized) return { ok: false, error: 'Invalid pinned command data' };

  const commands = readPinnedCommands(repoId);
  
  // Upsert by id
  const existing = commands.findIndex(c => c.id === normalized.id);
  if (existing >= 0) {
    commands[existing] = { ...commands[existing], ...normalized };
  } else {
    if (commands.length >= MAX_PINNED) {
      return { ok: false, error: `Maximum of ${MAX_PINNED} pinned commands reached` };
    }
    commands.push(normalized);
  }

  writePinnedCommands(repoId, commands);
  return { ok: true, command: normalized };
}

function removePinnedCommand(repoId, commandId) {
  const commands = readPinnedCommands(repoId);
  const idx = commands.findIndex(c => c.id === commandId);
  if (idx < 0) return { ok: false, error: `Command '${commandId}' not found` };
  
  commands.splice(idx, 1);
  writePinnedCommands(repoId, commands);
  return { ok: true };
}

function listPinnedCommands(repoId) {
  const commands = readPinnedCommands(repoId);
  return { commands };
}

module.exports = {
  addPinnedCommand,
  removePinnedCommand,
  listPinnedCommands,
  normalizePinnedCommand,
  MAX_PINNED,
};
