"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const gatewayChildMode_1 = require("./gatewayChildMode");
(0, node_test_1.default)('gateway child mode is detected from process args', () => {
    strict_1.default.equal((0, gatewayChildMode_1.hasGatewayChildFlag)(['desktop-shell.exe', '.', gatewayChildMode_1.GATEWAY_CHILD_FLAG]), true);
    strict_1.default.equal((0, gatewayChildMode_1.hasGatewayChildFlag)(['desktop-shell.exe', '.']), false);
});
(0, node_test_1.default)('gateway child spawn args contain only the dedicated child flag', () => {
    strict_1.default.deepEqual((0, gatewayChildMode_1.buildPackagedGatewayChildArgs)(), [gatewayChildMode_1.GATEWAY_CHILD_FLAG]);
});
(0, node_test_1.default)('gateway child flag is stripped before handing argv to the gateway cli', () => {
    strict_1.default.deepEqual((0, gatewayChildMode_1.stripGatewayChildFlag)(['desktop-shell.exe', '.', gatewayChildMode_1.GATEWAY_CHILD_FLAG, '--mode=disconnected']), ['desktop-shell.exe', '.', '--mode=disconnected']);
});
