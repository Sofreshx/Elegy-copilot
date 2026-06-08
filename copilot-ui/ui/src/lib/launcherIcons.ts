/**
 * Maps backend launcher IDs to static brand SVG icon paths.
 * Falls back to a generic group icon when no brand icon is registered.
 */
export const LAUNCHER_ICON_MAP: Record<string, string> = {
  'opencode-cli': '/icons/opencode.svg',
  'claude-code-cli': '/icons/claude.svg',
  'codex-cli': '/icons/codex.svg',
  'copilot-cli': '/icons/copilot.svg',
  'gemini-cli': '/icons/gemini.svg',
};

export const TERMINAL_ICON = '/icons/terminal.svg';

/**
 * Resolve a launcher ID to an icon path.
 * Falls back to terminal icon for unknown launchers.
 */
export function resolveLauncherIconPath(launcherId: string): string {
  return LAUNCHER_ICON_MAP[launcherId] || TERMINAL_ICON;
}
