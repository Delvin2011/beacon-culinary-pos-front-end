// T0-5b: the sidebar's "Meal periods" entry, for admins only.
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

describe("Meal periods in the sidebar", () => {
  it("links an admin to /meal-periods", async () => {
    role = "ADMIN"
    renderSidebar()
    const link = (await screen.findByText("Meal periods")).closest("a")!
    expect(link).toHaveAttribute("href", "/meal-periods")
  })

  it.each(["CASHIER", "HEAD_CHEF", "STOCK_ADMIN"])("isn't there for %s", (other) => {
    role = other
    renderSidebar()
    expect(screen.queryByText("Meal periods")).not.toBeInTheDocument()
  })
})
