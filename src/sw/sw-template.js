// O3: the POS service worker. scripts/build-sw.mjs prepends SW_VERSION and PRECACHE and inlines src/sw/routes.mjs
// above this file into public/sw.js. Not loaded on its own.
//
// - install: precaches the POS pages (HTML), their route data and their static files into pos-shell-{version}.
//   No skipWaiting: an update waits until the app sends SKIP_WAITING (only on the sign-in screen).
// - fetch: POS pages and route data: network first (4 s), the cached copy when the network fails; precached static
//   files: cache first. Everything else (API calls, other origins, back office, non-GET) is never touched.
//   Nothing is cached at run time: only what this build precached, so a newer page never mixes with older files.
// - activate: deletes other builds' caches and takes over open pages.

/* global SW_VERSION, PRECACHE, POS_ROUTES, NETWORK_TIMEOUT_MS, classifyRequest, cacheKeyFor, cacheNameFor, staleCaches */

const CACHE = cacheNameFor(SW_VERSION)
const PRECACHED = new Set(PRECACHE)

// Cache keys and precache requests as absolute URLs on this origin.
const absolute = (pathOrKey) => new URL(pathOrKey, self.location.origin).href

async function precacheRoute(cache, route) {
  const page = await fetch(absolute(route), { cache: "no-store", credentials: "same-origin" })
  if (!page.ok) throw new Error(`precache ${route}: ${page.status}`)
  await cache.put(absolute(cacheKeyFor("page", route)), page)
  const data = await fetch(absolute(route), { cache: "no-store", credentials: "same-origin", headers: { RSC: "1" } })
  if (!data.ok) throw new Error(`precache ${route} data: ${data.status}`)
  await cache.put(absolute(cacheKeyFor("rsc", route)), data)
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(PRECACHE.map(absolute))
      for (const route of POS_ROUTES) await precacheRoute(cache, route)
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(staleCaches(names, SW_VERSION).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting()
})

async function fromCache(key) {
  const cache = await caches.open(CACHE)
  // Route data varies on Next's router headers; the cached copy is the one for this build either way.
  return cache.match(absolute(key), { ignoreVary: true, ignoreSearch: false })
}

async function networkFirst(request, key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    const response = await fetch(request, { signal: controller.signal })
    if (response.status < 500) return response
    return (await fromCache(key)) || response
  } catch (err) {
    const cached = await fromCache(key)
    if (cached) return cached
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function cacheFirst(request, key) {
  return (await fromCache(key)) || fetch(request)
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  const kind = classifyRequest({
    method: request.method,
    url,
    origin: self.location.origin,
    isNavigate: request.mode === "navigate",
    isRsc: request.headers.get("RSC") === "1",
    precached: PRECACHED,
  })
  if (kind === "pass") return
  const key = cacheKeyFor(kind, url.pathname)
  event.respondWith(kind === "static" ? cacheFirst(request, key) : networkFirst(request, key))
})
