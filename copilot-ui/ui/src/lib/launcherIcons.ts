/**
 * Maps backend launcher IDs to static brand SVG icon paths.
 * Falls back to a generic group icon when no brand icon is registered.
 */
export const LAUNCHER_ICON_MAP: Record<string, string> = {
  'vscode': assetPath('icons/vscode.svg'),
  'codium': assetPath('icons/codium.svg'),
  'cursor': assetPath('icons/cursor.svg'),
  'windsurf': assetPath('icons/windsurf.svg'),
  'opencode': assetPath('icons/opencode.svg'),
  'claude-code': assetPath('icons/claude.svg'),
  'codex': assetPath('icons/codex.svg'),
  'copilot': assetPath('icons/copilot.svg'),
  'gemini-cli': assetPath('icons/gemini.svg'),
};

export const TERMINAL_ICON = assetPath('icons/terminal.svg');

/**
 * Resolve a launcher ID to an icon path.
 * Falls back to terminal icon for unknown launchers.
 */
export function resolveLauncherIconPath(launcherId: string): string {
  return LAUNCHER_ICON_MAP[launcherId] || TERMINAL_ICON;
}
import { assetPath } from './assetPath';
