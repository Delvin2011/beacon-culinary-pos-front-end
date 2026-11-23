// O3: what the POS service worker handles, as pure functions. Plain JavaScript: scripts/build-sw.mjs inlines this
// file into public/sw.js (dropping the `export` keywords), and the unit tests import it as it is.
// Only the POS shell is ever served from the cache. API calls (/api/* on this origin since T1-0d: /api/health,
// /api/pos/till-status, /api/pos/offline/*, the streams, everything) and back-office routes are never touched.

// The POS routes whose page and route data are precached.
export const POS_ROUTES = ["/pos", "/pos/login", "/pos/shift-open"]

// The entries of .next/app-build-manifest.json those routes need (exact keys: "/pos-activity" is back office).
export const POS_MANIFEST_KEYS = ["/layout", "/pos/layout", "/pos/page", "/pos/login/page", "/pos/shift-open/page"]

// How long a POS page or its route data may take from the network before the cached copy is used.
export const NETWORK_TIMEOUT_MS = 4000

// Never handled, whatever else changes: the invite page and the invite API (T0-6b: an invite token must never reach
// a cache), and the whole API (T1-0d: /api/* is on this origin now, streams included). The worker never answers
// those requests: the browser handles them as if there were no worker.
export const NEVER_HANDLED = ["/invite", "/auth/invites", "/api"]

export function normalizePath(pathname) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

export function isPosRoute(pathname) {
  return POS_ROUTES.includes(normalizePath(pathname))
}

export function isNeverHandled(pathname) {
  const path = normalizePath(pathname)
  return NEVER_HANDLED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

// The static files to precache: those the POS routes' manifest entries list, plus fonts and images (static/media,
// loaded by the CSS and the sign-in screen). Returned as URL paths ("/_next/static/...").
export function posPrecacheFiles(manifestPages, mediaFiles) {
  const files = new Set()
  for (const key of POS_MANIFEST_KEYS) {
    for (const file of manifestPages[key] || []) files.add(`/_next/${file}`)
  }
  for (const file of mediaFiles || []) files.add(`/_next/static/media/${file}`)
  return Array.from(files).sort()
}

// "page": a POS page load; "rsc": its route data (client navigation); "static": a precached file; "pass": anything
// else, left to the browser.
export function classifyRequest({ method, url, origin, isNavigate, isRsc, precached }) {
  if (isNeverHandled(url.pathname)) return "pass"
  if (method !== "GET") return "pass"
  if (url.origin !== origin) return "pass"
  const path = normalizePath(url.pathname)
  if (path.startsWith("/_next/static/")) return precached.has(path) ? "static" : "pass"
  if (!isPosRoute(path)) return "pass"
  if (isRsc) return "rsc"
  return isNavigate ? "page" : "pass"
}

// The cache key: the path for pages and files, and a separate key for route data (it varies on the RSC header).
export function cacheKeyFor(kind, pathname) {
  const path = normalizePath(pathname)
  return kind === "rsc" ? `${path}?__pos_rsc=1` : path
}

export function cacheNameFor(version) {
  return `pos-shell-${version}`
}

// Caches of other builds, deleted when this version activates.
export function staleCaches(cacheNames, version) {
  return cacheNames.filter((name) => name.startsWith("pos-shell-") && name !== cacheNameFor(version))
}
