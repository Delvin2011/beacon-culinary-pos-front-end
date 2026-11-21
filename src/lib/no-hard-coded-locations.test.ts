// T0-5d: no stock-location names or ids in the app's source. Locations come from GET /locations and
// /admin/locations (contract docs/2026-11-21-t0-5c-locations-api-contract.md): the primary is found by kind, and an
// admin can rename any location or add more. Tests and test fixtures may use names as data.
// "Kitchen" stays where it is a station or a screen (the KITCHEN station, the kitchen display, kitchen tickets): those
// uses are lowercase in prose or the station label "Kitchen" on its own, which these checks don't match.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.|test-fixtures/.test(name)) return []
    return [path]
  })
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }))

function offenders(pattern: RegExp, strip = false): string[] {
  return files.flatMap(({ path, text }) => {
    const match = (strip ? withoutComments(text) : text).match(pattern)
    return match ? [`${path}: ${match[0]}`] : []
  })
}

describe("no hard-coded stock locations", () => {
  it("scans the app's source", () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.path === "app/inventory/page.tsx")).toBe(true)
    expect(files.some((f) => f.path.includes("test-fixtures"))).toBe(false)
  })

  it("names no Main Store anywhere, comments included", () => {
    expect(offenders(/main ?store\b/i)).toEqual([])
  })

  it("never uses Kitchen as a place", () => {
    expect(offenders(/\b(?:the|in|In|into|from|to|at) Kitchen\b/)).toEqual([])
    expect(offenders(/\bKitchen(?: [Ss]tock\b|'s|&apos;s| can\b)/)).toEqual([])
  })

  it("never finds a location by its name", () => {
    expect(offenders(/locationName\s*[!=]==?\s*["'`]/, true)).toEqual([])
  })

  it("never names a location id in code", () => {
    expect(offenders(/\blocationIds?\s*:\s*\[?\s*\d/, true)).toEqual([])
  })
})
