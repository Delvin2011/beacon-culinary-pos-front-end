// T0-5b: no meal-period names or codes made from them in the app's source. Period names come from GET /meal-periods
// (contract docs/2026-11-20-t0-5-meal-periods-locations-api-contract.md, section 8): an admin can rename or add
// periods, and anything keyed on a name breaks. Tests and test fixtures may use names as data.
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

// Comments removed, so the contract's term "the All Day period" may still explain the code.
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }))

function offenders(test: (text: string) => RegExpMatchArray | null, strip = false): string[] {
  return files.flatMap(({ path, text }) => {
    const match = test(strip ? withoutComments(text) : text)
    return match ? [`${path}: ${match[0]}`] : []
  })
}

describe("no hard-coded meal periods", () => {
  it("scans the app's source", () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.path === "components/pos/order-builder.tsx")).toBe(true)
  })

  it("names no period anywhere, comments included", () => {
    expect(offenders((text) => text.match(/\b(Breakfast|Lunch|Dinner|Supper|BREAKFAST|LUNCH|DINNER|SUPPER)\b/))).toEqual([])
  })

  it("has no All Day name or ALL_DAY code in code (only the allDay flag)", () => {
    expect(offenders((text) => text.match(/\bAll Day\b|\bALL_DAY\b/), true)).toEqual([])
  })

  it("never turns a period name into a code", () => {
    expect(offenders((text) => text.match(/period\w*(\.name)?\.toUpperCase\(\)/i), true)).toEqual([])
    expect(offenders((text) => text.match(/[?&]period=\$\{(?!encodeURIComponent\()/), true)).toEqual([])
  })
})
