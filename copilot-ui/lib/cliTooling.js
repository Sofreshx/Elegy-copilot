'use strict';

const { isNpmAvailable } = require('./toolCliInstallers');

const CLI_TOOLING_CATALOG = Object.freeze([
  { id: 'opencode-cli', title: 'OpenCode CLI', npmPackage: 'opencode-ai', version: 'latest' },
  { id: 'codex-cli', title: 'Codex CLI', npmPackage: '@openai/codex', version: 'latest' },
  { id: 'claude-cli', title: 'Claude Code CLI', npmPackage: '@anthropic-ai/claude-code', version: 'latest' },
  { id: 'gemini-cli', title: 'Gemini CLI', npmPackage: 'gemini-cli', version: 'latest' },
  { id: 'elegy-planning', title: 'Elegy Planning CLI', npmPackage: null, managed: true, versionSource: 'elegy-planning capabilities --json', resolverModule: './elegyPlanningCliResolver' },
]);

function resolveCliToolingCommand(toolId, options = {}) {
  const tool = CLI_TOOLING_CATALOG.find((entry) => entry.id === toolId);
  if (!tool) {
    return null;
  }
  const version = String(options.version || tool.version || 'latest');
  return `npm install -g ${tool.npmPackage}@${version}`;
}

function detectElegyPlanningCli(childProcess) {
  try {
    const resolver = require('./elegyPlanningCliResolver');
    const cliPath = resolver.resolveElegyPlanningCliPath();
    if (!cliPath) {
      return { installed: false, lastError: 'Not installed. Use managed install from Tooling Updates.' };
    }
    const health = require('./elegyPlanningHealth');
    const version = health.resolvePlanningCliVersion(cliPath, childProcess);
    if (version) {
      return { installed: true, version, path: cliPath };
    }
    return { installed: true, path: cliPath, lastError: 'version probe failed', version: null };
  } catch (err) {
    return { installed: false, lastError: err.message };
  }
}

function probeAftClangd(childProcess) {
  try {
    // Check if clangd is on PATH
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const clangdResult = childProcess.spawnSync(cmd, ['clangd'], { timeout: 5000 });
    if (clangdResult.status === 0 && clangdResult.stdout) {
      const clangdPath = String(clangdResult.stdout).trim().split('\n')[0];
      // Try version check
      const versionResult = childProcess.spawnSync(clangdPath || 'clangd', ['--version'], { timeout: 5000 });
      return {
        installed: true,
        version: versionResult.status === 0 ? String(versionResult.stdout).trim().split('\n')[0] : null,
        path: clangdPath,
      };
    }
    return {
      installed: false,
      lastError: 'clangd not found on system PATH',
      remediation: [
        'Install clangd: https://clangd.llvm.org/installation.html',
        'Check plugin log for LSP install errors',
        'Set lsp.auto_install to false if auto-install is failing',
        'Check lsp.versions.clangd in your OpenCode/Codex config',
        'Use /aft-status in your AI agent to check AFT health',
      ],
    };
  } catch (err) {
    return { installed: false, lastError: err.message };
  }
}

function runCliInstall(toolId, options = {}) {
  const catalog = CLI_TOOLING_CATALOG.find((t) => t.id === toolId);
  if (catalog && catalog.managed) {
    if (toolId === 'elegy-planning') {
      try {
        const resolver = require('./elegyPlanningCliResolver');
        const result = resolver.installLatestElegyPlanningCli
          ? resolver.installLatestElegyPlanningCli()
          : resolver.downloadElegyPlanningCli();
        return { ok: true, toolId, message: 'Managed installer triggered. Check status after install.' };
      } catch (err) {
        return { ok: false, error: err.message, toolId };
      }
    }
    return { ok: false, error: 'Managed install not supported for this tool', toolId };
  }
  const command = resolveCliToolingCommand(toolId, options);
  if (!command) {
    return { ok: false, error: `Unknown CLI tool: ${toolId}` };
  }
  if (options.dryRun) {
    return { ok: true, dryRun: true, command };
  }
  if (!isNpmAvailable()) {
    return { ok: false, error: 'npm is not available on this system. Install Node.js (which includes npm) from https://nodejs.org/' };
  }
  try {
    const childProcess = options.childProcess || require('child_process');
    const execOptions = { timeout: 120_000, encoding: 'utf8', ...(options.execOptions || {}) };
    const output = childProcess.execSync(command, execOptions);
    return { ok: true, dryRun: false, command, output: String(output).trim() };
  } catch (error) {
    return {
      ok: false,
      error: String(error.message || error),
      command,
      stderr: error.stderr ? String(error.stderr).trim().slice(0, 500) : null,
    };
  }
}

function detectCliTool(toolId, options = {}) {
  const { childProcess } = options;

  // Special handling for managed tools (not npm-based)
  const catalogEntry = CLI_TOOLING_CATALOG.find((entry) => entry.id === toolId);
  if (catalogEntry && catalogEntry.managed) {
    if (toolId === 'elegy-planning') {
      return detectElegyPlanningCli(childProcess);
    }
    return { installed: false, lastError: 'Unknown managed tool' };
  }

  const tool = CLI_TOOLING_CATALOG.find((entry) => entry.id === toolId);
  if (!tool) {
    return { id: toolId, title: null, installed: false, path: null, version: null, error: `Unknown CLI tool: ${toolId}` };
  }
  const cp = options.childProcess || require('child_process');

  // Win10-friendly probe order:
  //   1. `npx <pkg> --version` via spawnSync (avoids execSync shell-quoting issues on Win10)
  //   2. `where <pkg>` (Win) / `which <pkg>` (POSIX) to detect the global binary on PATH
  //   3. treat as not installed
  try {
    const spawnResult = cp.spawnSync('npx', [tool.npmPackage, '--version'], {
      timeout: 10_000,
      encoding: 'utf8',
      windowsHide: true,
      shell: true,
      ...(options.execOptions || {}),
    });
    if (spawnResult.status === 0 && spawnResult.stdout) {
      const version = String(spawnResult.stdout).trim();
      return {
        id: tool.id,
        title: tool.title,
        installed: true,
        path: tool.npmPackage,
        version: version || null,
        lastError: null,
      };
    }
  } catch {
    // fall through to PATH probe
  }

  try {
    const probeCmd = process.platform === 'win32' ? 'where' : 'which';
    const probeResult = cp.spawnSync(probeCmd, [tool.npmPackage], {
      timeout: 5_000,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (probeResult.status === 0 && probeResult.stdout) {
      const binPath = String(probeResult.stdout).trim().split(/\r?\n/)[0] || null;
      return {
        id: tool.id,
        title: tool.title,
        installed: true,
        path: binPath,
        version: null,
        lastError: null,
      };
    }
  } catch {
    // fall through to not-installed
  }

  return {
    id: tool.id,
    title: tool.title,
    installed: false,
    path: null,
    version: null,
    lastError: `${tool.npmPackage} not found on PATH and npx probe failed`,
  };
}

module.exports = {
  CLI_TOOLING_CATALOG,
  resolveCliToolingCommand,
  runCliInstall,
  detectCliTool,
  detectElegyPlanningCli,
  probeAftClangd,
};
