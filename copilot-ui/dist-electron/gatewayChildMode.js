"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATEWAY_CHILD_FLAG = void 0;
exports.hasGatewayChildFlag = hasGatewayChildFlag;
exports.buildPackagedGatewayChildArgs = buildPackagedGatewayChildArgs;
exports.stripGatewayChildFlag = stripGatewayChildFlag;
exports.GATEWAY_CHILD_FLAG = '--elegy-copilot-gateway-child';
function hasGatewayChildFlag(argv) {
    return argv.includes(exports.GATEWAY_CHILD_FLAG);
}
function buildPackagedGatewayChildArgs() {
    return [exports.GATEWAY_CHILD_FLAG];
}
function stripGatewayChildFlag(argv) {
    return argv.filter((value) => value !== exports.GATEWAY_CHILD_FLAG);
}
