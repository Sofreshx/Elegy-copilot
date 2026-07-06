'use strict';

/**
 * Route registry and dispatcher.
 * Collects route descriptors from modules and matches incoming requests.
 */

class RouteRegistry {
  constructor() {
    /** @type {Array<{method: string, path: string|RegExp, handler: Function}>} */
    this._routes = [];
  }

  /**
   * Register routes from a module.
   * @param {{ register: (context: object) => Array<{method: string, path: string|RegExp, handler: Function}> }} mod
   * @param {object} context
   */
  registerModule(mod, context = {}) {
    if (typeof mod.register !== 'function') {
      throw new Error('Route module must export a register() function');
    }
    const routes = mod.register(context);
    if (!Array.isArray(routes)) {
      throw new Error('register() must return an array of route descriptors');
    }
    for (const route of routes) {
      if (!route.method || !route.path || typeof route.handler !== 'function') {
        throw new Error(`Invalid route descriptor: method=${route.method}, path=${route.path}`);
      }
      this._routes.push(route);
    }
  }

  /**
   * Get the total number of registered routes.
   */
  get count() {
    return this._routes.length;
  }

  /**
   * Dispatch a request to the matching route handler.
   * @param {object} ctx - The request context
   * @returns {boolean} true if a route was matched and handled, false otherwise
   */
  dispatch(ctx) {
    const { req, u } = ctx;
    const method = req.method;
    const pathname = u.pathname;

    for (const route of this._routes) {
      if (route.method !== method) continue;

      if (typeof route.path === 'string') {
        if (pathname === route.path) {
          ctx.pathname = pathname;
          ctx.match = null;
          route.handler(ctx);
          return true;
        }
      } else if (route.path instanceof RegExp) {
        const m = pathname.match(route.path);
        if (m) {
          ctx.pathname = pathname;
          ctx.match = m;
          route.handler(ctx);
          return true;
        }
      }
    }

    return false;
  }
}

/**
 * Create and populate a route registry with all route modules.
 * Route modules are loaded dynamically so this file stays a thin composition root.
 */
function createRegistry(context = {}) {
  const registry = new RouteRegistry();

  registry.registerModule(require('./lifecycle'), context);
  registry.registerModule(require('./assets'), context);
  registry.registerModule(require('./catalog'), context);
  registry.registerModule(require('./planning'), context);
  registry.registerModule(require('./planning-obsidian'), context);
  registry.registerModule(require('./sessions'), context);
  registry.registerModule(require('./uiRuntimeOverlay'), context);
  registry.registerModule(require('./kimaki'), context);
  registry.registerModule(require('./desktopUpdater'), context);
  registry.registerModule(require('./toolingUpdates'), context);
  registry.registerModule(require('./localRepoMcp'), context);
  registry.registerModule(require('./cliTooling'), context);
  registry.registerModule(require('./dashboard'), context);
  registry.registerModule(require('./telemetry'), context);

  registry.registerModule(require('./config'), context);
  registry.registerModule(require('./opencode'), context);
  registry.registerModule(require('./codex'), context);
  registry.registerModule(require('./claudeCode'), context);
  registry.registerModule(require('./lexicon'), context);
  registry.registerModule(require('./patternAtlas'), context);
  registry.registerModule(require('./executor'), context);
  registry.registerModule(require('./checks'), context);
  registry.registerModule(require('./repoDocs'), context);
  registry.registerModule(require('./notes'), context);
  registry.registerModule(require('./repoContext'), context);
  registry.registerModule(require('./orchestrator'), context);
  registry.registerModule(require('./agent'), context);
  registry.registerModule(require('./repoAssets'), context);
  registry.registerModule(require('./git'), context);
  registry.registerModule(require('./workspace'), context);
  registry.registerModule(require('./elegyDb'), context);
  registry.registerModule(require('./codeReview'), context);
  registry.registerModule(require('./shell'), context);

  return registry;
}

module.exports = { RouteRegistry, createRegistry };
