/**
 * Maps backend launcher IDs to static brand SVG icon paths.
 * Falls back to a generic group icon when no brand icon is registered.
 */
export const LAUNCHER_ICON_MAP: Record<string, string> = {
  'vscode': '/icons/vscode.svg',
  'codium': '/icons/codium.svg',
  'cursor': '/icons/cursor.svg',
  'windsurf': '/icons/windsurf.svg',
  'opencode': '/icons/opencode.svg',
  'claude-code': '/icons/claude.svg',
  'codex': '/icons/codex.svg',
  'copilot': '/icons/copilot.svg',
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
