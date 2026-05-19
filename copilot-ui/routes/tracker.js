'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');

function buildRetiredTrackerSurfaceResponse(kind, surfaceLabel) {
  const label = typeof surfaceLabel === 'string' && surfaceLabel.trim()
    ? surfaceLabel.trim()
    : 'Tracker surface';

  return {
    kind,
    deterministic: true,
    error: `${label} is retired. Use Sandboxes, Gateway, and Planning surfaces instead.`,
    code: 'tracker_surface_retired',
    reason: 'tracker_surface_retired',
  };
}

function register(deps = {}) {
  const sendJson = deps.sendJson || defaultSendJson;
  const retire = (kind, surfaceLabel) => (ctx) => {
    sendJson(ctx.res, 410, buildRetiredTrackerSurfaceResponse(kind, surfaceLabel));
  };

  return [
    {
      method: 'GET',
      path: '/api/tracker/status',
      handler: retire('tracker.status', 'Tracker status surface'),
    },
    {
      method: 'GET',
      path: '/api/tracker/sessions',
      handler: retire('tracker.sessions', 'Tracker sessions surface'),
    },
    {
      method: 'GET',
      path: '/api/tracker/permissions',
      handler: retire('tracker.permissions.list', 'Tracker permissions surface'),
    },
    {
      method: 'GET',
      path: '/api/tracker/synced-notes/sources',
      handler: retire('tracker.synced-notes.list', 'Tracker synced-note source surface'),
    },
    {
      method: 'POST',
      path: '/api/tracker/synced-notes/sources',
      handler: retire('tracker.synced-notes.create', 'Tracker synced-note source surface'),
    },
    {
      method: 'GET',
      path: '/api/tracker/events',
      handler: retire('tracker.events', 'Tracker event stream surface'),
    },
    {
      method: 'GET',
      path: /^\/api\/tracker\/synced-notes\/sources\/([^/]+)$/,
      pathDescription: '/api/tracker/synced-notes/sources/:id',
      handler: retire('tracker.synced-notes.read', 'Tracker synced-note source surface'),
    },
    {
      method: 'PUT',
      path: /^\/api\/tracker\/synced-notes\/sources\/([^/]+)$/,
      pathDescription: '/api/tracker/synced-notes/sources/:id',
      handler: retire('tracker.synced-notes.update', 'Tracker synced-note source surface'),
    },
    {
      method: 'DELETE',
      path: /^\/api\/tracker\/synced-notes\/sources\/([^/]+)$/,
      pathDescription: '/api/tracker/synced-notes/sources/:id',
      handler: retire('tracker.synced-notes.delete', 'Tracker synced-note source surface'),
    },
    {
      method: 'POST',
      path: /^\/api\/tracker\/permissions\/([^/]+)\/(approve|deny)$/,
      pathDescription: '/api/tracker/permissions/:id/(approve|deny)',
      handler: retire('tracker.permissions.action', 'Tracker permissions surface'),
    },
    {
      method: 'POST',
      path: /^\/api\/tracker\/lifecycle\/([^/]+)$/,
      pathDescription: '/api/tracker/lifecycle/:action',
      handler: retire('tracker.lifecycle', 'Tracker lifecycle surface'),
    },
  ];
}

module.exports = { register };
