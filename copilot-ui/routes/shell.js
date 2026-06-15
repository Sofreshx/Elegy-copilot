'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { sendJson } = require('./_helpers');
const { detectWsl2Capability } = require('../lib/server/runtimeHealth');
const { CAPABILITY_STATES } = require('../lib/runtimeContracts');

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
  ];
}

module.exports = { register };
