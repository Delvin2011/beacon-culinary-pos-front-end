// O3: with no live menu (e.g. a reload while offline) the order builder shows today's snapshot, read-only; a live
// menu is never replaced by it; Today's Orders says "Not available offline".
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import type { OfflineContextValue } from "@/contexts/offline-context"
import { parseSnapshot } from "@/lib/offline/contract"
import type { TillStatus } from "@/lib/till"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 412, owner: { id: 17, name: "Thandi" }, openedAt: "2026-11-18T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

let online: boolean
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: online, status: online ? "online" : "offline", reason: null, checkNow: () => {} }),
}))

let offline: Partial<OfflineContextValue>
vi.mock("@/contexts/offline-context", () => ({ useOffline: () => offline }))

const tillStatus = { offlineEnabled: true } as TillStatus

const snapshotBody = {
  snapshotVersion: "v1",
  tradingDay: "2026-11-18",
  periods: [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", allDay: false }],
  options: [
    { id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY",
      plannedPortions: 40, portionsRemaining: 12, outToday: false, alwaysOn: false },
    { id: 912, name: "Still water 500 ml", station: "NONE", group: "BEVERAGES", periodId: null, price: 20, status: "READY",
      plannedPortions: null, portionsRemaining: null, outToday: false, alwaysOn: true },
  ],
  extras: [],
}

const fetchMock = vi.fn<typeof fetch>()
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
let serverUp: boolean

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", name: "Thandi", role: "CASHIER", cashierId: 17 } }))
  online = false
  serverUp = false
  offline = { tillStatus, snapshot: parseSnapshot(snapshotBody), snapshotReceivedAt: "2026-11-18T07:15:00Z" }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    if (!serverUp) throw new TypeError("Failed to fetch")
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/meal-periods") return ok([{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59" }])
    if (path.startsWith("/menu/today"))
      return ok({ options: [{ id: 701, mealPeriodId: 2, optionDate: "2026-11-18", name: "Live curry", price: 45, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" }], availableExtras: [] })
    if (path.startsWith("/orders/today")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderTill() {
  return render(
    <AuthProvider>
      <PosOrderBuilder
        managementSessionToken={null}
        managementSessionActive={false}
        managementRemainingMs={0}
        requestManagementSession={vi.fn()}
        invalidateManagementSession={vi.fn()}
      />
    </AuthProvider>,
  )
}

describe("the offline menu", () => {
  it("shows today's snapshot, read-only, when the live menu can't load", async () => {
    renderTill()
    expect(await screen.findByText(/Offline copy of today's menu from/)).toBeInTheDocument()
    const stew = (await screen.findByText("Beef stew")).closest("button")!
    expect(stew).toBeDisabled()
    await act(async () => {
      fireEvent.click(stew)
    })
    // Nothing added: the cart is still empty and no builder opened.
    expect(screen.queryByText(/Add to order|Add to Order/)).not.toBeInTheDocument()
    expect(screen.queryByText("Unable to load meal periods.")).not.toBeInTheDocument()
  })

  it("shows the beverages from the snapshot on the Beverages tab", async () => {
    renderTill()
    await screen.findByText(/Offline copy of today's menu/)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Beverages/ }))
    })
    expect((await screen.findByText("Still water 500 ml")).closest("button")).toBeDisabled()
  })

  it("doesn't use yesterday's snapshot: the error, as before", async () => {
    offline = { ...offline, snapshot: parseSnapshot({ ...snapshotBody, tradingDay: "2026-11-17" }) }
    renderTill()
    expect(await screen.findByText(/connection|server|Unable to load/i)).toBeInTheDocument()
    expect(screen.queryByText(/Offline copy/)).not.toBeInTheDocument()
    expect(screen.queryByText("Beef stew")).not.toBeInTheDocument()
  })

  it("doesn't use it with offline turned off", async () => {
    offline = { ...offline, tillStatus: { offlineEnabled: false } as TillStatus }
    renderTill()
    await screen.findByText(/connection|server|Unable to load/i)
    expect(screen.queryByText("Beef stew")).not.toBeInTheDocument()
  })

  it("back online: the live menu again", async () => {
    const view = renderTill()
    expect(await screen.findByText("Beef stew")).toBeInTheDocument()

    online = true
    serverUp = true
    view.rerender(
      <AuthProvider>
        <PosOrderBuilder
          managementSessionToken={null}
          managementSessionActive={false}
          managementRemainingMs={0}
          requestManagementSession={vi.fn()}
          invalidateManagementSession={vi.fn()}
        />
      </AuthProvider>,
    )
    expect(await screen.findByText("Live curry")).toBeInTheDocument()
    expect(screen.queryByText("Beef stew")).not.toBeInTheDocument()
    expect(screen.queryByText(/Offline copy/)).not.toBeInTheDocument()
  })

  it("a live menu is never replaced by the snapshot", async () => {
    online = true
    serverUp = true
    renderTill()
    expect(await screen.findByText("Live curry")).toBeInTheDocument()
    expect(screen.queryByText("Beef stew")).not.toBeInTheDocument()
    expect(screen.queryByText(/Offline copy/)).not.toBeInTheDocument()
  })
})

describe("Today's orders offline", () => {
  it("says Not available offline and asks the server for nothing", async () => {
    renderTill()
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Today's Orders/ }))
    })
    expect(await screen.findByText("Not available offline.")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/orders/today"))).toBe(false)
  })
})
