'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { sendJson, readJsonBody } = require('./_helpers');
const { detectWsl2Capability } = require('../lib/server/runtimeHealth');
const { CAPABILITY_STATES } = require('../lib/runtimeContracts');
const { readConfig, writeConfig } = require('../lib/opencodeConfig');

/**
 * GET /api/shell/status
 * Returns shell configuration status across all harnesses.
 */
function handleShellStatus(ctx) {
  const { res } = ctx;

  try {
    const engineRoot = path.resolve(__dirname, '..');
    const opencodeHome = path.join(os.homedir(), '.config', 'opencode');
    const codexHome = path.join(os.homedir(), '.codex');

    // 1. WSL2 capability
    let wsl2Status;
    let wsl2Detail;
    try {
      wsl2Status = detectWsl2Capability();
    } catch {
      wsl2Status = CAPABILITY_STATES.UNKNOWN;
    }

    if (wsl2Status === CAPABILITY_STATES.AVAILABLE) {
      wsl2Detail = getWsl2Detail();
    } else {
      wsl2Detail = wsl2Status === CAPABILITY_STATES.UNKNOWN ? 'Not applicable (non-Windows)' : 'Not detected';
    }

    // 2. Detected shell via shell-detect.mjs
    let detectedShell = null;
    let shellDetectError = false;
    try {
      const shellDetectScript = path.join(engineRoot, 'scripts', 'shell-detect.mjs');
      if (fs.existsSync(shellDetectScript)) {
        const result = execSync(`node "${shellDetectScript}" --json`, {
          cwd: engineRoot,
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(result.trim());
        if (parsed && typeof parsed === 'object' && parsed.type) {
          detectedShell = {
            type: parsed.type,
            path: parsed.path,
            posix: Boolean(parsed.posix),
          };
        } else {
          detectedShell = null;
        }
      }
    } catch {
      detectedShell = null;
      shellDetectError = true;
    }

    // 3. OpenCode config
    let opencodeShell = null;
    let opencodeConfigured = false;
    try {
      const configPath = path.join(opencodeHome, 'opencode.jsonc');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const shellMatch = raw.match(/"shell"\s*:\s*"([^"]+)"/);
        if (shellMatch) {
          opencodeShell = shellMatch[1];
          opencodeConfigured = true;
        }
      }
    } catch {
      // not configured
    }

    // 4. Codex config
    let codexShell = null;
    let codexConfigured = false;
    try {
      const configPath = path.join(codexHome, 'config.toml');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const shellMatch = raw.match(/\[windows\]\s*\n\s*shell\s*=\s*"([^"]+)"/);
        if (shellMatch) {
          codexShell = shellMatch[1];
          codexConfigured = true;
        }
      }
    } catch {
      // not configured
    }

    // 5. Build checks
    const checks = [];

    // wsl2 check
    checks.push({
      id: 'wsl2',
      label: 'WSL2 available',
      status: wsl2Status === CAPABILITY_STATES.AVAILABLE ? 'ok' : 'warning',
      detail: wsl2Detail,
    });

    // shell-detect check
    checks.push({
      id: 'shell-detect',
      label: 'Shell detection',
      status: detectedShell && detectedShell.posix ? 'ok' : 'warning',
      detail: detectedShell
        ? `${detectedShell.type === 'wsl' ? 'WSL bash' : detectedShell.type} (${detectedShell.path})`
        : shellDetectError
          ? 'Shell detection script failed'
          : 'No POSIX shell found',
    });

    // opencode-shell check
    checks.push({
      id: 'opencode-shell',
      label: 'OpenCode shell',
      status: opencodeConfigured ? 'ok' : 'warning',
      detail: opencodeConfigured
        ? `Configured: ${opencodeShell}`
        : 'Not configured',
    });

    // codex-shell check
    checks.push({
      id: 'codex-shell',
      label: 'Codex shell',
      status: codexConfigured ? 'ok' : 'warning',
      detail: codexConfigured
        ? `Configured: ${codexShell}`
        : 'Not configured',
    });

    const wsl2Label = wsl2Status === CAPABILITY_STATES.AVAILABLE ? 'available' : (wsl2Status === CAPABILITY_STATES.UNKNOWN ? 'unknown' : 'unavailable');

    const response = {
      wsl2: wsl2Label,
      detectedShell,
      harnesses: {
        opencode: {
          shell: opencodeShell,
          configured: opencodeConfigured,
        },
        codex: {
          shell: codexShell,
          configured: codexConfigured,
        },
      },
      checks,
    };

    sendJson(res, 200, response);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

/**
 * GET /api/shell/options
 * Returns all available shell types with warnings metadata.
 */
