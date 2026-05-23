"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_events_1 = require("node:events");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const gatewayChildMode_1 = require("../gatewayChildMode");
const runtimeService_1 = require("./runtimeService");
class FakeChildProcess extends node_events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.exitCode = null;
        this.killed = false;
        this.killCalls = 0;
    }
    kill() {
        this.killCalls += 1;
        this.killed = true;
        this.exitCode = 0;
        this.emit('exit', 0);
        return true;
    }
}
function createCliManagerState() {
    return {
        channel: 'stable',
        sdkChannel: 'stable',
        cliChannel: 'stable',
        requestedChannel: null,
        acquisition: 'bundle_or_seeded_install_only',
        status: 'ready',
        approved: true,
        reason: null,
        message: null,
        source: 'bundle',
        cliPath: 'C:\\cli\\copilot.exe',
        cliVersion: '1.2.3',
        sdkVersion: '0.1.9',
        lastCheckedAtMs: Date.now(),
    };
}
(0, node_test_1.default)('desktop runtime service starts the extracted runtime orchestration and shuts it down cleanly', async () => {
    const runtimeRoot = 'C:\\runtime';
    const copilotHome = 'C:\\Users\\tester\\.copilot';
    const fakeChild = new FakeChildProcess();
    const existingPaths = new Set([
        runtimeRoot,
        node_path_1.default.join(runtimeRoot, 'local-tracker'),
    ]);
    const lifecycle = [];
    let gatewayEnv;
    let serverOptions;
    const service = (0, runtimeService_1.createDesktopRuntimeService)({
        paths: {
            runtimeRoot,
            workspaceRoot: runtimeRoot,
            copilotHome,
            gatewayConfigPath: node_path_1.default.join(copilotHome, 'messaging-gateway.config.json'),
            legacyGatewayConfigPath: node_path_1.default.join('C:\\Users\\tester\\.instruction-engine', 'messaging-gateway.config.json'),
        },
        isPackaged: true,
        processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
        appVersion: '1.0.1',
        appPath: 'C:\\runtime\\copilot-ui',
        currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
        env: {},
        platform: 'win32',
        logger: {
            log: () => undefined,
            warn: () => undefined,
        },
        shellAdapter: {
            launchPackagedGatewayChild: ({ env }) => {
                gatewayEnv = env;
                lifecycle.push('gateway:start');
                return fakeChild;
            },
        },
    }, {
        ensureSdkBridgeDefaultEnabled: (env) => {
            lifecycle.push('sdk-bridge:default');
            env.COPILOT_SDK_BRIDGE = '1';
        },
        evaluateDesktopCliManagerState: async () => createCliManagerState(),
        startWorkflowSidecar: async () => ({
            getPublicState: () => ({
                contractVersion: '1',
                preferredRuntime: 'n8n',
                runtime: 'contract-only',
                managedBy: 'desktop',
                loopbackOnly: true,
                auth: 'bearer',
                packaged: true,
                state: 'disabled',
                killSwitch: false,
                desiredState: 'disabled',
                host: '127.0.0.1',
                port: 4111,
                triggerUrl: null,
                healthUrl: null,
                bundledEntry: null,
                runtimeBinding: {
                    present: false,
                    verified: false,
                    reason: 'workflow_runtime_binding_missing',
                },
                lastError: null,
            }),
            getDispatchTarget: () => null,
            stop: async () => {
                lifecycle.push('workflow:stop');
            },
        }),
        startDesktopPlanningPersistence: async () => ({
            connectionString: 'postgres://planning',
            queryClient: {
                query: async () => ({ rows: [] }),
            },
            stop: async () => {
                lifecycle.push('planning:stop');
            },
        }),
        startServer: async (options) => {
            serverOptions = options;
            return {
                host: '127.0.0.1',
                port: 3210,
                close: async () => {
                    lifecycle.push('server:stop');
                },
            };
        },
        fs: {
            existsSync: (candidate) => existingPaths.has(candidate),
            mkdirSync: () => undefined,
            renameSync: () => undefined,
            copyFileSync: () => undefined,
            unlinkSync: () => undefined,
        },
        createRandomHex: ((values) => () => {
            const next = values.shift();
            if (!next) {
                throw new Error('Missing random value');
            }
            return next;
        })(['desktop-token', 'tracker-token']),
    });
    const result = await service.start();
    strict_1.default.equal(result.windowUrl, 'http://127.0.0.1:3210/?desktop-ui-token=desktop-token');
    strict_1.default.equal(result.trackerToken, 'tracker-token');
    strict_1.default.equal(gatewayEnv?.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN, 'tracker-token');
    strict_1.default.equal(gatewayEnv?.INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS, '1');
    strict_1.default.equal(gatewayEnv?.INSTRUCTION_ENGINE_GATEWAY_MODE, 'disconnected');
    strict_1.default.equal(serverOptions?.planningPersistenceClient?.query != null, true);
    strict_1.default.equal(serverOptions?.trackerToken, 'tracker-token');
    strict_1.default.equal(serverOptions?.desktopUiToken, 'desktop-token');
    strict_1.default.equal(serverOptions?.engineRoot, runtimeRoot);
    strict_1.default.equal(service.isRunning(), true);
    strict_1.default.equal(service.getWindowUrl(), result.windowUrl);
    await service.stop();
    strict_1.default.deepEqual(lifecycle, [
        'sdk-bridge:default',
        'gateway:start',
        'server:stop',
        'planning:stop',
        'workflow:stop',
    ]);
    strict_1.default.equal(fakeChild.killCalls, 1);
    strict_1.default.equal(service.isRunning(), false);
    strict_1.default.equal(service.getWindowUrl(), null);
});
(0, node_test_1.default)('desktop runtime service cleans up partially started dependencies when startup fails', async () => {
    const runtimeRoot = 'C:\\runtime';
    const copilotHome = 'C:\\Users\\tester\\.copilot';
    const fakeChild = new FakeChildProcess();
    const existingPaths = new Set([
        node_path_1.default.join(runtimeRoot, 'local-tracker'),
    ]);
    const lifecycle = [];
    const service = (0, runtimeService_1.createDesktopRuntimeService)({
        paths: {
            runtimeRoot,
            workspaceRoot: runtimeRoot,
            copilotHome,
            gatewayConfigPath: node_path_1.default.join(copilotHome, 'messaging-gateway.config.json'),
            legacyGatewayConfigPath: node_path_1.default.join('C:\\Users\\tester\\.instruction-engine', 'messaging-gateway.config.json'),
        },
        isPackaged: true,
        processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
        appVersion: '1.0.1',
        appPath: 'C:\\runtime\\copilot-ui',
        currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
        env: {},
        platform: 'win32',
        logger: {
            log: () => undefined,
            warn: () => undefined,
        },
        shellAdapter: {
            launchPackagedGatewayChild: () => fakeChild,
        },
    }, {
        ensureSdkBridgeDefaultEnabled: (env) => {
            env.COPILOT_SDK_BRIDGE = '1';
        },
        evaluateDesktopCliManagerState: async () => createCliManagerState(),
        startWorkflowSidecar: async () => ({
            getPublicState: () => ({
                contractVersion: '1',
                preferredRuntime: 'n8n',
                runtime: 'contract-only',
                managedBy: 'desktop',
                loopbackOnly: true,
                auth: 'bearer',
                packaged: true,
                state: 'disabled',
                killSwitch: false,
                desiredState: 'disabled',
                host: '127.0.0.1',
                port: 4111,
                triggerUrl: null,
                healthUrl: null,
                bundledEntry: null,
                runtimeBinding: {
                    present: false,
                    verified: false,
                    reason: 'workflow_runtime_binding_missing',
                },
                lastError: null,
            }),
            getDispatchTarget: () => null,
            stop: async () => {
                lifecycle.push('workflow:stop');
            },
        }),
        startDesktopPlanningPersistence: async () => ({
            connectionString: 'postgres://planning',
            queryClient: {
                query: async () => ({ rows: [] }),
            },
            stop: async () => {
                lifecycle.push('planning:stop');
            },
        }),
        startServer: async () => {
            throw new Error('server failed');
        },
        fs: {
            existsSync: (candidate) => existingPaths.has(candidate),
            mkdirSync: () => undefined,
            renameSync: () => undefined,
            copyFileSync: () => undefined,
            unlinkSync: () => undefined,
        },
        createRandomHex: ((values) => () => {
            const next = values.shift();
            if (!next) {
                throw new Error('Missing random value');
            }
            return next;
        })(['desktop-token', 'tracker-token']),
    });
    await strict_1.default.rejects(() => service.start(), /server failed/);
    strict_1.default.deepEqual(lifecycle, [
        'planning:stop',
        'workflow:stop',
    ]);
    strict_1.default.equal(fakeChild.killCalls, 1);
    strict_1.default.equal(service.isRunning(), false);
    strict_1.default.equal(service.getWindowUrl(), null);
});
(0, node_test_1.default)('bundled child entrypoint strips its dedicated flag while invoking the bundled module', async () => {
    const runtimeRoot = 'C:\\runtime';
    const processState = {
        argv: ['desktop-shell.exe', '.', gatewayChildMode_1.GATEWAY_CHILD_FLAG, '--mode=disconnected'],
    };
    const observedArgv = [];
    await (0, runtimeService_1.runBundledChildEntryPoint)({
        runtimeRoot,
        entryRelativePath: ['local-tracker', 'dist', 'messagingGateway', 'index.js'],
        childLabel: 'gateway-child',
        stripChildFlag: gatewayChildMode_1.stripGatewayChildFlag,
        fs: {
            existsSync: (candidate) => candidate === node_path_1.default.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'index.js'),
        },
        loadModule: () => ({
            main: async () => {
                observedArgv.push(processState.argv.slice());
            },
        }),
        processState,
    });
    strict_1.default.deepEqual(observedArgv, [['desktop-shell.exe', '.', '--mode=disconnected']]);
    strict_1.default.deepEqual(processState.argv, ['desktop-shell.exe', '.', gatewayChildMode_1.GATEWAY_CHILD_FLAG, '--mode=disconnected']);
});
