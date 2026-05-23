'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EMBEDDED_DESKTOP_PLANNING_DB_URL,
  createEmbeddedPGlitePlanningPersistenceClient,
} = require('./planningPersistenceClient');

function defaultLogger(message) {
  console.log(message);
}

function log(logger, message) {
  (typeof logger === 'function' ? logger : defaultLogger)(`[desktop-planning-persistence] ${message}`);
}

async function startDesktopPlanningPersistence(options = {}) {
  const logger = options.logger;
  const stateRoot = typeof options.stateRoot === 'string' && options.stateRoot.trim()
    ? path.resolve(options.stateRoot.trim())
    : path.join(os.homedir(), '.copilot', 'planning-db');
  const dataDir = path.join(stateRoot, 'pglite');

  fs.mkdirSync(stateRoot, { recursive: true });
  log(logger, `opening embedded planning database at ${dataDir}`);

  const queryClient = createEmbeddedPGlitePlanningPersistenceClient({ dataDir });
  let stopped = false;

  return {
    connectionString: EMBEDDED_DESKTOP_PLANNING_DB_URL,
    queryClient,
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      await queryClient.close();
      log(logger, 'embedded planning database stopped');
    },
  };
}

module.exports = {
  EMBEDDED_DESKTOP_PLANNING_DB_URL,
  startDesktopPlanningPersistence,
};
