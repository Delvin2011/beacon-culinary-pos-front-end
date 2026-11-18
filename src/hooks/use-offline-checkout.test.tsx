// O4: recording an offline sale: numbering, unlockedOffline, the local counts, the account cap, the stops at confirm
// time, and a storage failure (nothing completes).
import "fake-indexeddb/auto"
import { act, renderHook } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SAVE_FAILED_MESSAGE, useOfflineCheckout, type CheckoutLine, type CheckoutPayment } from "@/hooks/use-offline-checkout"
import { parseGrant, parseSnapshot, type OfflineGrant, type OfflineSnapshot } from "@/lib/offline/contract"
import { OFFLINE_DB_NAME, getOfflineSeq, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { listOutbox, type OutboxEntry } from "@/lib/offline/outbox"
import type { OfflineSellingState } from "@/lib/offline/selling-state"
import { grantBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const tillStatus = { registered: true, tillCode: "T1", tillName: "Till 1 (front)", offlineEnabled: true, maxOfflineHours: 6, warnOfflineHours: 5 } as TillStatus

const snapshotBody = {
  snapshotVersion: "v7",
  generatedAt: "2026-11-18T09:00:00Z",
  tradingDay: "2026-11-18",
  periods: [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", allDay: false }],
  options: [
    { id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY", portionsRemaining: 2 },
    { id: 912, name: "Still water 500 ml", station: "NONE", group: "BEVERAGES", periodId: null, price: 20, status: "READY", portionsRemaining: null },
  ],
  extras: [{ id: 3102, periodId: 2, componentName: "Extra beef", priceDelta: 15, bufferRemaining: 1 }],
  vatRate: 0.15,
  tenders: ["CASH", "CARD", "ACCOUNT"],
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
}

let grant: OfflineGrant | null
let snapshot: OfflineSnapshot | null
let user: { cashierId: number; name: string; offline?: boolean }
let selling: OfflineSellingState
let outboxEntries: OutboxEntry[]

vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => ({ grant, snapshot, tillStatus }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user }) }))
vi.mock("@/hooks/use-offline-selling", () => ({ useOfflineSelling: () => ({ selling, elapsedMs: 0, isOnline: false }) }))
vi.mock("@/contexts/outbox-context", () => ({ useOutbox: () => ({ entries: outboxEntries }), notifyOutboxChanged: vi.fn() }))

const stew = (quantity = 1, extraQuantity = 0): CheckoutLine => ({
  dailyMealOptionId: 801,
  name: "Beef stew",
  unitPrice: 50,
  quantity,
  extras: extraQuantity > 0 ? [{ dailyComponentStockId: 3102, name: "Extra beef", extraPrice: 15, quantity: extraQuantity }] : [],
})
const water = (quantity = 1): CheckoutLine => ({ dailyMealOptionId: 912, name: "Still water 500 ml", unitPrice: 20, quantity, extras: [] })
const cash = (amount: number, tendered = amount): CheckoutPayment => ({ method: "CASH", amount, amountTendered: tendered })

function checkout() {
  return renderHook(() => useOfflineCheckout()).result
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:42:15Z"))
  grant = parseGrant(grantBody)
  snapshot = parseSnapshot(snapshotBody)
  user = { cashierId: 17, name: "Thandi Mokoena" }
  selling = { kind: "selling", warn: false, limits: { maxOfflineHours: 6, warnOfflineHours: 5 } }
  outboxEntries = []
  await setMeta("offlineSince", "2026-11-18T10:00:00Z")
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("recording an offline sale", () => {
  it("writes it to the outbox with the grant's numbers and returns the order to print", async () => {
    const result = checkout()
    let outcome: Awaited<ReturnType<typeof result.current.record>> | undefined
    await act(async () => {
      outcome = await result.current.record([stew(1, 1), water(2)], [cash(105, 200)])
    })
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome?.ok) return
    expect(outcome.order).toMatchObject({
      collectionNumber: "T1-3", // the grant's nextOfflineSeq
      receiptNumber: "T1-20261118-0003",
      soldAt: "2026-11-18T10:42:15.000Z",
      recordedOffline: true,
      total: 105,
      vatIncludedAmount: 13.7,
      tillName: "Till 1 (front)",
    })

    const [entry] = await listOutbox()
    expect(entry).toMatchObject({ clientOrderId: outcome.clientOrderId, status: "PENDING", grant: "opaque.grant.string", grantId: "g1", shiftId: 412 })
    expect(entry.payload).toMatchObject({
      shiftId: 412,
      cashierId: 17,
      unlockedOffline: false,
      snapshotVersion: "v7",
      subtotal: 105,
      payments: [{ method: "CASH", amount: 105, amountTendered: 200, changeDue: 95 }],
    })
    expect(entry.payload.lines[0]).toMatchObject({ station: "KITCHEN", lineTotal: 50, extras: [{ lineTotal: 15 }] })
    expect(entry.payload.lines[1]).toMatchObject({ station: "NONE", lineTotal: 40 })
  })

  it("numbers the next sale on, also after a reload", async () => {
    const result = checkout()
    await act(async () => {
      await result.current.record([water()], [cash(20)])
    })
    await resetOfflineDbForTests() // a reload
    let second: Awaited<ReturnType<typeof result.current.record>> | undefined
    await act(async () => {
      second = await result.current.record([water()], [cash(20)])
    })
    expect(second?.ok && second.order.collectionNumber).toBe("T1-4")
    expect(await getOfflineSeq()).toMatchObject({ nextOfflineSeq: 5, tradingDay: "2026-11-18" })
  })

  it("sets unlockedOffline after an offline unlock", async () => {
    user = { cashierId: 17, name: "Thandi Mokoena", offline: true }
    const result = checkout()
    await act(async () => {
      await result.current.record([water()], [cash(20)])
    })
    expect((await listOutbox())[0].payload.unlockedOffline).toBe(true)
  })

  it("records a card sale with its slip reference and an account sale without a PIN", async () => {
    const result = checkout()
    await act(async () => {
      await result.current.record([water()], [{ method: "CARD", amount: 20, cardReference: "004512" }])
      await result.current.record([water()], [{ method: "ACCOUNT", amount: 20, accountId: 5 }])
    })
    const [card, account] = await listOutbox()
    expect(card.payload.payments).toEqual([{ method: "CARD", amount: 20, cardReference: "004512" }])
    expect(account.payload.payments).toEqual([{ method: "ACCOUNT", amount: 20, accountId: 5 }])
    expect(account.print.accountNames).toEqual({ 5: "Finance Dept" })
  })
})

