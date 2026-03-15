'use strict';

const crypto = require('crypto');

function isNonLoopback(host) {
  return host !== '127.0.0.1' && host !== '::1' && host !== 'localhost';
}

function isLoopbackRequest(req) {
  const addr = req && req.socket ? req.socket.remoteAddress || '' : '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function checkAuth(req, token, options = {}) {
  if (!token) return true;

  const allowLoopbackBypass = options.allowLoopbackBypass !== false;
  if (allowLoopbackBypass && isLoopbackRequest(req)) return true;

  const authHeader = req && req.headers ? req.headers.authorization || '' : '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const provided = authHeader.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(token);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function resolveToken(args, host, env = process.env) {
  if (args && args.token) return args.token;
  if (env && env.COPILOT_UI_TOKEN) return env.COPILOT_UI_TOKEN;
  if (isNonLoopback(host)) return crypto.randomBytes(32).toString('hex');
  return null;
}

function derivePlanningActorId(token) {
  if (typeof token === 'string' && token.trim()) {
    const digest = crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
    return `auth-${digest.slice(0, 16)}`;
  }
  return 'local-loopback-user';
}

module.exports = {
  isNonLoopback,
  isLoopbackRequest,
  checkAuth,
  resolveToken,
  derivePlanningActorId,
};
