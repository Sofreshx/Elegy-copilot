'use strict';

const os = require('os');
const path = require('path');
const { createElegyDb } = require('./elegyDb');

/**
 * Create a SessionHooks instance.
 * @param {object} opts
 * @param {object} [opts.db] - Existing elegyDb instance. If not provided, creates one.
 * @param {string} [opts.dbPath] - Override DB path
 */
function createSessionHooks(opts = {}) {
  const db = opts.db || createElegyDb({ dbPath: opts.dbPath });

  function makeWorktreeId(worktreePath) {
    if (!worktreePath || typeof worktreePath !== 'string') return null;
    return `wt-${Buffer.from(worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 64)}`;
  }

  function makeHookId(prefix, worktreePath) {
    return `${prefix}-${Buffer.from(worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)}-${Date.now()}`;
  }

  /**
   * Called when a session starts.
   * @param {object} session
   * @param {string} session.sessionId - Unique session ID
   * @param {string} [session.source] - Source harness: 'opencode' | 'codex' | 'copilot' | 'claude-code' | 'antigravity'
   * @param {string} [session.harness] - Same as source
   * @param {string} [session.title] - Session title/description
   * @param {string} [session.repoPath] - Repository path
   * @param {string} [session.repoId] - Repository ID
   * @param {string} [session.branch] - Git branch
   * @param {string} [session.worktreePath] - Worktree path being used
   * @param {string} [session.model] - Model being used
   * @param {string} [session.planId] - Linked planning record ID
   * @param {string} [session.goalId] - Linked goal ID
   * @param {object} [session.metadata] - Additional key-value data
   */
  function onSessionStart(session) {
    const now = new Date().toISOString();
    const sessionId = session.sessionId;
    if (!sessionId) return;

    try {
      // 1. Upsert session record
      db.upsertSession({
        id: sessionId,
        source: session.source || session.harness || 'unknown',
        harness: session.harness || session.source || null,
        status: 'active',
        title: session.title || null,
        repo_path: session.repoPath || null,
        repo_id: session.repoId || null,
        branch: session.branch || null,
        worktree_path: session.worktreePath || null,
        model: session.model || null,
        plan_id: session.planId || null,
        goal_id: session.goalId || null,
        started_at: now,
        ended_at: null,
        updated_at: now,
        metadata_json: session.metadata ? JSON.stringify(session.metadata) : null,
      });

      // 2. If worktree path provided, link and update worktree
      if (session.worktreePath) {
        const worktreeId = `wt-${Buffer.from(session.worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 64)}`;
        
        db.upsertWorktree({
          id: worktreeId,
          path: session.worktreePath,
          repo_path: session.repoPath || null,
          repo_id: session.repoId || null,
          branch: session.branch || null,
          source: session.source || session.harness || 'unknown',
          status: 'active',
          head_sha: null,
          detached: 0,
          locked: null,
          session_count: 0,
          last_activity_at: now,
          created_at: now,
          updated_at: now,
          metadata_json: null,
        });

        // Increment session count
        try {
          const stmt = db._db.prepare('UPDATE worktrees SET session_count = session_count + 1, status = ?, updated_at = ? WHERE path = ?');
          stmt.run('active', now, session.worktreePath);
        } catch (e) { /* best effort */ }

        db.linkSessionWorktree(sessionId, worktreeId);
      }

      // 3. Record hook event
      db.recordHookEvent({
        id: `hse-${sessionId}-${Date.now()}`,
        hook_type: 'session_start',
        harness: session.harness || session.source || null,
        session_id: sessionId,
        worktree_id: session.worktreePath ? `wt-${Buffer.from(session.worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 64)}` : null,
        repo_path: session.repoPath || null,
        event_data_json: JSON.stringify({
          title: session.title,
          model: session.model,
          branch: session.branch,
          planId: session.planId,
          goalId: session.goalId,
        }),
        created_at: now,
      });
    } catch (err) {
      // Hooks should never throw - log and continue
      console.error('[sessionHooks] onSessionStart error:', err.message);
    }
  }

  /**
   * Called when a session ends.
   * @param {object} session
   * @param {string} session.sessionId
   * @param {string} [session.status] - 'completed' | 'failed' | 'cancelled' | 'idle'
   * @param {string} [session.error] - Error message if failed
   * @param {object} [session.metadata]
   */
  function onSessionEnd(session) {
    const now = new Date().toISOString();
    const sessionId = session.sessionId;
    if (!sessionId) return;

    try {
      const endStatus = session.status || 'completed';

      // Try to get the existing session record first
      const existingSession = db.getSession(sessionId);

      // 1. Update session record
      // Include all fields (using existing session values for fields not changing)
      db.upsertSession({
        id: sessionId,
        source: existingSession ? existingSession.source : (session.source || 'unknown'),
        harness: existingSession ? existingSession.harness : (session.harness || null),
        status: endStatus === 'idle' ? 'completed' : endStatus,
        title: existingSession ? existingSession.title : (session.title || null),
        repo_path: existingSession ? existingSession.repo_path : (session.repoPath || null),
        repo_id: existingSession ? existingSession.repo_id : (session.repoId || null),
        branch: existingSession ? existingSession.branch : (session.branch || null),
        worktree_path: existingSession ? existingSession.worktree_path : (session.worktreePath || null),
        model: existingSession ? existingSession.model : (session.model || null),
        plan_id: existingSession ? existingSession.plan_id : (session.planId || null),
        goal_id: existingSession ? existingSession.goal_id : (session.goalId || null),
        started_at: existingSession ? existingSession.started_at : now,
        ended_at: now,
        updated_at: now,
        metadata_json: session.metadata ? JSON.stringify(session.metadata) : (existingSession ? existingSession.metadata_json : null),
      });

      // 2. If worktree path is known, decrement session count and possibly mark idle
      const worktreePath = session.worktreePath || (existingSession && existingSession.worktree_path);

      if (worktreePath) {
        // Decrement session count
        try {
          const stmt = db._db.prepare('UPDATE worktrees SET session_count = MAX(0, session_count - 1), last_activity_at = ?, updated_at = ? WHERE path = ?');
          stmt.run(now, now, worktreePath);

          // If no more sessions, mark as idle
          const row = db._db.prepare('SELECT session_count FROM worktrees WHERE path = ?').get(worktreePath);
          if (row && row.session_count === 0) {
            db._db.prepare('UPDATE worktrees SET status = ?, updated_at = ? WHERE path = ?').run('idle', now, worktreePath);
          }
        } catch (e) { /* best effort */ }
      }

      // Decrement worktree session count in junction table
      if (worktreePath) {
        const worktreeId = `wt-${Buffer.from(worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 64)}`;
        try {
          db._db.prepare('UPDATE session_worktrees SET released_at = ? WHERE session_id = ? AND worktree_id = ? AND released_at IS NULL')
            .run(now, sessionId, worktreeId);
        } catch (e) { /* best effort */ }
      }

      // 3. Record hook event
      db.recordHookEvent({
        id: `hee-${sessionId}-${Date.now()}`,
        hook_type: 'session_end',
        harness: session.harness || session.source || (existingSession && existingSession.harness) || null,
        session_id: sessionId,
        worktree_id: worktreePath ? `wt-${Buffer.from(worktreePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 64)}` : null,
        repo_path: session.repoPath || (existingSession && existingSession.repo_path) || null,
        event_data_json: JSON.stringify({
          status: endStatus,
          error: session.error || null,
        }),
        created_at: now,
      });
    } catch (err) {
      console.error('[sessionHooks] onSessionEnd error:', err.message);
    }
  }

  /**
   * Called when a worktree is created.
   */
  function onWorktreeCreate(worktree) {
    try {
      const worktreePath = worktree && worktree.path;
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const worktreeId = worktree.id || makeWorktreeId(worktreePath);
      db.upsertWorktree({
        id: worktreeId,
        path: worktreePath,
        repo_path: worktree.repoPath || null,
        repo_id: worktree.repoId || null,
        branch: worktree.branch || null,
        source: worktree.source || 'manual',
        status: 'ready',
        head_sha: null,
        detached: 0,
        locked: null,
        session_count: 0,
        last_activity_at: null,
        created_at: now,
        updated_at: now,
        metadata_json: null,
      });

      db.recordHookEvent({
        id: makeHookId('hwc', worktreePath),
        hook_type: 'worktree_create',
        harness: worktree.source || null,
        session_id: null,
        worktree_id: worktreeId,
        repo_path: worktree.repoPath || null,
        event_data_json: JSON.stringify({ path: worktreePath, branch: worktree.branch, source: worktree.source }),
        created_at: now,
      });
    } catch (err) {
      console.error('[sessionHooks] onWorktreeCreate error:', err.message);
    }
  }

  /**
   * Called when a worktree is removed.
   */
  function onWorktreeRemove(worktreePath) {
    try {
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const existing = db.getWorktreeByPath(worktreePath);
      const worktreeId = existing ? existing.id : makeWorktreeId(worktreePath);
      
      // Mark as cleaned/done
      if (existing) {
        db._db.prepare('UPDATE worktrees SET status = ?, updated_at = ? WHERE path = ?')
          .run('done', now, worktreePath);
      }

      db.recordHookEvent({
        id: makeHookId('hwr', worktreePath),
        hook_type: 'worktree_remove',
        harness: existing ? existing.source : null,
        session_id: null,
        worktree_id: worktreeId,
        repo_path: existing ? existing.repo_path : null,
        event_data_json: JSON.stringify({ path: worktreePath }),
        created_at: now,
      });
    } catch (err) {
      console.error('[sessionHooks] onWorktreeRemove error:', err.message);
    }
  }

  /**
   * Called when a worktree is allocated.
   */
  function onWorktreeAllocate(worktree) {
    try {
      const worktreePath = worktree && worktree.path;
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const worktreeId = makeWorktreeId(worktreePath);

      db.recordHookEvent({
        id: makeHookId('hwa', worktreePath),
        hook_type: 'worktree_allocate',
        harness: worktree.source || null,
        session_id: null,
        worktree_id: worktreeId,
        repo_path: worktree.repoPath || null,
        event_data_json: JSON.stringify({ path: worktreePath, branch: worktree.branch, repoId: worktree.repoId, source: worktree.source }),
        created_at: now,
      });

      db.upsertWorktree({
        id: worktreeId,
        path: worktreePath,
        repo_path: worktree.repoPath || null,
        repo_id: worktree.repoId || null,
        branch: worktree.branch || null,
        source: worktree.source || 'executor',
        status: 'ready',
        head_sha: null,
        detached: 0,
        locked: null,
        session_count: 0,
        last_activity_at: null,
        created_at: now,
        updated_at: now,
        metadata_json: null,
      });
    } catch (err) {
      console.error('[sessionHooks] onWorktreeAllocate error:', err.message);
    }
  }

  /**
   * Called when a worktree is activated.
   */
  function onWorktreeActivate(worktree) {
    try {
      const worktreePath = worktree && worktree.path;
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const worktreeId = makeWorktreeId(worktreePath);

      db.recordHookEvent({
        id: makeHookId('hwx', worktreePath),
        hook_type: 'worktree_activate',
        harness: worktree.source || null,
        session_id: worktree.sessionId || null,
        worktree_id: worktreeId,
        repo_path: worktree.repoPath || null,
        event_data_json: JSON.stringify({ path: worktreePath, sessionId: worktree.sessionId, runId: worktree.runId }),
        created_at: now,
      });

      db._db.prepare('UPDATE worktrees SET status = ?, updated_at = ? WHERE path = ?')
        .run('active', now, worktreePath);
    } catch (err) {
      console.error('[sessionHooks] onWorktreeActivate error:', err.message);
    }
  }

  /**
   * Called when a worktree is released.
   */
  function onWorktreeRelease(worktree) {
    try {
      const worktreePath = worktree && worktree.path;
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const worktreeId = makeWorktreeId(worktreePath);

      db.recordHookEvent({
        id: makeHookId('hwe', worktreePath),
        hook_type: 'worktree_release',
        harness: worktree.source || null,
        session_id: worktree.sessionId || null,
        worktree_id: worktreeId,
        repo_path: worktree.repoPath || null,
        event_data_json: JSON.stringify({ path: worktreePath, runId: worktree.runId }),
        created_at: now,
      });

      db._db.prepare('UPDATE worktrees SET status = ?, updated_at = ? WHERE path = ?')
        .run('idle', now, worktreePath);
    } catch (err) {
      console.error('[sessionHooks] onWorktreeRelease error:', err.message);
    }
  }

  /**
   * Called when a worktree is interrupted.
   */
  function onWorktreeInterrupt(worktree, reason) {
    try {
      const worktreePath = worktree && worktree.path;
      if (!worktreePath) return;
      const now = new Date().toISOString();
      const worktreeId = makeWorktreeId(worktreePath);

      db.recordHookEvent({
        id: makeHookId('hwi', worktreePath),
        hook_type: 'worktree_interrupt',
        harness: worktree.source || null,
        session_id: worktree.sessionId || null,
        worktree_id: worktreeId,
        repo_path: worktree.repoPath || null,
        event_data_json: JSON.stringify({ path: worktreePath, runId: worktree.runId, reason: reason || 'interrupted' }),
        created_at: now,
      });

      db._db.prepare('UPDATE worktrees SET status = ?, updated_at = ? WHERE path = ?')
        .run('interrupted', now, worktreePath);
    } catch (err) {
      console.error('[sessionHooks] onWorktreeInterrupt error:', err.message);
    }
  }

  return {
    onSessionStart,
    onSessionEnd,
    onWorktreeCreate,
    onWorktreeRemove,
    onWorktreeAllocate,
    onWorktreeActivate,
    onWorktreeRelease,
    onWorktreeInterrupt,
    close: () => { if (!opts.db) db.close(); },
  };
}

module.exports = { createSessionHooks };
