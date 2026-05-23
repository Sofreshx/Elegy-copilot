"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_SIDECAR_CHILD_FLAG = exports.GATEWAY_CHILD_FLAG = void 0;
exports.hasGatewayChildFlag = hasGatewayChildFlag;
exports.buildPackagedGatewayChildArgs = buildPackagedGatewayChildArgs;
exports.hasWorkflowSidecarChildFlag = hasWorkflowSidecarChildFlag;
exports.buildPackagedWorkflowSidecarChildArgs = buildPackagedWorkflowSidecarChildArgs;
exports.stripGatewayChildFlag = stripGatewayChildFlag;
exports.stripWorkflowSidecarChildFlag = stripWorkflowSidecarChildFlag;
exports.GATEWAY_CHILD_FLAG = '--elegy-copilot-gateway-child';
exports.WORKFLOW_SIDECAR_CHILD_FLAG = '--elegy-copilot-workflow-sidecar-child';
function hasGatewayChildFlag(argv) {
    return argv.includes(exports.GATEWAY_CHILD_FLAG);
}
function buildPackagedGatewayChildArgs() {
    return [exports.GATEWAY_CHILD_FLAG];
}
function hasWorkflowSidecarChildFlag(argv) {
    return argv.includes(exports.WORKFLOW_SIDECAR_CHILD_FLAG);
}
function buildPackagedWorkflowSidecarChildArgs() {
    return [exports.WORKFLOW_SIDECAR_CHILD_FLAG];
}
function stripGatewayChildFlag(argv) {
    return argv.filter((value) => value !== exports.GATEWAY_CHILD_FLAG);
}
function stripWorkflowSidecarChildFlag(argv) {
    return argv.filter((value) => value !== exports.WORKFLOW_SIDECAR_CHILD_FLAG);
}
