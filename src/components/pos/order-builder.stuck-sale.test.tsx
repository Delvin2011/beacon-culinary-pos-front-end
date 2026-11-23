// O4 (H): an online sale stuck in "Checking the sale…" when the till goes offline is recorded as an offline sale
// with the same clientOrderId; a card sale asks for the slip first; a discounted one stays pending; going offline
// mid-shift switches the live menu to the sellable snapshot; offline, the cashier can't be changed.
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { OutboxProvider } from "@/contexts/outbox-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import type { OfflineContextValue } from "@/contexts/offline-context"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { clearAutoPrinted } from "@/lib/auto-print-guard"
import { parseGrant, parseSnapshot } from "@/lib/offline/contract"
import { OFFLINE_DB_NAME, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { listOutbox } from "@/lib/offline/outbox"
import type { OfflineSellingState } from "@/lib/offline/selling-state"
import { grantBody } from "@/lib/offline/test-fixtures"
import { PENDING_SALE_KEY, createPendingSale, loadPendingSale, type OfflineDraft } from "@/lib/pending-sale"
import { resetPrintSettingsSnapshot } from "@/lib/print-settings"
import type { TillStatus } from "@/lib/till"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 412, owner: { id: 17, name: "Thandi Mokoena" }, openedAt: "2026-11-18T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))
let online: boolean
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: online, status: online ? "online" : "offline", reason: null, checkNow: () => {} }),
}))
let offline: OfflineContextValue
vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => offline,
}))
let selling: OfflineSellingState
vi.mock("@/hooks/use-offline-selling", () => ({ useOfflineSelling: () => ({ selling, elapsedMs: 0, isOnline: online }) }))

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T06:00:00Z", locked: false },
  idleLockMinutes: 30,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

