'use strict';

/**
 * Shared regex for detecting subjective/vague language in acceptance criteria.
 * Single source of truth; consumer scripts import from this module.
 * Do not edit copies in consumer files — edit this module only.
 */
const AC_VAGUE_TOKEN_RE = /\b(quality|good|proper|appropriate|adequate|robust|clean|nice|better|improved|sufficient)\b/i;

module.exports = { AC_VAGUE_TOKEN_RE };
