// T0-8 part 4: the site's time zone, currency code and "R" prefix live only in src/lib/locale.ts, so T1 can take
// them from the API in one place. Comments are ignored (prose may say "R 0,00"); tests and fixtures may use the
// values as data.
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

const files = sourceFiles(SRC)
  .map((path) => ({ path: relative(SRC, path).replace(/\\/g, "/"), text: withoutComments(readFileSync(path, "utf8")) }))
  .filter((file) => file.path !== "lib/locale.ts")

function offenders(pattern: RegExp): string[] {
  return files.flatMap(({ path, text }) => {
    const match = text.match(pattern)
    return match ? [`${path}: ${match[0]}`] : []
  })
}

describe("no hard-coded locale", () => {
  it("scans the app's source", () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.path === "lib/receipt.ts")).toBe(true)
  })

  it("names the time zone only in locale.ts", () => {
    expect(offenders(/Africa\/Johannesburg/)).toEqual([])
  })

  it("names the currency code only in locale.ts", () => {
    expect(offenders(/["'`]ZAR["'`]/)).toEqual([])
  })

  it("writes no literal R money prefix", () => {
    expect(offenders(/`R \$\{|\bR\$\{|["'`]R ["'`]|\(R, |: R \{|>R \{/)).toEqual([])
  })
})
