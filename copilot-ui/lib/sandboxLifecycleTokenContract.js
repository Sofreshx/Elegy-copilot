'use strict';

const SANDBOX_TOKEN_CANONICAL_STATE = 'token_missing';
const SANDBOX_TOKEN_CANONICAL_CODE = 'MISSING_SANDBOX_TOKEN';

const LEGACY_MISSING_TOKEN_STATE = 'missing_token';
const LEGACY_MISSING_TOKEN_CODE = 'tracker_token_missing';
const LEGACY_MISSING_TOKEN_MESSAGE = 'Tracker token not configured';

const KNOWN_MISSING_TOKEN_TOKENS = Object.freeze(new Set([
  SANDBOX_TOKEN_CANONICAL_STATE,
  LEGACY_MISSING_TOKEN_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE.toLowerCase(),
  LEGACY_MISSING_TOKEN_CODE,
  LEGACY_MISSING_TOKEN_MESSAGE.toLowerCase(),
]));

function normalizeToken(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function collectIndicatorTokens(payload, out = [], depth = 0) {
  if (depth > 2 || payload == null) {
    return out;
  }

  if (typeof payload === 'string') {
    out.push(normalizeToken(payload));
    return out;
  }

  if (typeof payload !== 'object') {
    return out;
  }

  const source = payload;
  const fields = ['status', 'state', 'code', 'reason', 'message', 'error'];

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      continue;
    }
    const value = source[field];
    if (typeof value === 'string') {
      out.push(normalizeToken(value));
      continue;
    }
    if (value && typeof value === 'object') {
      collectIndicatorTokens(value, out, depth + 1);
    }
  }

  return out;
}

function isKnownMissingTokenIndicator(payload) {
  const tokens = collectIndicatorTokens(payload);
  return tokens.some((token) => token && KNOWN_MISSING_TOKEN_TOKENS.has(token));
}

function extractPreferredMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const fromMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (fromMessage) {
    return fromMessage;
  }

  const fromError = typeof payload.error === 'string' ? payload.error.trim() : '';
  if (fromError) {
    return fromError;
  }

  if (payload.error && typeof payload.error === 'object') {
    const nestedMessage = typeof payload.error.message === 'string'
      ? payload.error.message.trim()
      : '';
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return '';
}

function toCanonicalMissingTokenError(payload) {
  if (!isKnownMissingTokenIndicator(payload)) {
    return null;
  }

  const message = extractPreferredMessage(payload) || LEGACY_MISSING_TOKEN_MESSAGE;

  return {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message,
    legacyCode: LEGACY_MISSING_TOKEN_CODE,
    legacyReason: LEGACY_MISSING_TOKEN_CODE,
  };
}

module.exports = {
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE,
  isKnownMissingTokenIndicator,
  toCanonicalMissingTokenError,
};
