// T1-0d: every API call goes to /api on the page's own address, so one build serves every customer address.
// In production Azure Front Door, and on the local stack Caddy, send /api/* to the backend with the prefix removed;
// under `npm run dev` alone, a development-only rewrite in next.config.mjs does the same. No component builds an API
// URL itself: they all call apiUrl (or authFetch, which does). See docs/2026-11-24-relative-api.md.

export const API_PREFIX = "/api"

// The browser address of a backend path: "/auth/login" -> "/api/auth/login". The path is the backend's own, starting
// with "/" (a query string is fine). A full URL, a protocol-relative "//host" or a path that already starts with
// /api is a mistake and throws, so it shows up in development and tests instead of calling the wrong place.
export function apiUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`apiUrl: expected a backend path starting with "/", got "${path}"`)
  }
  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`) || path.startsWith(`${API_PREFIX}?`)) {
    throw new Error(`apiUrl: "${path}" already starts with ${API_PREFIX}; pass the backend path without it`)
  }
  return `${API_PREFIX}${path}`
}
