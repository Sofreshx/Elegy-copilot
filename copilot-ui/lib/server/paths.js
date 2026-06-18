'use strict';

const os = require('os');
const path = require('path');

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

function resolveElegyHome(args, options = {}) {
  if (args && typeof args.elegyHome === 'string' && args.elegyHome.trim()) {
    return path.resolve(args.elegyHome);
  }

  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()) {
    return path.resolve(env.XDG_CONFIG_HOME);
  }

  return path.join(resolveHomeDirectory(options), '.elegy');
}

function resolveSandboxesHome(args, options = {}) {
  if (args && typeof args.sandboxesHome === 'string' && args.sandboxesHome.trim()) {
    return path.resolve(args.sandboxesHome);
  }
  return path.join(resolveHomeDirectory(options), '.elegy', 'sandboxes');
}

function resolveSessionsHome(source, elegyHome, sandboxesHome) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'sandbox') return { source: 'sandbox', home: sandboxesHome };
  return { source: 'cli', home: elegyHome };
}

module.exports = {
  resolveElegyHome,
  resolveSandboxesHome,
  resolveSessionsHome,
};
