/**
 * Auto mode for ACP-only gateway.
 *
 * If an ACP port is configured (via env or config), auto mode is "connected";
 * otherwise it is "disconnected".
 */
export function detectModeAuto(acpPort: number | undefined): 'connected' | 'disconnected' {
	if (!acpPort) return 'disconnected';
	if (!Number.isInteger(acpPort) || acpPort < 1 || acpPort > 65535) return 'disconnected';
	return 'connected';
}