const snapshotBody = {
  snapshotVersion: "v7",
  generatedAt: "2026-11-18T09:00:00Z",
  tradingDay: "2026-11-18",
  periods: [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", allDay: false }],
  options: [{ id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY", portionsRemaining: 5 }],
  extras: [],
  vatRate: 0.15,
  tenders: ["CASH", "CARD", "ACCOUNT"],
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
let printed: string[] = []

const SELLING: OfflineSellingState = { kind: "selling", warn: false, limits: { maxOfflineHours: 6, warnOfflineHours: 5 } }

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:42:15Z"))
  localStorage.clear()
  sessionStorage.clear()
  clearAutoPrinted()
  resetReceiptSettingsCache()
  resetPrintSettingsSnapshot()
  localStorage.setItem(
    "bar-talk.auth",
    JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", name: "Thandi Mokoena", role: "CASHIER", cashierId: 17 } }),
  )
  await setMeta("offlineSince", "2026-11-18T10:40:00Z")
  online = true
  offline = {
    tillStatus,
    storage: "available",
    grant: parseGrant(grantBody),
    snapshot: parseSnapshot(snapshotBody),
    snapshotReceivedAt: "2026-11-18T09:15:00Z",
    grantRefused: false,
    refresh: () => {},
  }
  selling = { kind: "online" }
  printed = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
      // The sale's outcome never comes back: the connection drops while it's out.
      if (!online || (path === "/orders" && init?.method === "POST")) throw new TypeError("Failed to fetch")
      if (path === "/meal-periods") return json([{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: true }])
      if (path.startsWith("/menu/today"))
        return json({
          options: [
            { id: 801, mealPeriodId: 2, optionDate: "2026-11-18", name: "Beef stew", price: 50, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" },
            { id: 701, mealPeriodId: 2, optionDate: "2026-11-18", name: "Live curry", price: 45, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" },
          ],
          availableExtras: [],
        })
      return json([])
    }),
  )
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.spyOn(window, "print").mockImplementation(() => {
    printed.push(document.querySelector(".print-portal")?.textContent ?? "")
    window.dispatchEvent(new Event("afterprint"))
  })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

const tree = () => (
  <AuthProvider>
    <OutboxProvider>
      <PosOrderBuilder
        managementSessionToken={null}
        managementSessionActive={false}
        managementRemainingMs={0}
        requestManagementSession={vi.fn()}
        invalidateManagementSession={vi.fn()}
      />
    </OutboxProvider>
  </AuthProvider>
)

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

async function goOffline(view: ReturnType<typeof render>) {
  online = false
  selling = SELLING
  await act(async () => {
    view.rerender(tree())
  })
}

// A stuck sale from an earlier page load, as O1 stores it.
function seedPendingSale(draft: OfflineDraft | null, ownerKey = "cashier:17") {
  const sale = createPendingSale(
    "SALE",
    { lines: [{ dailyMealOptionId: 801, quantity: 1, extras: [] }], payments: [] },
    { lines: [{ name: "Beef stew", quantity: 1 }], total: 50 },
    { key: ownerKey, name: ownerKey === "cashier:17" ? "Thandi Mokoena" : "Sipho Dlamini" },
    draft,
  )
  localStorage.setItem(PENDING_SALE_KEY, JSON.stringify({ pending: sale, completedIds: [] }))
  return sale
}

const draftWith = (payment: OfflineDraft["payments"][number]): OfflineDraft => ({
  lines: [{ dailyMealOptionId: 801, name: "Beef stew", unitPrice: 50, quantity: 1, extras: [] }],
  payments: [payment],
  confirmedAt: "2026-11-18T10:38:00.000Z",
})

describe("a sale stuck when the till goes offline", () => {
  it("is recorded offline with the same clientOrderId, then printed with the kitchen ticket marked", async () => {
    const view = render(tree())
    await click(await screen.findByText("Beef stew"))
    await click(screen.getByRole("button", { name: "Add To Order" }))
    await click(screen.getByRole("button", { name: "Charge" }))
    await click(screen.getByRole("button", { name: "Confirm Payment" }))
    expect(await screen.findByText(/Checking the sale/)).toBeInTheDocument()
    const pending = loadPendingSale()!
    expect(pending.offlineDraft).toMatchObject({ lines: [{ name: "Beef stew", unitPrice: 50 }], payments: [{ method: "CASH", amount: 50 }] })

    await goOffline(view)

    expect(await screen.findByText("Offline sale recorded")).toBeInTheDocument()
    const [entry] = await listOutbox()
    expect(entry).toMatchObject({ clientOrderId: pending.clientOrderId, wasPendingOnline: true, soldAt: pending.offlineDraft!.confirmedAt })
    expect(loadPendingSale()).toBeNull()
    expect(screen.queryByText(/Checking the sale/)).not.toBeInTheDocument()

    await waitFor(() => expect(printed).toHaveLength(2))
    expect(printed[1]).toContain("Was pending online: check the kitchen screen before preparing")
  })

  it("a card sale asks for the slip reference; No slip records it without one", async () => {
    const sale = seedPendingSale(draftWith({ method: "CARD", amount: 50 }))
    online = false
    selling = SELLING
    render(tree())

    expect(await screen.findByText("The till is offline. Record this sale as an offline sale.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Record offline sale" })).toBeDisabled()
    expect(await listOutbox()).toEqual([])

    await click(screen.getByRole("button", { name: "No slip" }))
    expect(await screen.findByText("Offline sale recorded")).toBeInTheDocument()
    const [entry] = await listOutbox()
    expect(entry.clientOrderId).toBe(sale.clientOrderId)
    expect(entry.payload.payments).toEqual([{ method: "CARD", amount: 50 }])
  })

  it("a card sale with the slip reference typed in", async () => {
    seedPendingSale(draftWith({ method: "CARD", amount: 50 }))
    online = false
    selling = SELLING
    render(tree())
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("Card slip reference"), { target: { value: "004512" } })
    })
    await click(screen.getByRole("button", { name: "Record offline sale" }))
    await screen.findByText("Offline sale recorded")
    expect((await listOutbox())[0].payload.payments).toEqual([{ method: "CARD", amount: 50, cardReference: "004512" }])
  })

  it("a sale with no offline draft (discounted or complimentary) stays pending", async () => {
    seedPendingSale(null)
    online = false
    selling = SELLING
    render(tree())
    expect(await screen.findByText(/Checking the sale/)).toBeInTheDocument()
    expect(screen.queryByText(/Record this sale as an offline sale/)).not.toBeInTheDocument()
    expect(await listOutbox()).toEqual([])
    expect(loadPendingSale()).not.toBeNull()
  })

  it("isn't converted when the till may not sell offline", async () => {
    seedPendingSale(draftWith({ method: "CASH", amount: 50, amountTendered: 50 }))
    online = false
    selling = { kind: "stopped", reason: "limit", message: "Offline limit reached. Reconnect to keep selling." }
    render(tree())
    expect(await screen.findByText(/Checking the sale/)).toBeInTheDocument()
    expect(await listOutbox()).toEqual([])
  })
})

describe("going offline mid-shift", () => {
  it("switches the live menu to the snapshot's sellable tiles", async () => {
    const view = render(tree())
    expect(await screen.findByText("Live curry")).toBeInTheDocument()
    await goOffline(view)
    expect(await screen.findByText(/Selling offline/)).toBeInTheDocument()
    expect(screen.queryByText("Live curry")).not.toBeInTheDocument()
    expect((await screen.findByText("Beef stew")).closest("button")).toBeEnabled()
  })
})

describe("no change of cashier offline", () => {
  it("disables 'Sign out so … can sign in' with the reason", async () => {
    seedPendingSale(null, "cashier:99")
    online = false
    selling = SELLING
    render(tree())
    const signOut = await screen.findByRole("button", { name: /Sign out so Sipho Dlamini can sign in/ })
    expect(signOut).toBeDisabled()
    expect(screen.getByText("Offline: lock the till instead")).toBeInTheDocument()
  })
})
