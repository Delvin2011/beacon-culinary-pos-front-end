// T0-5d: the sidebar's "Stock locations" entry, for admins only (everyone else gets 403 from /admin/locations).
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

describe("Stock locations in the sidebar", () => {
  it("is there for an admin", async () => {
    role = "ADMIN"
    renderSidebar()
    expect((await screen.findByText("Stock locations")).closest("a")).toHaveAttribute("href", "/stock-locations")
  })

  it.each(["STOCK_ADMIN", "STOCK_CLERK", "HEAD_CHEF", "CASHIER"])("isn't there for %s", (r) => {
    role = r
    renderSidebar()
    expect(screen.queryByText("Stock locations")).not.toBeInTheDocument()
  })
})
