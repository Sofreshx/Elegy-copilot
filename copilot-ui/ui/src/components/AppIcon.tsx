export type AppIconName =
  // --- existing CatalogIcon names (21) ---
  | 'settings'
  | 'assets'
  | 'codex'
  | 'claude-code'
  | 'opencode'
  | 'maintenance'
  | 'runtime'
  | 'search'
  | 'refresh'
  | 'add'
  | 'sync'
  | 'agent'
  | 'skill'
  | 'hook'
  | 'plugin'
  | 'mcp'
  | 'package'
  | 'warning'
  | 'check'
  | 'external-source'
  // --- new names (32) ---
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'menu'
  | 'folder-open'
  | 'folder'
  | 'file-text'
  | 'git-branch'
  | 'copy'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'info'
  | 'play'
  | 'pause'
  | 'star'
  | 'external-link'
  | 'repo'
  | 'focus'
  | 'tree'
  | 'layout'
  | 'user'
  | 'help-circle'
  | 'diamond'
  | 'hexagon'
  | 'squared-plus'
  | 'success'
  | 'error';

const ICON_PATHS: Record<AppIconName, string> = {
  // --- existing 21 from CatalogIcon (exact copy) ---

  // gear/cog
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',

  // box/package
  assets:
    'M16.5 9.4 7.5 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.27 6.96 12 12.01 20.73 6.96 M12 22.08V12',

  // code brackets "C"
  codex:
    'M9 6H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1 M15 6h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1 M10 9l-3 3 3 3 M14 15l3-3-3-3',

  // "CC" letterform
  'claude-code':
    'M4 8a2 2 0 0 1 2-2h1 M4 8v8a2 2 0 0 0 2 2h1 M4 8h3 M4 16h3 M13 8h3 M13 16h3 M13 8a2 2 0 0 1 2-2h1 M13 16a2 2 0 0 0 2 2h1 M13 8v8',

  // open bracket "O"
  opencode:
    'M12 3c4.97 0 9 4.03 9 9s-4.03 9-9 9-9-4.03-9-9 4.03-9 9-9Z M10 9l-3 3 3 3 M14 15l3-3-3-3',

  // wrench
  maintenance:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',

  // play/triangle
  runtime:
    'M5 3l14 9L5 21V3Z',

  // magnifying glass
  search:
    'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M21 21l-6-6',

  // circular arrows
  refresh:
    'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',

  // plus in circle
  add:
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z M12 8v8 M8 12h8',

  // two arrows in circle
  sync:
    'M21 12a9 9 0 1 1-6.364-7.636L12 6.5 M21 3v6h-6',

  // person/bot icon
  agent:
    'M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M8 15h8 M12 15v4 M10 19h4',

  // star/sparkle
  skill:
    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z',

  // link/chain
  hook:
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',

  // puzzle piece
  plugin:
    'M19 7h-1V4a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v3h-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v3H5a2 2 0 0 0-2 2v3a1 1 0 0 0 1 1h1v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3h1a1 1 0 0 0 1-1V9a2 2 0 0 0-2-2Z',

  // terminal/tool icon
  mcp:
    'M4 17l6-6-6-6 M13 19h7',

  // box/cube icon
  package:
    'M12 2L2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5',

  // triangle with exclamation
  warning:
    'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z M12 9v4 M12 17h.01',

  // checkmark in circle
  check:
    'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',

  // external link / box with arrow
  'external-source':
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',

  // --- new icon paths (32) ---

  // chevron-left
  'chevron-left': 'M15 18l-6-6 6-6',

  // chevron-right
  'chevron-right': 'M9 18l6-6-6-6',

  // chevron-down
  'chevron-down': 'M6 9l6 6 6-6',

  // chevron-up
  'chevron-up': 'M18 15l-6-6-6 6',

  // arrow-left
  'arrow-left': 'M19 12H5 M12 19l-7-7 7-7',

  // arrow-right
  'arrow-right': 'M5 12h14 M12 5l7 7-7 7',

  // menu (hamburger / 3 lines)
  menu: 'M4 12h16 M4 6h16 M4 18h16',

  // folder-open
  'folder-open':
    'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',

  // folder
  folder:
    'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',

  // file-text
  'file-text':
    'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',

  // git-branch
  'git-branch':
    'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9',

  // copy
  copy:
    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z',

  // close (X mark)
  close: 'M18 6L6 18 M6 6l12 12',

  // minimize
  minimize: 'M5 12h14',

  // maximize (square/box for maximize state)
  maximize: 'M4 4h16v16H4z',

  // restore (overlapping squares)
  restore:
    'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3',

  // info
  info:
    'M12 16v-4 M12 8h.01 M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z',

  // play (triangle)
  play: 'M6 4l15 8-15 8z',

  // pause
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',

  // star
  star:
    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',

  // external-link
  'external-link':
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',

  // repo
  repo:
    'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z M12 8v8 M8 12h8',

  // focus (crosshair)
  focus:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10 10-4.477 10-10z M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83',

  // tree (file tree / hierarchy)
  tree: 'M3 3v18h18 M7 16h2m-2-4h6m-2-4h2m-2 8h4m-2-4h6',

  // layout (grid)
  layout: 'M3 9h18M3 15h18M9 3v18M15 3v18',

  // user
  user:
    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',

  // help-circle
  'help-circle':
    'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01 M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z',

  // diamond
  diamond:
    'M2.45 12.88a1.4 1.4 0 0 1 0-1.76L12 2l9.55 9.12a1.4 1.4 0 0 1 0 1.76L12 22 2.45 12.88Z',

  // hexagon
  hexagon:
    'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',

  // squared-plus
  'squared-plus': 'M3 3h18v18H3z M12 8v8 M8 12h8',

  // success (checkmark - same path as 'check')
  success:
    'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',

  // error (triangle with exclamation - same path as 'warning')
  error:
    'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
};

export default function AppIcon({
  name,
  size = 20,
  className,
}: {
  name: AppIconName;
  size?: number;
  className?: string;
}) {
  const pathData = ICON_PATHS[name];
  if (!pathData) {
    return null;
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={pathData} />
    </svg>
  );
}
