'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { GLOBAL_HARNESSES } = require('../lib/harnessCatalog');

// Mapping from harness catalog IDs to CLI commands. Only harnesses with a CLI binary.
const HARNESS_TO_CLI_MAP = Object.freeze({
  'copilot': { label: 'Copilot CLI', cmd: 'copilot' },
  'codex': { label: 'Codex CLI', cmd: 'codex' },
  'opencode': { label: 'OpenCode CLI', cmd: 'opencode' },
  'claude-code': { label: 'Claude Code CLI', cmd: 'claude' },
  'gemini-cli': { label: 'Gemini CLI', cmd: 'gemini' },
});

const pinnedCommands = require('../lib/pinnedCommands');

const WORKSPACE_CONFIG_FILE = 'elegy.workspace.json';
const MAX_COMMANDS = 50;
const ALLOWED_KINDS = new Set(['dev', 'test', 'check', 'build', 'lint', 'clean', 'deploy', 'custom']);

// Shell metacharacters that must not appear in command or args
// Backslash is excluded since Windows paths use \ and shell: false prevents interpretation
const SHELL_META_RE = /[;&|`$(){}!<>#*\?\[\]]/;

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
  try {
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
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
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
  let command = null;
  let pinnedCmd = null;

  // Try workspace config first
  if (config) {
    command = config.commands.find((c) => c.id === commandId);
  }

  // Fallback: check pinned commands
  if (!command) {
    const repoId = path.basename(root);
    const pinned = pinnedCommands.listPinnedCommands(repoId);
    pinnedCmd = pinned.commands.find((c) => c.id === commandId);
    if (pinnedCmd) {
      // Normalize pinned command to workspace command shape
      command = {
        id: pinnedCmd.id,
        label: pinnedCmd.label,
        kind: pinnedCmd.kind,
        command: pinnedCmd.command,
        args: pinnedCmd.args,
        cwd: pinnedCmd.cwd,
        confirm: pinnedCmd.confirm,
        longRunning: pinnedCmd.longRunning,
      };
    }
  }

  if (!command) {
    sendJson(res, 404, { error: `Command '${commandId}' not found in workspace config or pinned commands` });
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
    const child = childProcess.spawn(command.command, command.args, {
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

    // Update pinned command stats if applicable
    if (pinnedCmd) {
      const repoId = path.basename(root);
      pinnedCommands.addPinnedCommand(repoId, {
        ...pinnedCmd,
        lastRunAt: new Date().toISOString(),
        lastExitCode: exitCode,
      });
    }

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
  try {
    const launchers = detectLaunchers();
    sendJson(res, 200, { launchers });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

function detectLaunchers() {
  const { execSync } = require('child_process');
  const platform = process.platform;

  // IDE candidates (hardcoded — not derived from harness catalog)
  const ideCandidates = [
    { id: 'vscode', label: 'VS Code', cmd: 'code', group: 'ides' },
    { id: 'codium', label: 'VSCodium', cmd: 'codium', group: 'ides' },
    { id: 'cursor', label: 'Cursor', cmd: 'cursor', group: 'ides' },
    { id: 'windsurf', label: 'Windsurf', cmd: 'windsurf', group: 'ides' },
  ];

  // Agent CLI candidates derived from harness catalog + CLI map
  const agentCandidates = GLOBAL_HARNESSES
    .filter((h) => HARNESS_TO_CLI_MAP[h.id])
    .map((h) => {
      const entry = HARNESS_TO_CLI_MAP[h.id];
      return {
        id: h.id,
        label: entry.label,
        cmd: entry.cmd,
        group: 'agents',
      };
    });

  const candidates = [...ideCandidates, ...agentCandidates];

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
    });
  }

  // Terminal is always available
  launchers.push({
    id: 'terminal',
    label: 'Terminal',
    group: 'terminals',
    command: 'terminal',
    available: true,
  });

  return launchers;
}

function detectTerminal() {
  const platform = process.platform;
  if (platform !== 'win32') return null;

  const { execSync } = require('child_process');

  // 1. Probe WSL (highest priority — always preferred if available)
  try {
    const wsl = execSync('wsl.exe --status', { timeout: 3000, stdio: 'pipe' }).toString();
    if (wsl.includes('Default Distribution')) {
      return { type: 'wsl', cmd: 'wsl.exe', name: 'WSL' };
    }
  } catch { /* wsl not available */ }

  // 2. Probe Git Bash (avoid WSL's stub bash.exe in System32)
  try {
    const bash = execSync('where bash.exe', { timeout: 2000, stdio: 'pipe' }).toString().trim();
    if (bash && !bash.includes('System32')) {
      return { type: 'gitbash', cmd: bash.split('\n')[0].trim(), name: 'Git Bash' };
    }
  } catch { /* bash not found in PATH */ }

  // 3. Probe Git Bash via environment variable
  if (process.env.OPENCODE_GIT_BASH_PATH) {
    return { type: 'gitbash', cmd: process.env.OPENCODE_GIT_BASH_PATH, name: 'Git Bash' };
  }

  // 4. Existing probes: wt.exe, pwsh.exe, powershell.exe
  const candidates = [
    { cmd: 'wt.exe', type: 'wt' },
    { cmd: 'pwsh.exe', type: 'pwsh' },
    { cmd: 'powershell.exe', type: 'powershell' },
  ];

  for (const c of candidates) {
    try {
      execSync(`where ${c.cmd}`, { stdio: 'ignore', timeout: 3000 });
      return c;
    } catch { /* try next */ }
  }

  return { cmd: 'pwsh.exe', type: 'pwsh' };
}

function buildLauncherCommand(launcher, repoPath, platform, terminalInfo) {
  const isAgent = launcher.group === 'agents';
  const isTerminalObj = launcher.id === 'terminal';

  if (platform === 'win32') {
    // --- Terminal launcher ---
    if (isTerminalObj) {
      // WSL terminal — wsl.exe opens its own terminal window
      if (terminalInfo && terminalInfo.type === 'wsl') {
        const wslPath = repoPath.replace(/^([A-Z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, '/');
        return { cmd: 'wsl.exe', args: ['--cd', wslPath] };
      }
      // Git Bash terminal — bash.exe opens its own terminal window when spawned detached
      if (terminalInfo && terminalInfo.type === 'gitbash') {
        return { cmd: terminalInfo.cmd, args: ['-c', `cd '${repoPath}' && exec bash`] };
      }
      if (terminalInfo && terminalInfo.type === 'wt') {
        return { cmd: 'wt.exe', args: ['-d', repoPath, 'pwsh', '-NoExit'] };
      }
      const termCmd = terminalInfo ? terminalInfo.cmd : 'pwsh.exe';
      return { cmd: termCmd, args: ['-NoExit', '-Command', `Set-Location -LiteralPath '${repoPath}'`] };
    }

    // --- Agent CLI launcher ---
    if (isAgent) {
      // Map launcher id to its subcommand
      const AGENT_SUBCOMMANDS = {
        'opencode': 'opencode .',
        'codex': 'codex',
        'copilot': 'copilot',
        'claude-code': 'claude',
        'gemini-cli': 'gemini',
      };
      const agentSubCommand = AGENT_SUBCOMMANDS[launcher.id] || `${launcher.command} .`;

      // WSL agent — wsl.exe opens its own terminal window
      if (terminalInfo && terminalInfo.type === 'wsl') {
        const wslPath = repoPath.replace(/^([A-Z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, '/');
        return { cmd: 'wsl.exe', args: ['--cd', wslPath, '--', agentSubCommand] };
      }
      // Git Bash agent — bash.exe opens its own terminal window when spawned detached
      if (terminalInfo && terminalInfo.type === 'gitbash') {
        return { cmd: terminalInfo.cmd, args: ['-c', `cd '${repoPath}' && ${agentSubCommand} && exec bash`] };
      }
      if (terminalInfo && terminalInfo.type === 'wt') {
        return { cmd: 'wt.exe', args: ['-d', repoPath, 'pwsh', '-NoExit', '-Command', agentSubCommand] };
      }
      const termCmd = terminalInfo ? terminalInfo.cmd : 'pwsh.exe';
      return { cmd: termCmd, args: ['-NoExit', '-Command', `Set-Location -LiteralPath '${repoPath}'; ${agentSubCommand}`] };
    }

    // --- IDE launcher ---
    return { cmd: launcher.command, args: [repoPath] };
  }

  // --- macOS ---
  if (platform === 'darwin') {
    if (isTerminalObj) {
      return { cmd: 'open', args: ['-a', 'Terminal', repoPath] };
    }
    if (isAgent) {
      const agentCommand = launcher.command;
      return {
        cmd: 'osascript',
        args: [
          '-e',
          `tell application "Terminal" to do script "cd '${repoPath.replace(/'/g, "'\\''")}' && ${agentCommand} ."`,
        ],
      };
    }
    return { cmd: launcher.command, args: [repoPath] };
  }

  // --- Linux ---
  if (isTerminalObj) {
    return { cmd: 'x-terminal-emulator', args: ['--working-directory', repoPath] };
  }
  if (isAgent) {
    return { cmd: 'x-terminal-emulator', args: ['--working-directory', repoPath, '-e', launcher.command] };
  }
  return { cmd: launcher.command, args: [repoPath] };
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
    const platform = process.platform;
    const terminalInfo = detectTerminal();
    const launchCmd = buildLauncherCommand(launcher, root, platform, terminalInfo);

    if (!launchCmd) {
      sendJson(res, 500, { error: `Unsupported launcher: ${launcher.id}` });
      return;
    }

    let spawnEnv = null;
    if (launcherId === 'opencode' && deps.resolveOpencodeGoApiKey) {
      try {
        const activeKey = await deps.resolveOpencodeGoApiKey();
        if (activeKey) {
          spawnEnv = { ...process.env, OPENCODE_GO_API_KEY: String(activeKey).trim() };
        }
      } catch {
        spawnEnv = null;
      }
    }

    const child = childProcess.spawn(launchCmd.cmd, launchCmd.args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      ...(spawnEnv ? { env: spawnEnv } : {}),
    });
    child.unref();

    sendJson(res, 200, { ok: true, launcherId, repoPath: root });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

