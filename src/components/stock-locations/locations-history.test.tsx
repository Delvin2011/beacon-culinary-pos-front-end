// T0-5d: the Changes panel: who, when, which location and what changed; newest first as the server sends them;
// filter by location (?locationId=), paging, and both kept in the URL.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocationsHistory } from "@/components/stock-locations/locations-history"
import type { LocationHistoryEntry } from "@/lib/locations"
import { COFFEE, PRODUCTION, adminLocations, jsonResponse } from "@/lib/locations.test-fixtures"

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch }) }))

const entry = (overrides: Partial<LocationHistoryEntry> & { id: number }): LocationHistoryEntry => ({
  locationId: COFFEE.id,
  action: "UPDATE",
  role: null,
  previousLocationId: null,
  before: null,
  after: { name: COFFEE.name, sortOrder: 30, active: true },
  changedAt: "2026-11-21T09:00:00Z",
  changedBy: 10010,
  changedByName: "Site Admin",
  ...overrides,
})

const content = [
  entry({ id: 12, action: "ASSIGN", role: "STATION_BAR", previousLocationId: PRODUCTION.id, changedAt: "2026-11-21T09:02:11Z" }),
  entry({ id: 11, before: { name: "Coffee Bar", sortOrder: 30, active: true }, changedAt: "2026-11-21T09:01:40Z" }),
  entry({ id: 10, action: "DEACTIVATE", locationId: 9, after: { name: "Old Pantry", sortOrder: 40, active: false }, before: { name: "Old Pantry", sortOrder: 40, active: true } }),
  entry({ id: 9, action: "CREATE", changedByName: null }),
]

beforeEach(() => {
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    const params = new URL(path, "http://x").searchParams
    const page = Number(params.get("page"))
    return jsonResponse({ content: page === 0 ? content : [entry({ id: 1, action: "ACTIVATE" })], page, size: Number(params.get("size")), totalElements: 5, totalPages: 2 })
  })
  window.history.replaceState(null, "", "/stock-locations?tab=history")
})

describe("Changes", () => {
  it("shows who, when, which location and what changed", async () => {
    render(<LocationsHistory locations={adminLocations()} />)
    const rows = await screen.findAllByTestId("history-row")
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText("Site Admin")).toBeInTheDocument()
    expect(within(rows[0]).getByText(COFFEE.name)).toBeInTheDocument()
    expect(within(rows[0]).getByText("Assigned")).toBeInTheDocument()
    expect(within(rows[0]).getByText(`Now the bar station's source (was ${PRODUCTION.name})`)).toBeInTheDocument()
    expect(within(rows[1]).getByText("Renamed from Coffee Bar to Coffee Station")).toBeInTheDocument()
    expect(within(rows[2]).getByText("Old Pantry")).toBeInTheDocument()
    expect(within(rows[2]).getAllByText("Deactivated")).toHaveLength(2)
    expect(within(rows[3]).getByText("Created as Coffee Station")).toBeInTheDocument()
    expect(within(rows[3]).getByText("—")).toBeInTheDocument()
    expect(authFetch).toHaveBeenCalledWith("/admin/locations/history?page=0&size=50", undefined)
  })

  it("filters by location, pages, and keeps both in the URL", async () => {
    render(<LocationsHistory locations={adminLocations()} />)
    await screen.findAllByTestId("history-row")
    expect(within(screen.getByLabelText("Location")).getByText("Old Pantry (inactive)")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: String(COFFEE.id) } })
    await waitFor(() => expect(authFetch).toHaveBeenLastCalledWith(`/admin/locations/history?locationId=${COFFEE.id}&page=0&size=50`, undefined))
    expect(window.location.search).toBe(`?tab=history&locationId=${COFFEE.id}`)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(authFetch).toHaveBeenLastCalledWith(`/admin/locations/history?locationId=${COFFEE.id}&page=1&size=50`, undefined))
    expect(window.location.search).toBe(`?tab=history&locationId=${COFFEE.id}&page=1`)
    expect(await screen.findByText("page 2 of 2", { exact: false })).toBeInTheDocument()
  })

  it("reads the filter and page from the URL", async () => {
    window.history.replaceState(null, "", `/stock-locations?tab=history&locationId=${PRODUCTION.id}&page=1&size=100`)
    render(<LocationsHistory locations={adminLocations()} />)
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(`/admin/locations/history?locationId=${PRODUCTION.id}&page=1&size=100`, undefined))
    expect(screen.getByLabelText("Location")).toHaveValue(String(PRODUCTION.id))
  })
})