describe("what is refused (nothing is written)", () => {
  async function refused(lines: CheckoutLine[], payments: CheckoutPayment[]) {
    const result = checkout()
    let outcome: Awaited<ReturnType<typeof result.current.record>> | undefined
    await act(async () => {
      outcome = await result.current.record(lines, payments)
    })
    expect(outcome?.ok).toBe(false)
    expect(await listOutbox()).toEqual([])
    return outcome && !outcome.ok ? outcome.message : ""
  }

  it("more than the local portion count", async () => {
    expect(await refused([stew(3)], [cash(150)])).toBe("Only 2 Beef stew left.")
  })

  it("an item the outbox has already sold out", async () => {
    outboxEntries = [
      {
        status: "PENDING",
        tradingDay: "2026-11-18",
        payload: { lines: [{ dailyMealOptionId: 801, quantity: 2, extras: [] }] },
      } as unknown as OutboxEntry,
    ]
    expect(await refused([stew(1)], [cash(50)])).toBe("Beef stew is sold out.")
  })

  it("more extras than the buffer", async () => {
    expect(await refused([stew(1, 2)], [cash(80)])).toBe("Only 1 Extra beef left.")
  })

  it("an account charge over the cap, with the cap from the grant", async () => {
    expect(await refused([water(8)], [{ method: "ACCOUNT", amount: 160, accountId: 5 }])).toBe("Account limit for offline sales reached (R150.00).")
  })

  it("a card payment without the slip reference", async () => {
    expect(await refused([water()], [{ method: "CARD", amount: 20, cardReference: "" }])).toBe("Enter the card slip reference.")
  })

  it("cash that doesn't cover the amount", async () => {
    expect(await refused([water()], [cash(20, 10)])).toBe("The cash tendered must cover the amount.")
  })

  it("past maxOfflineHours, at the moment of confirming", async () => {
    await setMeta("offlineSince", "2026-11-18T04:00:00Z")
    expect(await refused([water()], [cash(20)])).toBe("Offline limit reached. Reconnect to keep selling.")
  })

  it("after the grant's expiresAt", async () => {
    grant = parseGrant({ ...grantBody, expiresAt: "2026-11-18T10:42:00Z" })
    expect(await refused([water()], [cash(20)])).toBe("This till's offline permission has expired. Reconnect to keep selling.")
  })

  it("after midnight in Johannesburg", async () => {
    vi.setSystemTime(new Date("2026-11-18T22:00:01Z"))
    await setMeta("offlineSince", "2026-11-18T21:00:00Z")
    expect(await refused([water()], [cash(20)])).toBe(
      "A new trading day has started and the offline menu is for the previous day. Reconnect to keep selling.",
    )
  })

  it("when the till isn't allowed to sell offline", async () => {
    selling = { kind: "not-ready", reason: { kind: "no-grant" } }
    expect(await refused([water()], [cash(20)])).toBe("This till can't sell offline right now.")
  })
})

describe("storage failure", () => {
  it("doesn't complete the sale", async () => {
    await resetOfflineDbForTests()
    vi.stubGlobal("indexedDB", undefined)
    const result = checkout()
    let outcome: Awaited<ReturnType<typeof result.current.record>> | undefined
    await act(async () => {
      outcome = await result.current.record([water()], [cash(20)])
    })
    expect(outcome).toEqual({ ok: false, message: SAVE_FAILED_MESSAGE })
  })
})

describe("local counts", () => {
  it("are the snapshot's less what the outbox sold; null means no limit", () => {
    outboxEntries = [
      {
        status: "PENDING",
        tradingDay: "2026-11-18",
        payload: { lines: [{ dailyMealOptionId: 801, quantity: 1, extras: [{ dailyComponentStockId: 3102, quantity: 1 }] }] },
      } as unknown as OutboxEntry,
    ]
    const result = checkout()
    expect(result.current.optionRemaining(801, 2)).toBe(1)
    expect(result.current.extraRemaining(3102, 1)).toBe(0)
    expect(result.current.optionRemaining(912, null)).toBeNull()
    expect(result.current.accounts).toEqual([{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }])
    expect(result.current.accountCap).toBe(150)
  })

  it("has no accounts when account sales are off", () => {
    grant = parseGrant({ ...grantBody, accountsEnabled: false })
    const result = checkout()
    expect(result.current.accountsEnabled).toBe(false)
    expect(result.current.accounts).toEqual([])
  })
})
