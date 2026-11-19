// O4: the sidebar's "Sale exceptions" entry, with the open count, for admins only.
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"

let role: string
const authFetch = vi.fn<(path: string) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Ayanda", email: "a@x.co", role }, authFetch, logout: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard" }))

beforeEach(() => {
  authFetch.mockReset()
  authFetch.mockImplementation(async () => new Response(JSON.stringify({ items: [], page: 0, size: 1, totalItems: 4 }), { status: 200 }))
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})

const renderSidebar = () =>
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )

describe("Sale exceptions in the sidebar", () => {
  it("shows the entry with the open REVIEW count for an admin", async () => {
    role = "ADMIN"
    renderSidebar()
    const link = (await screen.findByText("Sale exceptions")).closest("a")!
    expect(link).toHaveAttribute("href", "/sale-exceptions")
    await waitFor(() => expect(screen.getByLabelText("4 open")).toHaveTextContent("4"))
    expect(authFetch).toHaveBeenCalledWith("/admin/sale-exceptions?status=OPEN&severity=REVIEW&size=1")
  })

  it("isn't there for a cashier, and nothing is asked", () => {
    role = "CASHIER"
    renderSidebar()
    expect(screen.queryByText("Sale exceptions")).not.toBeInTheDocument()
    expect(authFetch).not.toHaveBeenCalled()
  })
})
