// O4: selling offline through the order builder: sellable tiles with local counts, cash / card / account sales
// recorded on the till before the completion screen and the print, online-only actions disabled, refusals keeping
// the cart, and the read-only copy when the till may not sell.
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: false, status: "offline", reason: null, checkNow: () => {} }),
}))

let offline: OfflineContextValue
vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => offline,
}))
let selling: OfflineSellingState
vi.mock("@/hooks/use-offline-selling", () => ({ useOfflineSelling: () => ({ selling, elapsedMs: 0, isOnline: false }) }))

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

const requestManagementSession = vi.fn()
let printed: string[] = []

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
  selling = { kind: "selling", warn: false, limits: { maxOfflineHours: 6, warnOfflineHours: 5 } }
  requestManagementSession.mockReset()
  printed = []
  // Offline: every request fails.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new TypeError("Failed to fetch")
  }))
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

function renderTill() {
  return render(
    <AuthProvider>
      <OutboxProvider>
        <PosOrderBuilder
          managementSessionToken={null}
          managementSessionActive={false}
          managementRemainingMs={0}
          requestManagementSession={requestManagementSession}
          invalidateManagementSession={vi.fn()}
        />
      </OutboxProvider>
    </AuthProvider>,
  )
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

// The menu tile (the cart lists the name too).
async function stewTile(): Promise<HTMLElement> {
  await screen.findAllByText("Beef stew")
  return screen.getAllByRole("button").find((button) => button.textContent?.startsWith("Beef stew"))!
}

async function addStew() {
  const tile = await stewTile()
  expect(tile).toBeEnabled()
  await click(tile)
  await click(screen.getByRole("button", { name: "Add To Order" }))
}

async function charge() {
  await click(screen.getByRole("button", { name: "Charge" }))
}

describe("selling offline", () => {
  it("records a cash sale on the till, then shows the collection number and prints", async () => {
    renderTill()
    expect(await screen.findByText(/Selling offline: discounts, complimentary, voids and refunds need the connection/)).toBeInTheDocument()
    await addStew()
    await charge()
    await click(screen.getByRole("button", { name: "Confirm offline sale" }))

    expect(await screen.findByText("Offline sale recorded")).toBeInTheDocument()
    expect(screen.getByTestId("offline-collection-number")).toHaveTextContent("T1-3")
    expect(screen.getAllByText("Receipt T1-20261118-0003").length).toBeGreaterThan(0)

    const [entry] = await listOutbox()
    expect(entry).toMatchObject({ status: "PENDING", shiftId: 412 })
    expect(entry.payload).toMatchObject({ collectionNumber: "T1-3", total: 50, payments: [{ method: "CASH", amount: 50 }] })

    // The receipt (with the snapshot's header, the receipt-settings fetch having failed), then the kitchen ticket.
    await waitFor(() => expect(printed).toHaveLength(2))
    expect(printed[0]).toContain("Canteen")
    expect(printed[0]).toContain("Offline sale")
    expect(printed[0]).toContain("T1-3")
    expect(printed[1]).toContain("1 x Beef stew")

    // Next customer: the tile counts the sale (2 in the snapshot, 1 sold).
    await click(screen.getByRole("button", { name: "Next Customer" }))
    await waitFor(async () => expect(within(await stewTile()).getByText(/1 left/)).toBeInTheDocument())
  })

  it("shows sold out when the local count reaches 0", async () => {
    renderTill()
    await addStew()
    await addStew()
    const tile = await stewTile()
    expect(within(tile).getByText("Sold out")).toBeInTheDocument()
    expect(tile).toBeDisabled()
  })

  it("a card sale needs the slip reference", async () => {
    renderTill()
    await addStew()
    await charge()
    await click(screen.getByRole("button", { name: "Card" }))
    const confirm = screen.getByRole("button", { name: "Confirm offline sale" })
    expect(confirm).toBeDisabled()

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Card slip reference/), { target: { value: "004512" } })
    })
    expect(confirm).toBeEnabled()
    await click(confirm)
    await screen.findByText("Offline sale recorded")
    expect((await listOutbox())[0].payload.payments).toEqual([{ method: "CARD", amount: 50, cardReference: "004512" }])
  })

  it("an account sale uses the snapshot's accounts and needs no manager PIN", async () => {
    renderTill()
    await addStew()
    await charge()
    await click(screen.getByRole("button", { name: "Account" }))
    await click(screen.getByRole("button", { name: /Finance Dept/ }))
    await click(screen.getByRole("button", { name: "Confirm offline sale" }))

    await screen.findByText("Offline sale recorded")
    expect(requestManagementSession).not.toHaveBeenCalled()
    expect((await listOutbox())[0].payload.payments).toEqual([{ method: "ACCOUNT", amount: 50, accountId: 5 }])
  })

  it("a refusal says why and keeps the cart", async () => {
    offline = { ...offline, grant: parseGrant({ ...grantBody, accountCap: 40 }) }
    renderTill()
    await addStew()
    await charge()
    await click(screen.getByRole("button", { name: "Account" }))
    await click(screen.getByRole("button", { name: /Finance Dept/ }))
    await click(screen.getByRole("button", { name: "Confirm offline sale" }))

    expect(await screen.findByText("Account limit for offline sales reached (R40.00).")).toBeInTheDocument()
    expect(screen.queryByText("Offline sale recorded")).not.toBeInTheDocument()
    expect(await listOutbox()).toEqual([])
    expect(screen.getAllByText("Beef stew").length).toBeGreaterThan(1) // tile and cart line
  })

  it("leaves out Account when offline account sales are off", async () => {
    offline = { ...offline, grant: parseGrant({ ...grantBody, accountsEnabled: false }) }
    renderTill()
    await addStew()
    await charge()
    expect(screen.getByRole("button", { name: "Account" })).toBeDisabled()
  })
})

describe("online-only actions offline", () => {
  it("Complimentary, Add Discount and Complimentary… are disabled, with the reason", async () => {
    renderTill()
    await addStew()
    const complimentary = screen.getByRole("button", { name: /^Complimentary/ })
    expect(complimentary).toBeDisabled()
    expect(complimentary).toHaveTextContent("Not available offline")

    await charge()
    expect(screen.getByRole("button", { name: /Add Discount/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Add Discount/ })).toHaveTextContent("Not available offline")
    expect(screen.getByRole("button", { name: /Complimentary…/ })).toBeDisabled()
  })
})

describe("when the till may not sell offline", () => {
  it("the copy stays read-only and Confirm waits for the connection", async () => {
    selling = { kind: "stopped", reason: "limit", message: "Offline limit reached. Reconnect to keep selling." }
    renderTill()
    expect(await screen.findByText(/Read-only until the connection is back/)).toBeInTheDocument()
    expect((await screen.findByText("Beef stew")).closest("button")).toBeDisabled()
  })
})
