'use strict';

const { isNpmAvailable } = require('./toolCliInstallers');

const CLI_TOOLING_CATALOG = Object.freeze([
  { id: 'opencode-cli', title: 'OpenCode CLI', npmPackage: 'opencode-ai', version: 'latest' },
  { id: 'codex-cli', title: 'Codex CLI', npmPackage: '@openai/codex', version: 'latest' },
  { id: 'claude-cli', title: 'Claude Code CLI', npmPackage: '@anthropic-ai/claude-code', version: 'latest' },
  { id: 'gemini-cli', title: 'Gemini CLI', npmPackage: 'gemini-cli', version: 'latest' },
]);

function resolveCliToolingCommand(toolId, options = {}) {
  const tool = CLI_TOOLING_CATALOG.find((entry) => entry.id === toolId);
  if (!tool) {
    return null;
  }
  const version = String(options.version || tool.version || 'latest');
  return `npm install -g ${tool.npmPackage}@${version}`;
}

function runCliInstall(toolId, options = {}) {
  const command = resolveCliToolingCommand(toolId, options);
  if (!command) {
    return { ok: false, error: `Unknown CLI tool: ${toolId}` };
  }
  if (options.dryRun) {
    return { ok: true, dryRun: true, command };
  }
  if (!isNpmAvailable()) {
    return { ok: false, error: 'npm is not available on this system. Install Node.js from https://nodejs.org/' };
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
};
