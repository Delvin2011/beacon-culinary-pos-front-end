// O3: the POS service worker. The routing rules, the build script, and the generated worker itself run in a small
// fake service-worker scope: it precaches only the POS shell, serves POS pages from the cache when the network fails,
// and never touches API calls, other origins, back-office routes or non-GET requests.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
// Plain JavaScript (allowJs): routes.mjs is also inlined into public/sw.js.
import { cacheKeyFor, classifyRequest, posPrecacheFiles, staleCaches } from "@/sw/routes.mjs"
import { buildServiceWorker } from "../../scripts/build-sw.mjs"

const ORIGIN = "https://pos.example.co.za"
const API = "https://api.example.co.za"

const manifestPages: Record<string, string[]> = {
  "/layout": ["static/chunks/webpack-1.js", "static/css/app.css", "static/chunks/app/layout-1.js"],
  "/pos/layout": ["static/chunks/webpack-1.js", "static/chunks/app/pos/layout-1.js"],
  "/pos/page": ["static/chunks/app/pos/page-1.js", "static/chunks/pos-shared.js"],
  "/pos/login/page": ["static/chunks/app/pos/login/page-1.js"],
  "/pos/shift-open/page": ["static/chunks/app/pos/shift-open/page-1.js"],
  "/pos-activity/page": ["static/chunks/app/pos-activity/page-1.js"],
  "/inventory/page": ["static/chunks/app/inventory/page-1.js"],
}
const mediaFiles = ["font-1.woff2", "beacon_login_image.png"]
const precache: string[] = posPrecacheFiles(manifestPages, mediaFiles)

const classify = (url: string, extra: Partial<{ method: string; isNavigate: boolean; isRsc: boolean }> = {}) =>
  classifyRequest({ method: "GET", url: new URL(url), origin: ORIGIN, isNavigate: true, isRsc: false, precached: new Set(precache), ...extra })

describe("what is precached", () => {
  it("only the POS routes' files, fonts and images: never /pos-activity or the back office", () => {
    expect(precache).toContain("/_next/static/chunks/app/pos/page-1.js")
    expect(precache).toContain("/_next/static/chunks/app/pos/login/page-1.js")
    expect(precache).toContain("/_next/static/css/app.css")
    expect(precache).toContain("/_next/static/media/font-1.woff2")
    expect(precache.filter((f) => f.includes("pos-activity") || f.includes("inventory"))).toEqual([])
    expect(new Set(precache).size).toBe(precache.length)
  })
})

describe("routing", () => {
  it("POS pages and their route data", () => {
    expect(classify(`${ORIGIN}/pos`)).toBe("page")
    expect(classify(`${ORIGIN}/pos/login/`)).toBe("page")
    expect(classify(`${ORIGIN}/pos/shift-open`)).toBe("page")
    expect(classify(`${ORIGIN}/pos?_rsc=abc`, { isNavigate: false, isRsc: true })).toBe("rsc")
    expect(classify(`${ORIGIN}/_next/static/chunks/app/pos/page-1.js`, { isNavigate: false })).toBe("static")
  })

  it.each([
    ["an API call", `${API}/orders/today`],
    ["/health", `${API}/health`],
    ["/pos/till-status", `${API}/pos/till-status`],
    ["the offline snapshot", `${API}/pos/offline/snapshot`],
    ["a back-office page", `${ORIGIN}/inventory`],
    ["/pos-activity", `${ORIGIN}/pos-activity`],
    ["a static file no POS route needs", `${ORIGIN}/_next/static/chunks/app/inventory/page-1.js`],
  ])("never handles %s", (_, url) => {
    expect(classify(url)).toBe("pass")
  })

  it("never handles a POST, even to a POS path", () => {
    expect(classify(`${ORIGIN}/pos`, { method: "POST" })).toBe("pass")
  })

  it("keeps route data apart from the page, and deletes only other builds' caches", () => {
    expect(cacheKeyFor("page", "/pos/")).toBe("/pos")
    expect(cacheKeyFor("rsc", "/pos")).toBe("/pos?__pos_rsc=1")
    expect(staleCaches(["pos-shell-a", "pos-shell-b", "other"], "b")).toEqual(["pos-shell-a"])
  })
})

// ---- The generated worker in a fake scope ----

async function generatedWorker() {
  const root = path.resolve(__dirname, "../..")
  return buildServiceWorker({
    buildId: "test-build",
    manifestPages,
    mediaFiles,
    routesSource: fs.readFileSync(path.join(root, "src/sw/routes.mjs"), "utf8"),
    templateSource: fs.readFileSync(path.join(root, "src/sw/sw-template.js"), "utf8"),
  }) as Promise<string>
}

