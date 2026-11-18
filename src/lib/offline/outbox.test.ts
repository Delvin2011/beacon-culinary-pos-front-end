// O4: the outbox (one transaction per sale, nothing lost, counts worked out from it).
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OFFLINE_DB_NAME, getOfflineSeq, putOfflineSeq, resetOfflineDbForTests, wipeAll } from "@/lib/offline/db"
import { buildOfflineSale, type OfflineCartLine, type OfflinePaymentDraft } from "@/lib/offline/offline-sale"
import {
  SYNCED_KEPT_MS,
  accountChargedCents,
  getOutboxEntry,
  isWaiting,
  listOutbox,
  markHandedToSupport,
  markRejected,
  markSynced,
  pendingSummary,
  purgeOldSynced,
  recordOfflineSale,
  remainingAfter,
  soldSinceSnapshot,
  waitingForShift,
  type NewOutboxEntry,
  type OutboxEntry,
  type SyncedResult,
} from "@/lib/offline/outbox"

const stew: OfflineCartLine = {
  dailyMealOptionId: 801,
  name: "Beef stew",
  station: "KITCHEN",
  unitPriceCents: 5000,
  quantity: 1,
  extras: [{ dailyComponentStockId: 3102, name: "Extra beef", priceDeltaCents: 1500, quantity: 1 }],
}

let idCounter = 0

function newEntry(
  options: {
    seq?: number
    grantId?: string
    shiftId?: number
    soldAt?: string
    tradingDay?: string
    lines?: OfflineCartLine[]
    payments?: OfflinePaymentDraft[]
  } = {},
): NewOutboxEntry {
  const seq = options.seq ?? 1
  const grantId = options.grantId ?? "g1"
  const tradingDay = options.tradingDay ?? "2026-11-18"
  const soldAt = options.soldAt ?? `2026-11-18T10:${String(10 + seq).padStart(2, "0")}:00.000Z`
  const lines = options.lines ?? [stew]
  const total = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity + l.extras.reduce((s, e) => s + e.priceDeltaCents * e.quantity, 0), 0)
  const result = buildOfflineSale({
    clientOrderId: `sale-${++idCounter}`,
    grant: { grantId, shiftId: options.shiftId ?? 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay,
    offlineSeq: seq,
    soldAt,
    unlockedOffline: false,
    snapshotVersion: "v1",
    vatRate: 0.15,
    lines,
    payments: options.payments ?? [{ method: "CASH", amountCents: total, tenderedCents: total }],
    rules: { accountsEnabled: true },
  })
  if (!result.ok) throw new Error(result.message)
  return {
    clientOrderId: result.sale.clientOrderId,
    payload: result.sale,
    grant: `signed.${grantId}`,
    grantId,
    shiftId: result.sale.shiftId,
    tradingDay,
    soldAt,
    recordedAt: soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: "Till 1", cashierName: "Thandi Mokoena", accountNames: {} },
  }
}

