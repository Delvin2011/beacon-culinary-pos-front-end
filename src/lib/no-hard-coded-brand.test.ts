// T0-8 part 3: the brand name lives only in src/lib/brand.ts, so T1 can swap it for the branding API response in one
// place. Tests may use it as data; docs live outside src.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx|mjs|js|css|svg|json|md)$/.test(name) || /\.test\.|test-fixtures/.test(name)) return []
    return [path]
  })
}

describe("no hard-coded brand", () => {
  it("names Beacon Culinary only in src/lib/brand.ts", () => {
    const files = sourceFiles(SRC).map((path) => relative(SRC, path).replace(/\\/g, "/"))
    expect(files).toContain("lib/brand.ts")
    const offenders = files.filter((path) => path !== "lib/brand.ts" && /Beacon Culinary/i.test(readFileSync(join(SRC, path), "utf8")))
    expect(offenders).toEqual([])
  })
})
