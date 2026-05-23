"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
const runtimeService_1 = require("../desktopRuntime/runtimeService");
const cliManager_1 = require("../desktopRuntime/cliManager");
const workflowSidecar_1 = require("../workflowSidecar");
const READY_PREFIX = 'TAURI_RUNTIME_READY ';
const ERROR_PREFIX = 'TAURI_RUNTIME_ERROR ';
const SHUTDOWN_SIGNAL = 'shutdown';
function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required ${name} environment variable.`);
    }
    return value;
}
function isPackagedHost() {
    return String(process.env.ELEGY_TAURI_IS_PACKAGED || '').trim() === '1';
}
async function main() {
    const runtimeRoot = requireEnv('ELEGY_TAURI_RUNTIME_ROOT');
    const nodeExecutablePath = requireEnv('ELEGY_TAURI_NODE_EXECUTABLE');
    const serverEntrypointPath = requireEnv('ELEGY_TAURI_SERVER_ENTRYPOINT');
    const gatewayEntrypointPath = requireEnv('ELEGY_TAURI_GATEWAY_ENTRYPOINT');
    const workflowSidecarEntrypointPath = requireEnv('ELEGY_TAURI_WORKFLOW_SIDECAR_ENTRYPOINT');
    const appVersion = requireEnv('ELEGY_TAURI_APP_VERSION');
    const copilotUiRoot = path_1.default.dirname(serverEntrypointPath);
    const currentDirname = path_1.default.dirname(__filename);
    const localTrackerRoot = path_1.default.join(runtimeRoot, 'local-tracker');
    const copilotHome = path_1.default.join(os_1.default.homedir(), '.copilot');
    const isPackaged = isPackagedHost();
    const { startDesktopPlanningPersistence } = require(path_1.default.join(copilotUiRoot, 'lib', 'desktopPlanningPersistence.js'));
    const { startServer } = require(serverEntrypointPath);
    let runtimeService = null;
    let shutdownStarted = false;
    const shutdown = async () => {
        if (shutdownStarted) {
            return;
        }
        shutdownStarted = true;
        await runtimeService?.stop();
    };
    runtimeService = (0, runtimeService_1.createDesktopRuntimeService)({
        paths: {
            runtimeRoot,
            workspaceRoot: (0, runtimeService_1.resolveDefaultWorkspaceRoot)(runtimeRoot, process.cwd()),
            copilotHome,
            gatewayConfigPath: path_1.default.join(copilotHome, 'messaging-gateway.config.json'),
            legacyGatewayConfigPath: path_1.default.join(os_1.default.homedir(), '.instruction-engine', 'messaging-gateway.config.json'),
        },
        isPackaged,
        processExecPath: nodeExecutablePath,
        appVersion,
        appPath: copilotUiRoot,
        currentDirname,
        env: process.env,
        platform: process.platform,
        logger: console,
        shellAdapter: {
            launchPackagedGatewayChild: ({ env }) => (0, child_process_1.spawn)(nodeExecutablePath, [gatewayEntrypointPath], {
                cwd: localTrackerRoot,
                env,
                stdio: 'ignore',
                windowsHide: true,
            }),
            launchPackagedWorkflowSidecarChild: ({ env }) => (0, child_process_1.spawn)(nodeExecutablePath, [workflowSidecarEntrypointPath], {
                cwd: localTrackerRoot,
                env,
                stdio: 'ignore',
                windowsHide: true,
            }),
        },
    }, {
        ensureSdkBridgeDefaultEnabled: cliManager_1.ensureSdkBridgeDefaultEnabled,
        evaluateDesktopCliManagerState: cliManager_1.evaluateDesktopCliManagerState,
        startWorkflowSidecar: workflowSidecar_1.startWorkflowSidecar,
        startDesktopPlanningPersistence,
        startServer,
    });
    const stdinInterface = readline_1.default.createInterface({
        input: process.stdin,
        terminal: false,
    });
    stdinInterface.on('line', (line) => {
        if (line.trim() !== SHUTDOWN_SIGNAL) {
            return;
        }
        void shutdown()
            .catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail })}`);
        })
            .finally(() => {
            process.exit(0);
        });
    });
    process.stdin.on('end', () => {
        void shutdown().finally(() => {
            process.exit(0);
        });
    });
    process.on('SIGINT', () => {
        void shutdown().finally(() => {
            process.exit(0);
        });
    });
    process.on('SIGTERM', () => {
        void shutdown().finally(() => {
            process.exit(0);
        });
    });
    try {
        const startResult = await runtimeService.start();
        console.log(`${READY_PREFIX}${JSON.stringify({ windowUrl: startResult.windowUrl })}`);
    }
    catch (error) {
        await shutdown();
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail })}`);
        process.exit(1);
    }
}
void main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail })}`);
    process.exit(1);
});