const created: SyncedResult = {
  result: "CREATED",
  orderId: 9301,
  orderNumber: 58,
  receiptNumber: "T1-20261118-0001",
  collectionNumber: "T1-1",
  exceptions: [],
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("recordOfflineSale", () => {
  it("writes the sale as PENDING and moves the number counter on, together", async () => {
    const entry = newEntry({ seq: 7 })
    expect(await recordOfflineSale(entry, null)).toEqual({ kind: "recorded" })

    const stored = await getOutboxEntry(entry.clientOrderId)
    expect(stored).toMatchObject({ status: "PENDING", syncedAt: null, result: null, handedToSupport: null, grant: "signed.g1" })
    expect(stored?.payload).toEqual(entry.payload)
    expect(await getOfflineSeq()).toEqual({ nextOfflineSeq: 8, tradingDay: "2026-11-18", shiftId: 412 })
  })

  it("survives a reload", async () => {
    const entry = newEntry()
    await recordOfflineSale(entry, null)
    await resetOfflineDbForTests() // the page goes away; the database stays
    expect((await listOutbox()).map((e) => e.clientOrderId)).toEqual([entry.clientOrderId])
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(2)
  })

  it("never writes the same clientOrderId twice", async () => {
    const entry = newEntry({ seq: 1 })
    await recordOfflineSale(entry, null)
    expect(await recordOfflineSale({ ...entry, payload: { ...entry.payload, offlineSeq: 2 } }, null)).toEqual({ kind: "exists" })
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(2)
  })

  it("refuses a number another sale already took, and writes nothing", async () => {
    await putOfflineSeq({ nextOfflineSeq: 5, tradingDay: "2026-11-18", shiftId: 412 })
    const entry = newEntry({ seq: 3 })
    expect(await recordOfflineSale(entry, null)).toEqual({ kind: "seq-taken", next: 5 })
    expect(await listOutbox()).toEqual([])
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(5)
  })

  it("ignores the counter of another trading day", async () => {
    await putOfflineSeq({ nextOfflineSeq: 40, tradingDay: "2026-11-17", shiftId: 400 })
    expect(await recordOfflineSale(newEntry({ seq: 1 }), null)).toEqual({ kind: "recorded" })
    expect(await getOfflineSeq()).toEqual({ nextOfflineSeq: 2, tradingDay: "2026-11-18", shiftId: 412 })
  })

  it("refuses an account charge over the cap for this grant, and writes nothing", async () => {
    const water: OfflineCartLine = { dailyMealOptionId: 912, name: "Water", station: "NONE", unitPriceCents: 20000, quantity: 1, extras: [] }
    const account = (cents: number): OfflinePaymentDraft[] => [{ method: "ACCOUNT", amountCents: cents, accountId: 55 }]
    expect(await recordOfflineSale(newEntry({ seq: 1, lines: [water], payments: account(20000) }), 50000)).toEqual({ kind: "recorded" })
    expect(await recordOfflineSale(newEntry({ seq: 2, lines: [water], payments: account(20000) }), 50000)).toEqual({ kind: "recorded" })

    const third = newEntry({ seq: 3, lines: [water], payments: account(20000) })
    expect(await recordOfflineSale(third, 50000)).toEqual({ kind: "over-cap", message: "Account limit for offline sales reached (R500.00)." })
    expect(await getOutboxEntry(third.clientOrderId)).toBeNull()
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(3)

    // Another grant has its own allowance.
    expect(await recordOfflineSale(newEntry({ seq: 3, grantId: "g2", lines: [water], payments: account(20000) }), 50000)).toEqual({ kind: "recorded" })
  })

  it("reports a failure, and records nothing, when storage is unavailable", async () => {
    await resetOfflineDbForTests()
    vi.stubGlobal("indexedDB", undefined)
    expect(await recordOfflineSale(newEntry(), null)).toEqual({ kind: "failed" })
  })
})

describe("the server's answers", () => {
  it("marks a sale SYNCED with the server's result, payload unchanged", async () => {
    const entry = newEntry()
    await recordOfflineSale(entry, null)
    expect(await markSynced(entry.clientOrderId, created, "2026-11-18T13:05:01.000Z")).toBe(true)
    const stored = await getOutboxEntry(entry.clientOrderId)
    expect(stored).toMatchObject({ status: "SYNCED", result: created, syncedAt: "2026-11-18T13:05:01.000Z" })
    expect(stored?.payload).toEqual(entry.payload)
  })

  it("keeps INVALID and REFUSED with the server's error", async () => {
    const a = newEntry({ seq: 1 })
    const b = newEntry({ seq: 2 })
    await recordOfflineSale(a, null)
    await recordOfflineSale(b, null)
    await markRejected(a.clientOrderId, "INVALID", "clientOrderId is required.", null)
    await markRejected(b.clientOrderId, "REFUSED", "The grant for this sale isn't valid.", "GRANT_INVALID")
    expect(await getOutboxEntry(a.clientOrderId)).toMatchObject({ status: "INVALID", error: "clientOrderId is required." })
    expect(await getOutboxEntry(b.clientOrderId)).toMatchObject({ status: "REFUSED", code: "GRANT_INVALID" })
  })

  it("never moves a SYNCED sale back", async () => {
    const entry = newEntry()
    await recordOfflineSale(entry, null)
    await markSynced(entry.clientOrderId, created, "2026-11-18T13:05:01.000Z")
    expect(await markRejected(entry.clientOrderId, "INVALID", "x", null)).toBe(false)
    expect((await getOutboxEntry(entry.clientOrderId))?.status).toBe("SYNCED")
  })

  it("hands only INVALID or REFUSED sales to support, keeping them", async () => {
    const pending = newEntry({ seq: 1 })
    const invalid = newEntry({ seq: 2 })
    await recordOfflineSale(pending, null)
    await recordOfflineSale(invalid, null)
    await markRejected(invalid.clientOrderId, "INVALID", "bad", null)
    const note = { at: "2026-11-18T14:00:00.000Z", by: "Admin User", reason: "Emailed to support" }

    expect(await markHandedToSupport(pending.clientOrderId, note)).toBe(false)
    expect(await markHandedToSupport(invalid.clientOrderId, note)).toBe(true)
    expect(await getOutboxEntry(invalid.clientOrderId)).toMatchObject({ status: "INVALID", handedToSupport: note })
  })
})

describe("purgeOldSynced", () => {
  it("deletes only SYNCED entries older than 7 days; unsynced ones stay however old", async () => {
    const now = Date.parse("2026-11-26T12:00:00.000Z")
    const old = newEntry({ seq: 1 })
    const recent = newEntry({ seq: 2 })
    const oldPending = newEntry({ seq: 3 })
    const oldInvalid = newEntry({ seq: 4 })
    for (const entry of [old, recent, oldPending, oldInvalid]) await recordOfflineSale(entry, null)
    await markSynced(old.clientOrderId, created, new Date(now - SYNCED_KEPT_MS - 1).toISOString())
    await markSynced(recent.clientOrderId, created, new Date(now - SYNCED_KEPT_MS + 60_000).toISOString())
    await markRejected(oldInvalid.clientOrderId, "INVALID", "bad", null)

    expect(await purgeOldSynced(now)).toBe(1)
    expect((await listOutbox()).map((e) => e.clientOrderId)).toEqual([recent.clientOrderId, oldPending.clientOrderId, oldInvalid.clientOrderId])
  })
})

describe("worked out from the outbox", () => {
  const entry = (overrides: Partial<OutboxEntry> & { seq?: number; lines?: OfflineCartLine[]; payments?: OfflinePaymentDraft[]; grantId?: string; shiftId?: number; tradingDay?: string; soldAt?: string } = {}): OutboxEntry => {
    const { seq, lines, payments, grantId, shiftId, tradingDay, soldAt, ...rest } = overrides
    return {
      ...newEntry({ seq, lines, payments, grantId, shiftId, tradingDay, soldAt }),
      status: "PENDING",
      syncedAt: null,
      result: null,
      error: null,
      code: null,
      handedToSupport: null,
      ...rest,
    }
  }

  it("lists the oldest sale first", async () => {
    const late = newEntry({ seq: 2, soldAt: "2026-11-18T11:00:00.000Z" })
    const early = newEntry({ seq: 1, soldAt: "2026-11-18T09:00:00.000Z" })
    await recordOfflineSale(early, null)
    await putOfflineSeq({ nextOfflineSeq: 2, tradingDay: "2026-11-18", shiftId: 412 })
    await recordOfflineSale(late, null)
    expect((await listOutbox()).map((e) => e.soldAt)).toEqual(["2026-11-18T09:00:00.000Z", "2026-11-18T11:00:00.000Z"])
  })

  it("counts what the snapshot doesn't include yet", () => {
    const snapshot = { tradingDay: "2026-11-18", generatedAt: "2026-11-18T12:00:00.000Z" }
    const two = { ...stew, quantity: 2, extras: [{ ...stew.extras[0], quantity: 3 }] }
    const entries = [
      entry({ seq: 1 }), // pending: counted
      entry({ seq: 2, lines: [two] }), // pending: counted
      entry({ seq: 3, status: "SYNCED", syncedAt: "2026-11-18T11:00:00.000Z" }), // in the snapshot already
      entry({ seq: 4, status: "SYNCED", syncedAt: "2026-11-18T12:30:00.000Z" }), // synced after it: counted
      entry({ seq: 5, status: "INVALID" }), // never reached the server: counted
      entry({ seq: 6, tradingDay: "2026-11-17" }), // another day
    ]
    const sold = soldSinceSnapshot(entries, snapshot)
    expect(sold.options.get(801)).toBe(5)
    expect(sold.extras.get(3102)).toBe(6)
  })

  it("never goes below 0, and null means no limit", () => {
    expect(remainingAfter(12, 5)).toBe(7)
    expect(remainingAfter(2, 5)).toBe(0)
    expect(remainingAfter(null, 50)).toBeNull()
  })

  it("adds up an account's charges under one grant, whatever their sync state", () => {
    const water: OfflineCartLine = { dailyMealOptionId: 912, name: "Water", station: "NONE", unitPriceCents: 3333, quantity: 1, extras: [] }
    const account = (accountId: number): OfflinePaymentDraft[] => [{ method: "ACCOUNT", amountCents: 3333, accountId }]
    const entries = [
      entry({ seq: 1, lines: [water], payments: account(55) }),
      entry({ seq: 2, lines: [water], payments: account(55), status: "SYNCED" }),
      entry({ seq: 3, lines: [water], payments: account(56) }),
      entry({ seq: 4, lines: [water], payments: account(55), grantId: "g2" }),
    ]
    expect(accountChargedCents(entries, "g1", 55)).toBe(6666)
    expect(accountChargedCents(entries, "g1", 56)).toBe(3333)
  })

  it("counts waiting sales per shift and day for the status report; handed-to-support ones don't count", () => {
    const note = { at: "x", by: "Admin", reason: "support" }
    const entries = [
      entry({ seq: 1, soldAt: "2026-11-18T09:00:00.000Z" }),
      entry({ seq: 2, soldAt: "2026-11-18T08:00:00.000Z", status: "REFUSED" }),
      entry({ seq: 3, status: "SYNCED" }),
      entry({ seq: 4, status: "INVALID", handedToSupport: note }),
      entry({ seq: 5, shiftId: 413, soldAt: "2026-11-18T15:00:00.000Z" }),
    ]
    expect(entries.map(isWaiting)).toEqual([true, true, false, false, true])
    expect(pendingSummary(entries)).toEqual({
      pendingCount: 3,
      pending: [
        { shiftId: 412, tradingDay: "2026-11-18", count: 2, oldestSoldAt: "2026-11-18T08:00:00.000Z" },
        { shiftId: 413, tradingDay: "2026-11-18", count: 1, oldestSoldAt: "2026-11-18T15:00:00.000Z" },
      ],
      oldestPendingSoldAt: "2026-11-18T08:00:00.000Z",
    })
    expect(waitingForShift(entries, 412)).toBe(2)
    expect(pendingSummary([])).toEqual({ pendingCount: 0, pending: [], oldestPendingSoldAt: null })
  })
})

describe("a revoke", () => {
  it("wipes everything but the outbox, whose entries keep their grant", async () => {
    const entry = newEntry()
    await recordOfflineSale(entry, null)
    await wipeAll()
    expect(await getOutboxEntry(entry.clientOrderId)).toMatchObject({ status: "PENDING", grant: "signed.g1" })
    expect(await getOfflineSeq()).toBeNull()
  })
})
