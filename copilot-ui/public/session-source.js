/**
 * Session source resolution helpers.
 * Loaded as a plain <script> before app.js — exposes globals.
 */

/**
 * Returns the best source string for API calls.
 * Single source-of-truth for action routing (detail, archive, delete).
 */
function resolveSessionSource(session) {
  return session.canonicalSource || session.source || 'cli';
}

/**
 * Returns a display badge like [CLI], [VSCODE], [MULTI], etc.
 * When the current filter is NOT 'all', returns '' (badge unnecessary).
 */
function getSessionDisplayLabel(session, currentFilter) {
  if (currentFilter !== 'all') return '';
  if (Array.isArray(session.sources) && session.sources.length > 1) return '[MULTI] ';
  return '[' + String(resolveSessionSource(session)).toUpperCase() + '] ';
}
