export type IconName =
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
  | 'external-source';

const ICON_PATHS: Record<IconName, string> = {
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
};

export default function CatalogIcon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
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
