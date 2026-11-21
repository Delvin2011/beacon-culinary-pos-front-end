// T0-5d: pending stock takes, filtered on the server (?status=SUBMITTED&locationId=…). The location filter comes from
// GET /locations?includeInactive=true, marks deactivated locations, and is kept in the URL.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StockTakesQueuePage from "@/app/inventory/stock-takes/page"
import { COFFEE, PRIMARY, PRODUCTION, jsonResponse, pickerLocations } from "@/lib/locations.test-fixtures"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/stock-takes" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
// One user object, as the real context gives: the page reloads whenever `user` changes.
const user = { name: "Thandi", role: "STOCK_ADMIN" }
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user, authFetch }),
}))

const OLD = { id: 9, name: "Old Pantry", kind: "SECONDARY" as const, sortOrder: 40 }

const take = (id: number, location: { id: number; name: string }) => ({
  id,
  locationId: location.id,
  locationName: location.name,
  status: "SUBMITTED",
  submittedByName: "Sipho",
  submittedAt: "2026-11-21T08:00:00Z",
  lines: [{ ingredientId: 1 }],
})

const takeCalls = () => authFetch.mock.calls.map(([path]) => path).filter((path) => path.startsWith("/stock-takes"))

beforeEach(() => {
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    if (path === "/locations") return jsonResponse(pickerLocations())
    if (path === "/locations?includeInactive=true") return jsonResponse([...pickerLocations(), OLD])
    if (path.startsWith("/stock-takes")) {
      const locationId = Number(new URL(path, "http://x").searchParams.get("locationId"))
      const all = [take(5, COFFEE), take(6, OLD)]
      return jsonResponse(locationId ? all.filter((t) => t.locationId === locationId) : all)
    }
    return jsonResponse({}, 404)
  })
  window.history.replaceState(null, "", "/inventory/stock-takes")
})

describe("pending stock takes", () => {
  it("asks the server for submitted ones and shows each one's location", async () => {
    render(<StockTakesQueuePage />)
    expect(await screen.findByText("#5")).toBeInTheDocument()
    expect(takeCalls()).toEqual(["/stock-takes?status=SUBMITTED"])
    expect(screen.getByText(COFFEE.name, { selector: "td" })).toBeInTheDocument()
  })

  it("filters by location, deactivated ones included and marked, and keeps it in the URL", async () => {
    render(<StockTakesQueuePage />)
    const filter = screen.getByLabelText("Location")
    await waitFor(() =>
      expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "All locations",
        PRIMARY.name,
        PRODUCTION.name,
        COFFEE.name,
        "Old Pantry (inactive)",
      ]),
    )
    fireEvent.change(filter, { target: { value: String(OLD.id) } })
    await waitFor(() => expect(takeCalls().at(-1)).toBe(`/stock-takes?status=SUBMITTED&locationId=${OLD.id}`))
    expect(window.location.search).toBe(`?locationId=${OLD.id}`)
    expect(await screen.findByText("#6")).toBeInTheDocument()
    expect(screen.queryByText("#5")).not.toBeInTheDocument()
  })

  it("reads the filter from the URL", async () => {
    window.history.replaceState(null, "", `/inventory/stock-takes?locationId=${PRODUCTION.id}`)
    render(<StockTakesQueuePage />)
    expect(await screen.findByText("No pending stock takes at this location.")).toBeInTheDocument()
    expect(takeCalls()[0]).toBe(`/stock-takes?status=SUBMITTED&locationId=${PRODUCTION.id}`)
  })
})
