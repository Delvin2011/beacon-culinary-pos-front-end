// T0-8 part 2: the create-next-app and template pages are gone, with the components only they used, and nothing in
// the app loads from nextjs.org, vercel.com or openstreetmap.org. The deleted routes fall through to the app's 404
// (checked against the build's route manifest when building).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

const DELETED_ROUTES = ["roles", "customer-engagements", "order-management", "view-orders", "order-creation"]
const DELETED_FILES = [
  "components/engagements/engaments-table.tsx",
  "components/engagements/customer-chat.tsx",
  "components/orders/order-management.tsx",
  "components/orders/order-tracking.tsx",
  "components/orders/order-tracking-map-view.tsx",
  "components/orders/order-progress.tsx",
  "components/customer-orders/order-viewing.tsx",
  "components/customer-orders/order-progress.tsx",
  "components/customer-orders/order-creation.tsx",
  "components/customer-orders/order-payments.tsx",
  "components/date-picker-with-range.tsx",
  "components/ui/calendar.tsx",
  "components/ui/chart.tsx",
  "components/icons.tsx",
  "components/nav-projects.tsx",
  "components/search-form.tsx",
  "components/version-switcher.tsx",
  "hooks/use-order.ts",
  "contexts/order-context.tsx",
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx|css|mjs|js)$/.test(name) || /\.test\.|test-fixtures/.test(name)) return []
    return [path]
  })
}

describe("template pages removed", () => {
  it.each(DELETED_ROUTES)("/%s has no page", (route) => {
    expect(existsSync(join(SRC, "app", route, "page.tsx"))).toBe(false)
  })

  it("the components only they used are gone", () => {
    expect(DELETED_FILES.filter((file) => existsSync(join(SRC, file)))).toEqual([])
  })

  it("keeps /users redirecting to /staff", () => {
    expect(readFileSync(join(SRC, "app", "users", "page.tsx"), "utf8")).toContain('redirect("/staff")')
  })

  it("loads nothing from nextjs.org, vercel.com or openstreetmap.org", () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(50)
    const offenders = files
      .filter((path) => /nextjs\.org|vercel\.com|openstreetmap\.org/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
    expect(offenders).toEqual([])
  })
})
