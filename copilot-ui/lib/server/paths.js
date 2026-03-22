'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MESSAGING_GATEWAY_CONFIG_PATH_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH';
const MESSAGING_GATEWAY_CONFIG_FILENAME = 'messaging-gateway.config.json';

function resolveHomeDirectory(options = {}) {
  if (typeof options.homeDir === 'string' && options.homeDir.trim()) {
    return path.resolve(options.homeDir.trim());
  }

  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (typeof env.HOME === 'string' && env.HOME.trim()) {
    return path.resolve(env.HOME.trim());
  }
  if (typeof env.USERPROFILE === 'string' && env.USERPROFILE.trim()) {
    return path.resolve(env.USERPROFILE.trim());
  }

  const osModule = options.osModule || os;
  return path.resolve(osModule.homedir());
}

function resolveCopilotHome(args, options = {}) {
  if (args && typeof args.copilotHome === 'string' && args.copilotHome.trim()) {
    return path.resolve(args.copilotHome);
  }

  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()) {
    return path.resolve(env.XDG_CONFIG_HOME);
  }

  return path.join(resolveHomeDirectory(options), '.copilot');
}

function defaultVscodeHome(options = {}) {
  return path.join(resolveHomeDirectory(options), '.copilot');
}

function resolveVscodeHome(args, options = {}) {
  if (args && typeof args.vscodeHome === 'string' && args.vscodeHome.trim()) {
    return path.resolve(args.vscodeHome);
  }
  return defaultVscodeHome(options);
}

function resolveSandboxesHome(args, options = {}) {
  if (args && typeof args.sandboxesHome === 'string' && args.sandboxesHome.trim()) {
    return path.resolve(args.sandboxesHome);
  }
  return path.join(resolveHomeDirectory(options), '.copilot', 'sandboxes');
}

function getDefaultMessagingGatewayConfigPath(options = {}) {
  return path.resolve(path.join(
    resolveHomeDirectory(options),
    '.copilot',
    MESSAGING_GATEWAY_CONFIG_FILENAME
  ));
}

function getLegacyMessagingGatewayConfigPaths(copilotHomeAbs, options = {}) {
  const candidates = [
    path.resolve(path.join(
      resolveHomeDirectory(options),
      '.instruction-engine',
      MESSAGING_GATEWAY_CONFIG_FILENAME
    )),
  ];

  if (typeof copilotHomeAbs === 'string' && copilotHomeAbs.trim()) {
    candidates.push(path.resolve(path.join(copilotHomeAbs, MESSAGING_GATEWAY_CONFIG_FILENAME)));
  }

  return [...new Set(candidates)];
}

function rehomeLegacyMessagingGatewayConfigIfNeeded(copilotHomeAbs, canonicalPath, options = {}) {
  const fsModule = options.fsModule || fs;
  const canonicalPathAbs = path.resolve(canonicalPath);
  const legacyPaths = getLegacyMessagingGatewayConfigPaths(copilotHomeAbs, options);

  for (const legacyPath of legacyPaths) {
    if (legacyPath === canonicalPathAbs) {
      continue;
    }

    try {
      if (!fsModule.existsSync(legacyPath) || !fsModule.statSync(legacyPath).isFile()) {
        continue;
      }
    } catch {
      continue;
    }

    try {
      if (fsModule.existsSync(canonicalPathAbs)) {
        return;
      }
    } catch {
      return;
    }

    try {
      fsModule.mkdirSync(path.dirname(canonicalPathAbs), { recursive: true });
      fsModule.renameSync(legacyPath, canonicalPathAbs);
      return;
    } catch {
      // fallback to copy + atomic rename below
    }

    const tmpPath = `${canonicalPathAbs}.tmp.${process.pid}.${Date.now()}`;
    try {
      const legacyContents = fsModule.readFileSync(legacyPath);
      fsModule.writeFileSync(tmpPath, legacyContents);
      fsModule.renameSync(tmpPath, canonicalPathAbs);

      try {
        fsModule.unlinkSync(legacyPath);
      } catch {
        // best-effort legacy cleanup after successful rehome
      }
      return;
    } catch {
      try {
        if (fsModule.existsSync(tmpPath)) {
          fsModule.unlinkSync(tmpPath);
        }
      } catch {
        // best-effort temp cleanup
      }
    }
  }
}

function resolveMessagingGatewayConfigPath(copilotHomeAbs, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const explicitPath = env[MESSAGING_GATEWAY_CONFIG_PATH_ENV];
  if (typeof explicitPath === 'string' && explicitPath.trim()) {
    return path.resolve(explicitPath.trim());
  }

  const defaultPath = getDefaultMessagingGatewayConfigPath(options);
  rehomeLegacyMessagingGatewayConfigIfNeeded(copilotHomeAbs, defaultPath, options);
  return defaultPath;
}

function resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'vscode') return { source: 'vscode', home: vscodeHome };
  if (normalized === 'sandbox') return { source: 'sandbox', home: sandboxesHome };
  return { source: 'cli', home: copilotHome };
}

module.exports = {
  MESSAGING_GATEWAY_CONFIG_PATH_ENV,
  MESSAGING_GATEWAY_CONFIG_FILENAME,
  resolveCopilotHome,
  defaultVscodeHome,
  resolveVscodeHome,
  resolveSandboxesHome,
  getDefaultMessagingGatewayConfigPath,
  getLegacyMessagingGatewayConfigPaths,
  rehomeLegacyMessagingGatewayConfigIfNeeded,
  resolveMessagingGatewayConfigPath,
  resolveSessionsHome,
};
