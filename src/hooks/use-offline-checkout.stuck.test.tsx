// O4 (H): recording a stuck online sale offline: the same clientOrderId, its confirm time, "was pending online", no
// count or cap refusal (the money was taken), a card sale without a slip, and a sale already in the outbox.
import "fake-indexeddb/auto"
import { act, renderHook } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useOfflineCheckout, type CheckoutLine, type CheckoutPayment, type RecordOptions } from "@/hooks/use-offline-checkout"
import { parseGrant, parseSnapshot, type OfflineGrant, type OfflineSnapshot } from "@/lib/offline/contract"
import { OFFLINE_DB_NAME, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { listOutbox } from "@/lib/offline/outbox"
import type { OfflineSellingState } from "@/lib/offline/selling-state"
import { grantBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const tillStatus = { registered: true, tillCode: "T1", tillName: "Till 1", offlineEnabled: true, maxOfflineHours: 6, warnOfflineHours: 5 } as TillStatus

const snapshotBody = {
  snapshotVersion: "v7",
  generatedAt: "2026-11-18T09:00:00Z",
  tradingDay: "2026-11-18",
  periods: [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", allDay: false }],
  options: [{ id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY", portionsRemaining: 1 }],
  extras: [],
  vatRate: 0.15,
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
}

let grant: OfflineGrant | null
let snapshot: OfflineSnapshot | null
let selling: OfflineSellingState

vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => ({ grant, snapshot, tillStatus }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { cashierId: 17, name: "Thandi" } }) }))
vi.mock("@/hooks/use-offline-selling", () => ({ useOfflineSelling: () => ({ selling, elapsedMs: 0, isOnline: false }) }))
vi.mock("@/contexts/outbox-context", () => ({ useOutbox: () => ({ entries: [] }), notifyOutboxChanged: vi.fn() }))

const stews = (quantity: number): CheckoutLine[] => [{ dailyMealOptionId: 801, name: "Beef stew", unitPrice: 50, quantity, extras: [] }]
const stuck = (overrides: Partial<NonNullable<RecordOptions["stuck"]>> = {}): RecordOptions => ({
  stuck: { clientOrderId: "online-sale-1", soldAt: "2026-11-18T10:30:00.000Z", allowMissingCardReference: false, ...overrides },
})

async function record(lines: CheckoutLine[], payments: CheckoutPayment[], options: RecordOptions) {
  const { result } = renderHook(() => useOfflineCheckout())
  let outcome: Awaited<ReturnType<typeof result.current.record>> | undefined
  await act(async () => {
    outcome = await result.current.record(lines, payments, options)
  })
  return outcome!
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:42:15Z"))
  grant = parseGrant(grantBody)
  snapshot = parseSnapshot(snapshotBody)
  selling = { kind: "selling", warn: false, limits: { maxOfflineHours: 6, warnOfflineHours: 5 } }
  await setMeta("offlineSince", "2026-11-18T10:35:00Z")
})

afterEach(async () => {
  vi.useRealTimers()
  await resetOfflineDbForTests()
})

describe("recording a stuck online sale", () => {
  it("keeps its clientOrderId and confirm time, and is marked as pending online", async () => {
    const outcome = await record(stews(1), [{ method: "CASH", amount: 50, amountTendered: 50 }], stuck())
    expect(outcome).toMatchObject({ ok: true, clientOrderId: "online-sale-1" })
    expect(outcome.ok && outcome.alreadyRecorded).toBeFalsy()
    expect(outcome.ok && outcome.order).toMatchObject({ wasPendingOnline: true, soldAt: "2026-11-18T10:30:00.000Z", collectionNumber: "T1-3" })

    const [entry] = await listOutbox()
    expect(entry).toMatchObject({ clientOrderId: "online-sale-1", wasPendingOnline: true, soldAt: "2026-11-18T10:30:00.000Z" })
    expect(entry.payload).toMatchObject({ clientOrderId: "online-sale-1", soldAt: "2026-11-18T10:30:00.000Z", offlineSeq: 3 })
  })

  it("isn't refused by the local count or the account cap: the sale already happened", async () => {
    const outcome = await record(stews(3), [{ method: "ACCOUNT", amount: 150, accountId: 5 }], stuck())
    expect(outcome.ok).toBe(true)
    const outcome2 = await record(stews(4), [{ method: "ACCOUNT", amount: 200, accountId: 5 }], stuck({ clientOrderId: "online-sale-2" }))
    expect(outcome2.ok).toBe(true)
    expect(await listOutbox()).toHaveLength(2)
  })

  it("still counts its account charge against the cap for later offline sales", async () => {
    expect((await record(stews(3), [{ method: "ACCOUNT", amount: 150, accountId: 5 }], stuck())).ok).toBe(true)
    const later = await record(stews(1), [{ method: "ACCOUNT", amount: 50, accountId: 5 }], {})
    expect(later).toEqual({ ok: false, message: "Account limit for offline sales reached (R150.00)." })
  })

  it("records a card sale with the slip reference, or without one when there's no slip", async () => {
    await record(stews(1), [{ method: "CARD", amount: 50, cardReference: "004512" }], stuck())
    await record(stews(1), [{ method: "CARD", amount: 50, cardReference: null }], stuck({ clientOrderId: "online-sale-2", allowMissingCardReference: true }))
    const [withSlip, noSlip] = await listOutbox()
    expect(withSlip.payload.payments).toEqual([{ method: "CARD", amount: 50, cardReference: "004512" }])
    expect(noSlip.payload.payments).toEqual([{ method: "CARD", amount: 50 }])
  })

  it("a sale already in the outbox is only reported, not written or numbered again", async () => {
    await record(stews(1), [{ method: "CASH", amount: 50, amountTendered: 50 }], stuck())
    const again = await record(stews(1), [{ method: "CASH", amount: 50, amountTendered: 50 }], stuck())
    expect(again).toMatchObject({ ok: true, alreadyRecorded: true, clientOrderId: "online-sale-1" })
    expect(again.ok && again.order.collectionNumber).toBe("T1-3")
    expect(await listOutbox()).toHaveLength(1)
  })

  it("isn't recorded when the till may not sell offline: it stays pending", async () => {
    selling = { kind: "stopped", reason: "limit", message: "Offline limit reached. Reconnect to keep selling." }
    const outcome = await record(stews(1), [{ method: "CASH", amount: 50, amountTendered: 50 }], stuck())
    expect(outcome.ok).toBe(false)
    expect(await listOutbox()).toEqual([])
  })
})
