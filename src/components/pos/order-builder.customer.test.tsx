// T1-3: the POS and the customer's answers, on a till that is offline-ready (grant, snapshot, selling allowed).
//  - CUSTOMER_SUSPENDED never starts offline selling, online or after an outage: the snapshot's tiles stay unsellable.
//  - CUSTOMER_UNAVAILABLE is an outage: offline selling as before (O4).
//  - A suspension arriving with a cart keeps the cart; nothing in the outbox is touched.
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { OutboxProvider } from "@/contexts/outbox-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import type { OfflineContextValue } from "@/contexts/offline-context"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { clearAutoPrinted } from "@/lib/auto-print-guard"
import { noteCustomerAnswer } from "@/lib/customer-status"
import { parseGrant, parseSnapshot } from "@/lib/offline/contract"
import { OFFLINE_DB_NAME, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { listOutbox } from "@/lib/offline/outbox"
import type { OfflineSellingState } from "@/lib/offline/selling-state"
import { grantBody } from "@/lib/offline/test-fixtures"
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

// The connection as the ConnectionProvider would give it for each case (its own tests cover how it gets there).
type Connection = { isOnline: boolean; status: "online" | "offline"; reason: "server-down" | "no-connection" | null; suspended: boolean; checkNow: () => void }
let connection: Connection
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => connection }))

let offline: OfflineContextValue
vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => offline,
}))
const selling: OfflineSellingState = { kind: "selling", warn: false, limits: { maxOfflineHours: 6, warnOfflineHours: 5 } }
vi.mock("@/hooks/use-offline-selling", () => ({ useOfflineSelling: () => ({ selling, elapsedMs: 0, isOnline: connection.isOnline }) }))

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
  options: [{ id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY", portionsRemaining: 2 }],
  extras: [],
  vatRate: 0.15,
  receiptSettings: { receiptTitle: null, businessName: "Canteen", addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false },
  tenders: ["CASH", "CARD", "ACCOUNT"],
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const SUSPENDED = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
const UNAVAILABLE = () => json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" })
let answer: () => Response
const fetchMock = vi.fn<typeof fetch>()

const online: Connection = { isOnline: true, status: "online", reason: null, suspended: false, checkNow: () => {} }
const outage: Connection = { isOnline: false, status: "offline", reason: "server-down", suspended: false, checkNow: () => {} }

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
  await setMeta("offlineSince", "2026-11-18T10:00:00Z")
  offline = {
    tillStatus,
    storage: "available",
    grant: parseGrant(grantBody),
    snapshot: parseSnapshot(snapshotBody),
    snapshotReceivedAt: "2026-11-18T09:15:00Z",
    grantRefused: false,
    refresh: () => {},
  }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => answer())
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.spyOn(window, "print").mockImplementation(() => window.dispatchEvent(new Event("afterprint")))
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

async function stewTile(): Promise<HTMLElement> {
  await screen.findAllByText("Beef stew")
  return screen.getAllByRole("button").find((button) => button.textContent?.startsWith("Beef stew"))!
}

const SELLING_OFFLINE = /Selling offline: discounts, complimentary, voids and refunds need the connection/

describe("CUSTOMER_SUSPENDED", () => {
  it("online: never sells offline, and the snapshot's tiles can't be sold", async () => {
    answer = SUSPENDED
    connection = { ...online, suspended: true }
    await act(async () => {
      await noteCustomerAnswer(SUSPENDED())
    })
    render(tree())
    expect(await stewTile()).toBeDisabled()
    expect(screen.queryByText(SELLING_OFFLINE)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Confirm offline sale" })).not.toBeInTheDocument()
  })

  it("over an outage: still never sells offline", async () => {
    answer = SUSPENDED
    connection = { ...outage, suspended: true }
    await act(async () => {
      await noteCustomerAnswer(SUSPENDED())
    })
    render(tree())
    expect(await stewTile()).toBeDisabled()
    expect(screen.queryByText(SELLING_OFFLINE)).not.toBeInTheDocument()
    // Nothing was sent: apiFetch refuses every call while suspended.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("arriving with a cart keeps the cart and the outbox; selling offline stops until it ends", async () => {
    answer = UNAVAILABLE
    connection = outage
    const view = render(tree())
    expect(await screen.findByText(SELLING_OFFLINE)).toBeInTheDocument()
    await click(await stewTile())
    await click(screen.getByRole("button", { name: "Add To Order" }))
    expect(screen.getAllByText("Beef stew").length).toBeGreaterThan(1)
    const outboxBefore = await listOutbox()

    // The customer is suspended.
    connection = { ...outage, suspended: true }
    await act(async () => {
      await noteCustomerAnswer(SUSPENDED())
    })
    view.rerender(tree())
    expect(screen.queryByText(SELLING_OFFLINE)).not.toBeInTheDocument()
    expect(screen.getAllByText("Beef stew").length).toBeGreaterThan(1)
    expect(await listOutbox()).toEqual(outboxBefore)

    // It ends (an outage again): selling offline comes back, the cart as it was.
    connection = outage
    await act(async () => {
      await noteCustomerAnswer(UNAVAILABLE())
    })
    view.rerender(tree())
    expect(await screen.findByText(SELLING_OFFLINE)).toBeInTheDocument()
    expect(screen.getAllByText("Beef stew").length).toBeGreaterThan(1)
  })
})

describe("CUSTOMER_UNAVAILABLE", () => {
  it("is an outage: the offline-ready till sells offline", async () => {
    answer = UNAVAILABLE
    connection = outage
    render(tree())
    expect(await screen.findByText(SELLING_OFFLINE)).toBeInTheDocument()
    await click(await stewTile())
    await click(screen.getByRole("button", { name: "Add To Order" }))
    await click(screen.getByRole("button", { name: "Charge" }))
    await click(screen.getByRole("button", { name: "Confirm offline sale" }))
    expect(await screen.findByText("Offline sale recorded")).toBeInTheDocument()
    expect((await listOutbox()).map((entry) => entry.status)).toEqual(["PENDING"])
  })
})
