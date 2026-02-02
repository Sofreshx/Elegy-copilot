"use strict";
/**
 * Relay Protocol Types v1.0
 * Based on .instructions/artefacts/relay-protocol.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodes = void 0;
// Error codes
exports.ErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    UNAUTHORIZED: -32001,
    COMMAND_FAILED: -32002,
    RATE_LIMITED: -32003,
    FORBIDDEN: -32004,
    NOT_FOUND: -32005,
    CONFLICT: -32006,
    TIMEOUT: -32007,
    COMMAND_NOT_ALLOWED: -32008,
    CLIENT_OFFLINE: -32009,
    QUOTA_EXCEEDED: -32010,
};
//# sourceMappingURL=types.js.map