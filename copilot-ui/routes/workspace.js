'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const WORKSPACE_CONFIG_FILE = 'elegy.workspace.json';
const MAX_COMMANDS = 50;
const ALLOWED_KINDS = new Set(['dev', 'test', 'check', 'build', 'lint', 'clean', 'deploy', 'custom']);

// Shell metacharacters that must not appear in command or args
// Backslash is excluded since Windows paths use \ and shell: false prevents interpretation
const SHELL_META_RE = /[;&|`$(){}!<>#*\?\[\]]/;

function shellEscapePathPosix(filePath) {
  // Wrap in single quotes, escaping embedded single quotes.
  // Safe for cd, args, and other POSIX shell contexts.
  const escaped = String(filePath).replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function containsShellMeta(value) {
  return SHELL_META_RE.test(value);
}

function validateCommand(command, args) {
  if (!isNonEmptyString(command)) return { ok: false, error: 'command is empty' };
  if (containsShellMeta(command)) return { ok: false, error: 'command contains shell metacharacters' };
  if (command.includes('/') || command.includes('\\')) {
    // Allow relative paths only if they don't escape
    const normalized = path.normalize(command);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return { ok: false, error: 'command path escapes repository root' };
    }
  }
  if (!Array.isArray(args)) return { ok: false, error: 'args must be an array' };
  for (const arg of args) {
    if (typeof arg !== 'string') return { ok: false, error: 'all args must be strings' };
    if (containsShellMeta(arg)) return { ok: false, error: `arg contains shell metacharacters: ${arg}` };
  }
  return { ok: true };
}

function validateCwd(cwd, root) {
  if (!cwd) return { ok: true, resolved: root };
  const resolved = path.resolve(root, cwd);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: 'cwd escapes repository root' };
  }
  return { ok: true, resolved };
}

function readWorkspaceConfig(repoPath) {
  const configPath = path.join(repoPath, WORKSPACE_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return normalizeWorkspaceConfig(parsed);
  } catch {
    return null;
  }
}

function normalizeWorkspaceConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const commands = Array.isArray(raw.commands) ? raw.commands : [];
  const normalized = commands
    .slice(0, MAX_COMMANDS)
    .map((cmd) => normalizeCommand(cmd))
    .filter(Boolean);
  return { commands: normalized };
}

function normalizeCommand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeString(raw.id);
  const label = normalizeString(raw.label);
  const command = normalizeString(raw.command);
  if (!id || !label || !command) return null;

  const kind = normalizeString(raw.kind);
  if (!Array.isArray(raw.args)) return null;
  if (raw.args.some((a) => typeof a !== 'string')) return null;
  const args = raw.args.map((a) => a.trim()).filter((a) => a.length > 0);
  const cwd = normalizeString(raw.cwd);
  const description = normalizeString(raw.description);
  const confirm = Boolean(raw.confirm);
  const longRunning = Boolean(raw.longRunning);
  const envProfile = normalizeString(raw.envProfile);

  return {
    id,
    label,
    kind: ALLOWED_KINDS.has(kind) ? kind : 'custom',
    command,
    args,
    cwd: cwd || undefined,
    description: description || undefined,
    confirm,
    longRunning,
    envProfile: envProfile || undefined,
  };
}

function detectPackageScripts(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    return Object.entries(scripts)
      .slice(0, 20)
      .map(([name, cmd]) => ({
        id: `npm:${name}`,
        label: `npm run ${name}`,
        kind: name === 'test' ? 'test' : name === 'build' ? 'build' : name === 'lint' ? 'check' : 'custom',
        command: 'npm',
        args: ['run', name],
        description: typeof cmd === 'string' ? cmd : undefined,
        detected: true,
      }));
  } catch {
    return [];
  }
}

function handleGetCommands(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  const root = repoPath.trim();
  if (!fs.existsSync(root)) {
    sendJson(res, 404, { error: 'Repository path not found' });
    return;
  }

  const config = readWorkspaceConfig(root);
  const detected = detectPackageScripts(root);

  sendJson(res, 200, {
    repoPath: root,
    commands: config ? config.commands : [],
    detected,
    hasConfig: config !== null,
  });
}

async function handleRunCommand(ctx, deps) {
  const { res } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const repoPath = normalizeString(body?.repoPath);
  const commandId = normalizeString(body?.commandId);

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath is required' });
    return;
  }

  if (!isNonEmptyString(commandId)) {
    sendJson(res, 400, { error: 'commandId is required' });
    return;
  }

  const root = repoPath.trim();
  if (!fs.existsSync(root)) {
    sendJson(res, 404, { error: 'Repository path not found' });
    return;
  }

  const config = readWorkspaceConfig(root);
  if (!config) {
    sendJson(res, 404, { error: 'No elegy.workspace.json found in repository' });
    return;
  }

  const command = config.commands.find((c) => c.id === commandId);
  if (!command) {
    sendJson(res, 404, { error: `Command '${commandId}' not found in workspace config` });
    return;
  }

  const cmdValidation = validateCommand(command.command, command.args);
  if (!cmdValidation.ok) {
    sendJson(res, 403, { error: `Command validation failed: ${cmdValidation.error}` });
    return;
  }

  const cwdValidation = validateCwd(command.cwd, root);
  if (!cwdValidation.ok) {
    sendJson(res, 403, { error: `CWD validation failed: ${cwdValidation.error}` });
    return;
  }

  try {
    const child = spawn(command.command, command.args, {
      cwd: cwdValidation.resolved,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const exitCode = await new Promise((resolve) => {
      let timer = setTimeout(() => { child.kill(); resolve(-1); }, 30000);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(-2);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });

    const errorSuffix = exitCode === -2 ? ' (spawn error)' : '';
    sendJson(res, exitCode === -2 ? 500 : 200, {
      commandId,
      exitCode,
      stdout: stdout.slice(0, 10000),
      stderr: (stderr + errorSuffix).slice(0, 10000),
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

function handleGetLaunchers(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const launchers = detectLaunchers();
  sendJson(res, 200, { launchers });
}

function detectLaunchers() {
  const { execSync } = require('child_process');
  const platform = process.platform;
  const candidates = [
    { id: 'vscode', label: 'VS Code', cmd: 'code', group: 'ides' },
    { id: 'codium', label: 'VSCodium', cmd: 'codium', group: 'ides' },
    { id: 'cursor', label: 'Cursor', cmd: 'cursor', group: 'ides' },
    { id: 'windsurf', label: 'Windsurf', cmd: 'windsurf', group: 'ides' },
    { id: 'opencode', label: 'OpenCode CLI', cmd: 'opencode', group: 'agents' },
    { id: 'codex', label: 'Codex CLI', cmd: 'codex', group: 'agents' },
    { id: 'copilot', label: 'Copilot CLI', cmd: 'copilot', group: 'agents' },
  ];

  const launchers = [];
  for (const c of candidates) {
    let available = false;
    try {
      if (platform === 'win32') {
        execSync(`where ${c.cmd}`, { stdio: 'ignore', timeout: 3000 });
      } else {
        execSync(`command -v ${c.cmd}`, { stdio: 'ignore', timeout: 3000 });
      }
      available = true;
    } catch {
      available = false;
    }
    launchers.push({
      id: c.id,
      label: c.label,
      group: c.group,
      command: c.cmd,
      available,
      reason: available ? undefined : `${c.cmd} not found in PATH`,
      argsPreview: `<repo-path>`,
    });
  }

  // Terminal is always available
  launchers.push({
    id: 'terminal',
    label: 'Terminal',
    group: 'terminals',
    command: 'terminal',
    available: true,
    argsPreview: process.platform === 'win32' ? '-NoExit -WorkingDirectory <repo-path>' : '--working-directory <repo-path>',
  });

  return launchers;
}

async function handleLaunch(ctx, deps) {
  const { res } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const launcherId = normalizeString(body?.launcherId);
  const repoPath = normalizeString(body?.repoPath);

  if (!isNonEmptyString(launcherId)) {
    sendJson(res, 400, { error: 'launcherId is required' });
    return;
  }

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath is required' });
    return;
  }

  const root = repoPath.trim();
  if (!fs.existsSync(root)) {
    sendJson(res, 404, { error: 'Repository path not found' });
    return;
  }

  const launchers = detectLaunchers();
  const launcher = launchers.find((l) => l.id === launcherId);
  if (!launcher) {
    sendJson(res, 404, { error: `Launcher '${launcherId}' not found` });
    return;
  }

  if (!launcher.available) {
    sendJson(res, 400, { error: `${launcher.label} is not available: ${launcher.reason || 'not installed'}` });
    return;
  }

  try {
    let cmd, args;
    const isAgent = launcher.group === 'agents';

    if (launcherId === 'terminal') {
      if (process.platform === 'win32') {
        cmd = 'pwsh';
        args = ['-NoExit', '-WorkingDirectory', root];
      } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = ['-a', 'Terminal', root];
      } else {
        cmd = 'x-terminal-emulator';
        args = ['--working-directory', root];
      }
    } else if (isAgent) {
      // Agent CLIs open inside an interactive terminal in the repo directory
      const agentCommand = launcher.command || launcher.cmd;
      if (process.platform === 'win32') {
        cmd = 'pwsh';
        args = ['-NoExit', '-WorkingDirectory', root, '-Command', `${agentCommand} .`];
      } else if (process.platform === 'darwin') {
        // Use osascript to tell Terminal to open a new window with the agent
        cmd = 'osascript';
        args = [
          '-e',
          `tell application "Terminal" to do script "cd ${shellEscapePathPosix(root)} && ${agentCommand} ."`,
        ];
      } else {
        cmd = 'x-terminal-emulator';
        args = ['--working-directory', root, '-e', agentCommand];
      }
    } else {
      cmd = launcher.command || launcher.cmd;
      args = [root];
    }

    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.unref();

    sendJson(res, 200, { ok: true, launcherId, repoPath: root });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/workspace/commands', handler: (ctx) => handleGetCommands(ctx, deps) },
    { method: 'POST', path: '/api/workspace/commands/run', handler: (ctx) => handleRunCommand(ctx, deps) },
    { method: 'GET', path: '/api/workspace/launchers', handler: (ctx) => handleGetLaunchers(ctx, deps) },
    { method: 'POST', path: '/api/workspace/launch', handler: (ctx) => handleLaunch(ctx, deps) },
  ];
}

module.exports = {
  register,
  validateCommand,
  validateCwd,
  containsShellMeta,
  handleGetCommands,
  handleRunCommand,
  handleGetLaunchers,
  handleLaunch,
  readWorkspaceConfig,
  normalizeCommand,
  detectPackageScripts,
};
