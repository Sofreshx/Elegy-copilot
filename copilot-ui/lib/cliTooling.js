'use strict';

const { isNpmAvailable } = require('./toolCliInstallers');

const CLI_TOOLING_CATALOG = Object.freeze([
  { id: 'opencode-cli', title: 'OpenCode CLI', npmPackage: 'opencode-ai', version: 'latest' },
  { id: 'codex-cli', title: 'Codex CLI', npmPackage: '@openai/codex', version: 'latest' },
  { id: 'claude-cli', title: 'Claude Code CLI', npmPackage: '@anthropic-ai/claude-code', version: 'latest' },
  { id: 'gemini-cli', title: 'Gemini CLI', npmPackage: 'gemini-cli', version: 'latest' },
  { id: 'elegy-planning', title: 'Elegy Planning CLI', npmPackage: null, managed: true, versionSource: 'elegy-planning --version', resolverModule: './elegyPlanningCliResolver' },
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
    const result = childProcess.spawnSync(cliPath, ['--version'], { timeout: 10000 });
    if (result.status === 0 && result.stdout) {
      return { installed: true, version: String(result.stdout).trim(), path: cliPath };
    }
    return { installed: true, path: cliPath, lastError: '--version check failed', version: null };
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
  try {
    const childProcess = options.childProcess || require('child_process');
    const result = childProcess.execSync(`npx ${tool.npmPackage} --version`, {
      timeout: 15_000,
      encoding: 'utf8',
      windowsHide: true,
      shell: true,
      ...(options.execOptions || {}),
    });
    const version = String(result).trim();
    return {
      id: tool.id,
      title: tool.title,
      installed: true,
      path: tool.npmPackage,
      version: version || null,
      lastError: null,
    };
  } catch (error) {
    return {
      id: tool.id,
      title: tool.title,
      installed: false,
      path: null,
      version: null,
      lastError: String(error.message || error).slice(0, 200),
    };
  }
}

module.exports = {
  CLI_TOOLING_CATALOG,
  resolveCliToolingCommand,
  runCliInstall,
  detectCliTool,
  detectElegyPlanningCli,
  probeAftClangd,
};
