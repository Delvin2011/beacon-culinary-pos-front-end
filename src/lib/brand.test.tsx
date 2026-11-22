// T0-8 part 3: the brand lives in src/lib/brand.ts and every place shows its values. The literal values are checked
// too: moving them into the module changed nothing staff see (except the login image's alt text, which now names
// the brand instead of "Image").
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { BRAND } from "@/lib/brand"

vi.mock("next/font/local", () => ({ default: () => ({ variable: "font" }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard" }))
const authFetch = vi.fn(async () => new Response(JSON.stringify({ items: [], page: 0, size: 1, totalItems: 0 }), { status: 200 }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Ayanda", email: "a@x.co", role: "ADMIN" }, authFetch, logout: vi.fn() }) }))

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})

describe("brand", () => {
  it("holds today's values", () => {
    expect(BRAND.name).toBe("Beacon Culinary")
    expect(BRAND.description).toBe("Canteen POS system")
    expect(BRAND.planLabel).toBe("Canteen")
    expect(BRAND.loginHeading).toBe("Login to your Beacon Culinary Account")
    expect(BRAND.loginImageAlt).toBe("Beacon Culinary")
    // Next imports the PNG as image data; the test runner as a plain path.
    const image = BRAND.loginImage as unknown as string | { src: string }
    expect(typeof image === "string" ? image : image.src).toMatch(/beacon_login_image/)
  })

  it("the page title and description come from it", async () => {
    const { metadata } = await import("@/app/layout")
    expect(metadata.title).toBe(BRAND.name)
    expect(metadata.description).toBe(BRAND.description)
  })

  it("the sidebar shows its name (team and group label) and plan", () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    )
    expect(screen.getAllByText(BRAND.name)).toHaveLength(2)
    expect(screen.getByText(BRAND.planLabel)).toBeInTheDocument()
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