function fakeScope(network: (request: Request) => Promise<Response>) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const stores = new Map<string, Map<string, Response>>()
  const abs = (key: string | Request) => new URL(typeof key === "string" ? key : key.url, ORIGIN).href
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        async addAll(urls: string[]) {
          for (const url of urls) store.set(abs(url), new Response(`file ${url}`))
        },
        async put(key: string | Request, response: Response) {
          store.set(abs(key), response)
        },
        async match(key: string | Request) {
          return store.get(abs(key))?.clone()
        },
      }
    },
    async keys() {
      return Array.from(stores.keys())
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }
  const fetchFn = vi.fn(async (input: RequestInfo, init?: RequestInit) => network(new Request(new URL(String(typeof input === "string" ? input : input.url), ORIGIN), init)))
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  return { self, caches, fetchFn, listeners, stores }
}

async function install(source: string, network: (request: Request) => Promise<Response>) {
  const scope = fakeScope(network)
  new Function("self", "caches", "fetch", source)(scope.self, scope.caches, scope.fetchFn)
  let done: Promise<unknown> = Promise.resolve()
  scope.listeners.install({ waitUntil: (p: Promise<unknown>) => (done = p) })
  await done
  return scope
}

async function dispatch(scope: Awaited<ReturnType<typeof install>>, request: Request) {
  let response: Promise<Response> | undefined
  scope.listeners.fetch({ request, respondWith: (r: Promise<Response>) => (response = r) })
  return response
}

const navigate = (url: string) => {
  const request = new Request(url)
  Object.defineProperty(request, "mode", { value: "navigate" })
  return request
}

describe("the generated worker", () => {
  const online = async (request: Request) =>
    new Response(request.headers.get("RSC") === "1" ? `data ${new URL(request.url).pathname}` : `page ${new URL(request.url).pathname}`)

  it("precaches the static files, the three POS pages and their route data, nothing else", async () => {
    const scope = await install(await generatedWorker(), online)
    const cached = Array.from(scope.stores.get("pos-shell-test-build")!.keys()).map((url) => url.replace(ORIGIN, ""))
    expect(cached).toEqual(
      expect.arrayContaining(["/pos", "/pos?__pos_rsc=1", "/pos/login", "/pos/login?__pos_rsc=1", "/pos/shift-open", "/pos/shift-open?__pos_rsc=1"]),
    )
    expect(cached.filter((url) => !url.startsWith("/_next/") && !url.startsWith("/pos"))).toEqual([])
    expect(cached.some((url) => url.includes("inventory") || url.includes("pos-activity"))).toBe(false)
  })

  it("offline, a POS page and its route data come from the cache", async () => {
    let up = true
    const scope = await install(await generatedWorker(), async (request) => {
      if (!up) throw new TypeError("Failed to fetch")
      return online(request)
    })
    up = false
    expect(await (await dispatch(scope, navigate(`${ORIGIN}/pos`)))!.text()).toBe("page /pos")
    const data = new Request(`${ORIGIN}/pos/login?_rsc=xyz`, { headers: { RSC: "1" } })
    expect(await (await dispatch(scope, data))!.text()).toBe("data /pos/login")
  })

  it("online, a POS page comes from the network (and isn't re-cached)", async () => {
    const scope = await install(await generatedWorker(), async (request) => new Response(`fresh ${new URL(request.url).pathname}`))
    expect(await (await dispatch(scope, navigate(`${ORIGIN}/pos`)))!.text()).toBe("fresh /pos")
  })

  it("never answers API calls, back-office pages or POSTs", async () => {
    const scope = await install(await generatedWorker(), online)
    expect(await dispatch(scope, new Request(`${API}/pos/till-status`))).toBeUndefined()
    expect(await dispatch(scope, new Request(`${API}/health`))).toBeUndefined()
    expect(await dispatch(scope, navigate(`${ORIGIN}/inventory`))).toBeUndefined()
    expect(await dispatch(scope, new Request(`${ORIGIN}/pos`, { method: "POST", body: "x" }))).toBeUndefined()
  })

  it("waits for SKIP_WAITING to activate, and then deletes older builds' caches", async () => {
    const scope = await install(await generatedWorker(), online)
    await scope.caches.open("pos-shell-old-build")
    expect(scope.self.skipWaiting).not.toHaveBeenCalled()
    scope.listeners.message({ data: { type: "SKIP_WAITING" } })
    expect(scope.self.skipWaiting).toHaveBeenCalled()
    let done: Promise<unknown> = Promise.resolve()
    scope.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
    expect(await scope.caches.keys()).toEqual(["pos-shell-test-build"])
  })

  it("the build stops when the manifest has no /pos files", async () => {
    await expect(
      buildServiceWorker({ buildId: "x", manifestPages: {}, mediaFiles: [], routesSource: "", templateSource: "" }),
    ).rejects.toThrow(/no files for \/pos\/page/)
  })
})
