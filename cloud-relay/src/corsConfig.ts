/**
 * Shared CORS origins configuration.
 *
 * Single source of truth for parsing the CORS_ORIGINS env var.
 * Used by both the HTTP auth CORS middleware and the WebSocket
 * upgrade origin check.
 */

const DEFAULT_ORIGINS = ["https://instruction-engine.pages.dev"];
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

function normalizeOrigin(raw: string): string {
  // Origin headers never include a trailing slash, but env vars often do.
  // Normalize to avoid accidental mismatches (e.g. https://example.com/).
  const trimmed = raw.trim();
  const unquoted = trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replace(/\/+$/, "");
}

/**
 * Parse the CORS_ORIGINS env var into a deduplicated allowlist.
 * In development mode (NODE_ENV=development) common localhost
 * origins are automatically included.
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  const origins = raw
    ? raw.split(",").map(normalizeOrigin).filter(Boolean)
    : DEFAULT_ORIGINS.map(normalizeOrigin);

  if (process.env.NODE_ENV === "development") {
    for (const devOrigin of DEV_ORIGINS) {
      const normalized = normalizeOrigin(devOrigin);
      if (!origins.includes(normalized)) {
        origins.push(normalized);
      }
    }
  }

  return origins;
}

/**
 * Check whether a given Origin header value is in the allowlist.
 * Requests without an Origin header (server-side clients) are
 * always permitted.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return getAllowedOrigins().includes(normalizeOrigin(origin));
}