function handleGetPinnedCommands(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  // Derive repoId from path
  const repoId = path.basename(repoPath.trim());
  const result = pinnedCommands.listPinnedCommands(repoId);
  sendJson(res, 200, result);
}

async function handleCreatePinnedCommand(ctx, deps) {
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
  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath is required' });
    return;
  }

  const repoId = path.basename(repoPath.trim());
  const commandData = body?.command;
  if (!commandData || typeof commandData !== 'object') {
    sendJson(res, 400, { error: 'command object is required' });
    return;
  }

  // Apply the same validation as workspace commands
  const cmdValidation = validateCommand(commandData.command, commandData.args);
  if (!cmdValidation.ok) {
    sendJson(res, 403, { error: `Command validation failed: ${cmdValidation.error}` });
    return;
  }

  const cwdValidation = validateCwd(commandData.cwd, repoPath.trim());
  if (!cwdValidation.ok) {
    sendJson(res, 403, { error: `CWD validation failed: ${cwdValidation.error}` });
    return;
  }

  const result = pinnedCommands.addPinnedCommand(repoId, commandData);
  if (!result.ok) {
    sendJson(res, 400, { error: result.error });
    return;
  }
  sendJson(res, 200, result);
}

async function handleDeletePinnedCommand(ctx, deps) {
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

  const repoId = path.basename(repoPath.trim());
  const result = pinnedCommands.removePinnedCommand(repoId, commandId);
  if (!result.ok) {
    sendJson(res, 404, { error: result.error });
    return;
  }
  sendJson(res, 200, result);
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };
  if (typeof context.resolveOpencodeGoApiKey === 'function') {
    deps.resolveOpencodeGoApiKey = context.resolveOpencodeGoApiKey;
  }

  return [
    { method: 'GET', path: '/api/workspace/commands', handler: (ctx) => handleGetCommands(ctx, deps) },
    { method: 'POST', path: '/api/workspace/commands/run', handler: (ctx) => handleRunCommand(ctx, deps) },
    { method: 'GET', path: '/api/workspace/launchers', handler: (ctx) => handleGetLaunchers(ctx, deps) },
    { method: 'POST', path: '/api/workspace/launch', handler: (ctx) => handleLaunch(ctx, deps) },
    { method: 'GET', path: '/api/workspace/pinned-commands', handler: (ctx) => handleGetPinnedCommands(ctx, deps) },
    { method: 'POST', path: '/api/workspace/pinned-commands', handler: (ctx) => handleCreatePinnedCommand(ctx, deps) },
    { method: 'DELETE', path: '/api/workspace/pinned-commands/:id', handler: (ctx) => handleDeletePinnedCommand(ctx, deps) },
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
  handleGetPinnedCommands,
  handleCreatePinnedCommand,
  handleDeletePinnedCommand,
  readWorkspaceConfig,
  normalizeCommand,
  detectPackageScripts,
  buildLauncherCommand,
  detectTerminal,
  detectLaunchers,
};
