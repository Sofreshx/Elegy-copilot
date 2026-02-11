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

/**
 * Parse the CORS_ORIGINS env var into a deduplicated allowlist.
 * In development mode (NODE_ENV=development) common localhost
 * origins are automatically included.
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  const origins = raw
    ? raw.split(",").map((o) => o.trim()).filter(Boolean)
    : [...DEFAULT_ORIGINS];

  if (process.env.NODE_ENV === "development") {
    for (const devOrigin of DEV_ORIGINS) {
      if (!origins.includes(devOrigin)) {
        origins.push(devOrigin);
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
  return getAllowedOrigins().includes(origin);
}
