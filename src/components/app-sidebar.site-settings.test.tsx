// T0-4b: the sidebar's "Site settings" entry, for admins only.
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"

let role: string
const authFetch = vi.fn<(path: string) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Ayanda", email: "a@x.co", role }, authFetch, logout: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard" }))

beforeEach(() => {
  authFetch.mockReset()
  authFetch.mockImplementation(async () => new Response(JSON.stringify({ items: [], page: 0, size: 1, totalItems: 0 }), { status: 200 }))
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})

const renderSidebar = () =>
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )

describe("Site settings in the sidebar", () => {
  it("links an admin to /site-settings", async () => {
    role = "ADMIN"
    renderSidebar()
    const link = (await screen.findByText("Site settings")).closest("a")!
    expect(link).toHaveAttribute("href", "/site-settings")
  })

  it.each(["CASHIER", "HEAD_CHEF", "STOCK_ADMIN"])("isn't there for %s", (other) => {
    role = other
    renderSidebar()
    expect(screen.queryByText("Site settings")).not.toBeInTheDocument()
  })
})