function handleShellOptions(ctx) {
  const { res } = ctx;

  try {
    const engineRoot = path.resolve(__dirname, '..');
    const shellDetectScript = path.join(engineRoot, 'scripts', 'shell-detect.mjs');

    let detectedShells = [];
    try {
      if (fs.existsSync(shellDetectScript)) {
        const result = execSync(`node "${shellDetectScript}" --all --json`, {
          cwd: engineRoot,
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(result.trim());
        if (Array.isArray(parsed)) {
          detectedShells = parsed;
        }
      }
    } catch {
      // return empty array on detection failure
    }

    const SHELL_WARNINGS = {
      wsl: [
        'Does not resolve Windows .exe tools (gh, node, npm) without the .exe suffix. Install tools inside WSL or switch to Git Bash.',
        'Requires WSL2 with a default distribution.',
      ],
      gitbash: [],
      coreutils: [
        'Aliases may override standard POSIX commands (ls, find, grep).',
        'Slow detection via winget (~5s).',
      ],
      pwsh: [
        '~300ms startup overhead per command.',
        'Syntax differs from bash — agent training data is primarily bash.',
        'Some POSIX commands (grep, sed, find) are absent.',
      ],
      powershell: [
        '~500ms startup overhead per command.',
        'Syntax differs from bash — use as last resort.',
        'Many POSIX commands are absent.',
      ],
    };

    const SHELL_LABELS = {
      wsl: 'WSL Bash',
      gitbash: 'Git Bash (MSYS2)',
      coreutils: 'Coreutils pwsh',
      pwsh: 'PowerShell 7+',
      powershell: 'Windows PowerShell',
    };

    const options = detectedShells.map((shell) => ({
      type: shell.type,
      label: SHELL_LABELS[shell.type] || shell.type,
      path: shell.path,
      posix: Boolean(shell.posix),
      available: true,
      recommended: shell.type === 'gitbash',
      warnings: SHELL_WARNINGS[shell.type] || [],
    }));

    sendJson(res, 200, options);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

/**
 * PUT /api/shell/config
 * Sets the shell for a harness. Currently supports OpenCode only.
 * Body: { harness: 'opencode', shell: 'wsl'|'gitbash'|'pwsh'|'powershell' }
 */
async function handleSetShellConfig(ctx) {
  const { req, res } = ctx;

  try {
    const body = await readJsonBody(req);

    const harness = typeof body.harness === 'string' ? body.harness : '';
    const shellType = typeof body.shell === 'string' ? body.shell : '';

    if (!harness || !shellType) {
      sendJson(res, 400, { error: 'Both "harness" and "shell" are required.' });
      return;
    }

    if (harness !== 'opencode') {
      sendJson(res, 400, { error: 'Only "opencode" harness is currently supported for shell configuration.' });
      return;
    }

    // Resolve shell type to actual path via detection
    const engineRoot = path.resolve(__dirname, '..');
    const shellDetectScript = path.join(engineRoot, 'scripts', 'shell-detect.mjs');
    let shellPath = null;

    try {
      if (fs.existsSync(shellDetectScript)) {
        const result = execSync(`node "${shellDetectScript}" --all --json`, {
          cwd: engineRoot,
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(result.trim());
        if (Array.isArray(parsed)) {
          const match = parsed.find((s) => s.type === shellType);
          if (match) {
            shellPath = match.path;
          }
        }
      }
    } catch {
      // detection failed
    }

    if (!shellPath) {
      sendJson(res, 400, { error: `Shell type "${shellType}" was not detected on this system.` });
      return;
    }

    // Write to OpenCode config via opencodeConfig library
    const opencodeHome = path.join(os.homedir(), '.config', 'opencode');
    const config = readConfig(opencodeHome);
    const previousShell = config.shell || null;
    config.shell = shellPath;
    writeConfig(opencodeHome, config);

    const SHELL_WARNINGS = {
      wsl: [
        'Does not resolve Windows .exe tools (gh, node, npm) without the .exe suffix. Install tools inside WSL or switch to Git Bash.',
        'Requires WSL2 with a default distribution.',
      ],
      gitbash: [],
      coreutils: [
        'Aliases may override standard POSIX commands (ls, find, grep).',
        'Slow detection via winget (~5s).',
      ],
      pwsh: [
        '~300ms startup overhead per command.',
        'Syntax differs from bash — agent training data is primarily bash.',
        'Some POSIX commands (grep, sed, find) are absent.',
      ],
      powershell: [
        '~500ms startup overhead per command.',
        'Syntax differs from bash — use as last resort.',
        'Many POSIX commands are absent.',
      ],
    };
    const warnings = (SHELL_WARNINGS[shellType] || []).slice();

    sendJson(res, 200, {
      ok: true,
      harness,
      shell: shellType,
      path: shellPath,
      previousShell,
      warnings,
    });
  } catch (err) {
    if (err.statusCode === 413 || err.statusCode === 400) {
      sendJson(res, err.statusCode, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

/**
 * Parse the output of `wsl.exe --status` to extract distribution info.
 */
function getWsl2Detail() {
  try {
    const result = execSync('wsl.exe --status', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = result.trim().split('\n');
    const defaultLine = lines.find(l => l.includes('Default Distribution'));
    if (defaultLine) {
      const distro = defaultLine.split(':').pop()?.trim() || 'WSL2';
      return `WSL2 with ${distro}`;
    }
    return 'WSL2 available';
  } catch {
    return 'WSL2 available';
  }
}

function register() {
  return [
    { method: 'GET', path: '/api/shell/status', handler: handleShellStatus },
    { method: 'GET', path: '/api/shell/options', handler: handleShellOptions },
    { method: 'PUT', path: '/api/shell/config', handler: handleSetShellConfig },
  ];
}

module.exports = { register };
