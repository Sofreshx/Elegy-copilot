'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');

/**
 * Elegy Copilot DB API route module.
 * Registers REST endpoints for querying the SQLite database.
 *
 * All handlers expect ctx.elegyDb to be set by the server.
 */

/**
 * Safely parse a numeric query parameter.
 * @param {URLSearchParams} params
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function parseNum(params, key, defaultValue) {
  const v = params.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

/**
 * Safely parse a string query parameter.
 * @param {URLSearchParams} params
 * @param {string} key
 * @returns {string|null}
 */
function parseStr(params, key) {
  const v = params.get(key);
  if (v == null || v === '') return null;
  return v.trim();
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;

  function sendDbNotReady(res) {
    sendJson(res, 503, { error: 'Database not initialized', code: 'elegy_db_not_ready' });
  }

  return [
    // ── Health ───────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/health',
      handler(ctx) {
        const { res, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const health = elegyDb.getHealth();
          sendJson(res, 200, health);
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_health_error' });
        }
      },
    },

    // ── Sessions ─────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/sessions',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const params = u.searchParams;
          const filter = {
            status: parseStr(params, 'status'),
            source: parseStr(params, 'source'),
            repoPath: parseStr(params, 'repoPath'),
            worktreePath: parseStr(params, 'worktreePath'),
            limit: parseNum(params, 'limit', 50),
            offset: parseNum(params, 'offset', 0),
          };
          const sessions = elegyDb.listSessions(filter);
          sendJson(res, 200, { sessions, count: sessions.length });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },
    {
      method: 'GET',
      path: /^\/api\/elegy-db\/sessions\/([^/]+)$/,
      handler(ctx) {
        const { res, match, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const sessionId = match[1];
          const session = elegyDb.getSession(sessionId);
          if (!session) {
            sendJson(res, 404, { error: 'Session not found', code: 'elegy_db_not_found' });
            return;
          }
          sendJson(res, 200, session);
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Worktrees ────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/worktrees',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const params = u.searchParams;
          const filter = {
            status: parseStr(params, 'status'),
            source: parseStr(params, 'source'),
            repoPath: parseStr(params, 'repoPath'),
            limit: parseNum(params, 'limit', 50),
          };
          const worktrees = elegyDb.listWorktrees(filter);
          sendJson(res, 200, { worktrees, count: worktrees.length });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },
    {
      method: 'GET',
      path: /^\/api\/elegy-db\/worktrees\/([^/]+)$/,
      handler(ctx) {
        const { res, match, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const worktreeId = match[1];
          const worktree = elegyDb.getWorktree(worktreeId);
          if (!worktree) {
            sendJson(res, 404, { error: 'Worktree not found', code: 'elegy_db_not_found' });
            return;
          }

          // Get linked sessions
          const linkedSessions = elegyDb.listSessionsByWorktree
            ? elegyDb.listSessionsByWorktree(worktree.path)
            : [];

          sendJson(res, 200, { ...worktree, linkedSessions });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Repo Assets ──────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/repo-assets',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const repoPath = parseStr(u.searchParams, 'repoPath');
          if (!repoPath) {
            sendJson(res, 400, { error: 'repoPath query parameter is required', code: 'elegy_db_invalid_input' });
            return;
          }
          const assets = elegyDb.getRepoAssets(repoPath);
          sendJson(res, 200, { assets, count: assets.length });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Hook Events ──────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/hook-events',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const params = u.searchParams;
          const filter = {
            hookType: parseStr(params, 'hookType'),
            sessionId: parseStr(params, 'sessionId'),
            worktreeId: parseStr(params, 'worktreeId'),
            limit: parseNum(params, 'limit', 50),
          };
          const events = elegyDb.listHookEvents(filter);
          sendJson(res, 200, { events, count: events.length });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Worktree Sessions ────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/worktree-sessions',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const worktreePath = parseStr(u.searchParams, 'worktreePath');
          if (!worktreePath) {
            sendJson(res, 400, { error: 'worktreePath query parameter is required', code: 'elegy_db_invalid_input' });
            return;
          }
          const sessions = elegyDb.listSessionsByWorktree(worktreePath);
          sendJson(res, 200, { sessions, count: sessions.length });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message || e), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Enriched Worktrees ─────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/worktrees/enriched',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const repoPath = parseStr(u.searchParams, 'repoPath');
          if (!repoPath) {
            sendJson(res, 400, { error: 'repoPath query parameter is required', code: 'elegy_db_invalid_input' });
            return;
          }

          // Get worktrees for this repo from SQLite
          const worktrees = elegyDb.listWorktreesByRepo
            ? elegyDb.listWorktreesByRepo(repoPath)
            : elegyDb.listWorktrees({ repoPath }) || [];

          // Enrich each worktree with session data
          const enriched = worktrees.map(wt => {
            const sessions = (elegyDb.listSessionsByWorktree && wt.path)
              ? elegyDb.listSessionsByWorktree(wt.path) || []
              : [];
            const hookEvents = (elegyDb.listHookEvents && wt.id)
              ? elegyDb.listHookEvents({ worktreeId: wt.id, limit: 5 }) || []
              : [];

            return {
              id: wt.id,
              path: wt.path || '',
              repoPath: wt.repo_path || repoPath,
              branch: wt.branch || '',
              source: wt.source || 'unknown',
              status: wt.status || 'ready',
              sessionCount: sessions.length,
              headSha: wt.head_sha || null,
              lastActivityAt: wt.last_activity_at || null,
              created_at: wt.created_at,
              updated_at: wt.updated_at,
              sessions: sessions.map(s => ({
                sessionId: s.id,
                title: s.title || null,
                status: s.status,
                source: s.source || 'unknown',
                model: s.model || null,
                startedAt: s.started_at,
              })),
              recentHookEvents: hookEvents.map(he => ({
                id: he.id,
                hookType: he.hook_type,
                createdAt: he.created_at,
              })),
            };
          });

          sendJson(res, 200, {
            repoPath,
            worktrees: enriched,
            count: enriched.length,
          });
        } catch (error) {
          sendJson(res, 500, { error: String(error.message || error), code: 'elegy_db_query_error' });
        }
      },
    },

    // ── Planning Summary ───────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/elegy-db/planning/summary',
      handler(ctx) {
        const { res, u, elegyDb } = ctx;
        if (!elegyDb) return sendDbNotReady(res);
        try {
          const repoPath = parseStr(u.searchParams, 'repoPath');
          if (!repoPath) {
            sendJson(res, 400, { error: 'repoPath query parameter is required', code: 'elegy_db_invalid_input' });
            return;
          }

          // Query sessions that have plan_id or goal_id set
          const linkedPlans = [];
          if (typeof elegyDb.listSessions === 'function') {
            const sessions = elegyDb.listSessions({
              repoPath,
              limit: 100,
            });
            for (const session of sessions) {
              if (session.plan_id || session.goal_id) {
                linkedPlans.push({
                  planId: session.plan_id || session.goal_id,
                  sessionId: session.id,
                  title: session.title || null,
                  status: session.status || 'unknown',
                });
              }
            }
          }

          sendJson(res, 200, {
            repoPath,
            linkedPlans,
          });
        } catch (error) {
          sendJson(res, 500, { error: String(error.message || error), code: 'elegy_db_query_error' });
        }
      },
    },
  ];
}

module.exports = { register };
