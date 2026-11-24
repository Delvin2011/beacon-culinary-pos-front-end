// T1-0d: one build serves every customer address, so the app never names a backend address. Every API call goes
// through apiUrl (src/lib/api-url.ts): "/api" + the backend path, on the page's own address. T1-3: and through
// apiFetch (src/lib/api-fetch.ts), the one caller of apiUrl, which reads every response for what it says about the
// customer (suspended, unavailable, unknown address). Comments are ignored; tests and fixtures may use addresses as data. The development-only rewrite lives in next.config.mjs, outside src.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__snapshots__" ? [] : sourceFiles(path)
    if (!/\.(ts|tsx|mjs|js)$/.test(name) || /\.test\.|test-fixtures/.test(name)) return []
    return [path]
  })
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replace(/\\/g, "/"),
  text: withoutComments(readFileSync(path, "utf8")),
}))

function offenders(pattern: RegExp, except: string[] = []): string[] {
  return files.flatMap(({ path, text }) => {
    if (except.includes(path)) return []
    const match = text.match(pattern)
    return match ? [`${path}: ${match[0]}`] : []
  })
}

describe("no backend address in the app", () => {
  it("scans the app's source, the service worker included", () => {
    expect(files.length).toBeGreaterThan(50)
    for (const path of ["contexts/auth-context.tsx", "lib/invites.ts", "sw/routes.mjs", "lib/api-url.ts", "lib/api-fetch.ts"]) {
      expect(files.some((file) => file.path === path)).toBe(true)
    }
  })

  it("never reads the old build-time API address", () => {
    expect(offenders(/NEXT_PUBLIC_AUTH_API_URL/)).toEqual([])
  })

  it("never names the local backend", () => {
    expect(offenders(/localhost:8080|127\.0\.0\.1:8080/)).toEqual([])
  })

  // sw/routes.mjs names /api only to leave it alone (the worker never handles API calls).
  it("writes /api only in api-url.ts and the service worker's never-handled list", () => {
    expect(offenders(/["'`]\/api(?=[/"'`?])/, ["lib/api-url.ts", "sw/routes.mjs"])).toEqual([])
  })

  it("never passes a hand-built address to fetch: apiUrl(...) or a variable made from it", () => {
    expect(offenders(/\b(?:fetch|fetchWithTimeout|EventSource)\(\s*["'`]/)).toEqual([])
  })

  // T1-3: a call that skipped apiFetch would miss CUSTOMER_SUSPENDED and keep calling a suspended customer.
  it("calls the API only through apiFetch: apiUrl is used in api-fetch.ts alone", () => {
    expect(offenders(/\bapiUrl\(/, ["lib/api-url.ts", "lib/api-fetch.ts"])).toEqual([])
    expect(offenders(/\bfetchWithTimeout\(/, ["lib/net.ts", "lib/api-fetch.ts"])).toEqual([])
  })

  it("names no http(s) host (XML namespaces aside)", () => {
    expect(offenders(/["'`]https?:\/\/(?!www\.w3\.org\/)/)).toEqual([])
  })
})
