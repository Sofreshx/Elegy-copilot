/** Resolve public assets against the Vite/Tauri base path. */
export function assetPath(path: string): string {
  const normalized = path.replace(/^\/+/, '');
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
  return `${base}${normalized}`;
}
