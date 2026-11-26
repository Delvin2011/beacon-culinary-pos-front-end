// T0-8, T1-8: src/lib/brand.ts holds only the product's neutral words; the customer's name comes from
// GET /public/branding (src/lib/customer-branding.ts) and the back office's sidebar shows it.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { BRAND } from "@/lib/brand"
import { BRANDING_STORAGE_KEY } from "@/lib/customer-branding"

vi.mock("next/font/local", () => ({ default: () => ({ variable: "font" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard" }))
const authFetch = vi.fn(async () => new Response(JSON.stringify({ items: [], page: 0, size: 1, totalItems: 0 }), { status: 200 }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Ayanda", email: "a@x.co", role: "ADMIN" }, authFetch, logout: vi.fn() }) }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )
}

describe("brand", () => {
  it("holds only neutral values", () => {
    expect(BRAND).toEqual({ productName: "Canteen POS", description: "Canteen POS system", planLabel: "Canteen" })
  })

  it("the static page title is the neutral product name", async () => {
    const { metadata } = await import("@/app/layout")
    expect(metadata.title).toBe("Canteen POS")
    expect(metadata.description).toBe(BRAND.description)
  })

  it("the sidebar shows the customer's name (team and group label), the plan, and no logo when it has none", () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
    const { container } = renderSidebar()
    expect(screen.getAllByText("Riverside Canteen")).toHaveLength(2)
    expect(screen.getByText(BRAND.planLabel)).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
  })

  it("the sidebar shows the customer's logo when it has one", () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: "https://cdn.example/logo.png" }))
    renderSidebar()
    expect(screen.getByRole("img", { name: "Riverside Canteen logo" })).toHaveAttribute("src", "https://cdn.example/logo.png")
  })

  it("the sidebar shows the neutral name when nothing is known", () => {
    renderSidebar()
    expect(screen.getAllByText("Canteen POS")).toHaveLength(2)
  })

  it("the favicon is the neutral Lucide icon, with its licence", () => {
    const app = join(__dirname, "..", "app")
    expect(existsSync(join(app, "favicon.ico"))).toBe(false)
    const icon = readFileSync(join(app, "icon.svg"), "utf8")
    expect(icon).toContain("Lucide")
    expect(icon).toContain("ISC License")
    expect(icon).not.toMatch(/beacon|next\.js|vercel/i)
  })
})
