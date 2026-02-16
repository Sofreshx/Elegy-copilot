import fs from 'fs';
import path from 'path';

export function getWsPortFilePath(workspaceRoot: string): string {
	return path.join(workspaceRoot, '.e3-local', 'ws-port.txt');
}

export function resolveExtensionWsPort(workspaceRoot: string): { port: number; source: 'env' | 'file' } {
	const envPort = process.env.INSTRUCTION_ENGINE_EXTENSION_WS_PORT || process.env.INSTRUCTION_ENGINE_WS_PORT;
	if (envPort && /^\d+$/.test(envPort.trim())) {
		const port = parseInt(envPort.trim(), 10);
		if (port > 0 && port <= 65535) return { port, source: 'env' };
	}

	const wsPortFile = getWsPortFilePath(workspaceRoot);
	if (!fs.existsSync(wsPortFile)) {
		throw new Error(`[Gateway] Connected mode requires WS port discovery file: ${wsPortFile}`);
	}
	const raw = fs.readFileSync(wsPortFile, 'utf8').trim();
	if (!/^\d+$/.test(raw)) {
		throw new Error(`[Gateway] Invalid WS port file contents at ${wsPortFile}`);
	}
	const port = parseInt(raw, 10);
	if (port <= 0 || port > 65535) {
		throw new Error(`[Gateway] Invalid WS port number in ${wsPortFile}`);
	}

	return { port, source: 'file' };
}

export function detectModeAuto(workspaceRoot: string): 'connected' | 'disconnected' {
	const wsPortFile = getWsPortFilePath(workspaceRoot);
	if (!fs.existsSync(wsPortFile)) return 'disconnected';
	const raw = fs.readFileSync(wsPortFile, 'utf8').trim();
	if (!/^\d+$/.test(raw)) return 'disconnected';
	const port = parseInt(raw, 10);
	if (port <= 0 || port > 65535) return 'disconnected';
	return 'connected';
}
