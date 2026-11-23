// O4: batches (grants, order, limits), the server's answers per sale and per batch.
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OFFLINE_DB_NAME, resetOfflineDbForTests } from "@/lib/offline/db"
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { getOutboxEntry, listOutbox, recordOfflineSale, type NewOutboxEntry, type OutboxEntry } from "@/lib/offline/outbox"
import {
  BATCH_BYTES_LIMIT,
  applyResults,
  buildBatch,
  retryDelayMs,
  sendBatch,
  type SaleResult,
  type SalesBatch,
} from "@/lib/offline/sales-sync"

const API = "/api"
const CLOCK = "2026-11-18T13:05:01.000Z"

function newEntry(seq: number, grantId = "g1", soldAt = `2026-11-18T10:${String(seq % 60).padStart(2, "0")}:00.000Z`, name = "Water"): NewOutboxEntry {
  const result = buildOfflineSale({
    clientOrderId: `sale-${grantId}-${seq}`,
    grant: { grantId, shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: seq,
    soldAt,
    unlockedOffline: false,
    snapshotVersion: "v1",
    vatRate: 0.15,
    lines: [{ dailyMealOptionId: 912, name, station: "NONE", unitPriceCents: 2000, quantity: 1, extras: [] }],
    payments: [{ method: "CASH", amountCents: 2000, tenderedCents: 2000 }],
    rules: { accountsEnabled: false },
  })
  if (!result.ok) throw new Error(result.message)
  return {
    clientOrderId: result.sale.clientOrderId,
    payload: result.sale,
    grant: `signed.${grantId}`,
    grantId,
    shiftId: 412,
    tradingDay: "2026-11-18",
    soldAt,
    recordedAt: soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: null, cashierName: "Thandi", accountNames: {} },
  }
}

const asEntry = (entry: NewOutboxEntry, overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  ...entry,
  status: "PENDING",
  syncedAt: null,
  result: null,
  error: null,
  code: null,
  handedToSupport: null,
  ...overrides,
})

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("buildBatch", () => {
  it("carries the signed grant of every sale once, and the sales oldest first with the till's own clock", () => {
    const entries = [asEntry(newEntry(3, "g2", "2026-11-18T10:30:00.000Z")), asEntry(newEntry(1, "g1", "2026-11-18T10:10:00.000Z")), asEntry(newEntry(2, "g1", "2026-11-18T10:20:00.000Z"))]
    const batch = buildBatch(entries, CLOCK)!
    expect(batch.body.grants).toEqual(["signed.g1", "signed.g2"])
    expect(batch.body.sales.map((sale) => sale.offlineSeq)).toEqual([1, 2, 3])
    expect(batch.body.sales.every((sale) => sale.tillClockAtSendUtc === CLOCK)).toBe(true)
    expect(batch.clientOrderIds).toEqual(["sale-g1-1", "sale-g1-2", "sale-g2-3"])
    // The contract's sale as recorded, plus tillClockAtSendUtc.
    expect(batch.body.sales[0]).toEqual({ ...entries[1].payload, tillClockAtSendUtc: CLOCK })
  })

  it("sends at most 50 sales", () => {
    const entries = Array.from({ length: 120 }, (_, i) => asEntry(newEntry(i + 1, "g1", `2026-11-18T10:00:00.${String(i).padStart(3, "0")}Z`)))
    const batch = buildBatch(entries, CLOCK)!
    expect(batch.body.sales).toHaveLength(50)
    expect(batch.body.sales[49].offlineSeq).toBe(50)
  })

  it("carries at most 10 grants", () => {
    const entries = Array.from({ length: 12 }, (_, i) => asEntry(newEntry(i + 1, `g${i + 1}`, `2026-11-18T10:${String(i).padStart(2, "0")}:00.000Z`)))
    const batch = buildBatch(entries, CLOCK)!
    expect(batch.body.grants).toHaveLength(10)
    expect(batch.body.sales).toHaveLength(10)
  })

  it("stays under the size limit", () => {
    const long = "x".repeat(20_000)
    const entries = Array.from({ length: 40 }, (_, i) => asEntry(newEntry(i + 1, "g1", `2026-11-18T10:${String(i).padStart(2, "0")}:00.000Z`, long)))
    const batch = buildBatch(entries, CLOCK)!
    expect(new TextEncoder().encode(JSON.stringify(batch.body)).length).toBeLessThanOrEqual(BATCH_BYTES_LIMIT)
    expect(batch.body.sales.length).toBeGreaterThan(1)
    expect(batch.body.sales.length).toBeLessThan(40)
  })

  it("never sends SYNCED, INVALID or REFUSED sales", () => {
    const entries = [
      asEntry(newEntry(1), { status: "SYNCED" }),
      asEntry(newEntry(2), { status: "INVALID" }),
      asEntry(newEntry(3), { status: "REFUSED" }),
    ]
    expect(buildBatch(entries, CLOCK)).toBeNull()
  })

  it("resends exactly the given sales", () => {
    const entries = [asEntry(newEntry(1)), asEntry(newEntry(2)), asEntry(newEntry(3))]
    expect(buildBatch(entries, CLOCK, ["sale-g1-2"])!.clientOrderIds).toEqual(["sale-g1-2"])
  })
})

describe("sendBatch", () => {
  const batch: SalesBatch = { body: { grants: ["signed.g1"], sales: [] }, clientOrderIds: [] }

  it("posts the batch with the till cookie and no bearer token", async () => {
    fetchMock.mockResolvedValue(json({ results: [], serverTimeUtc: CLOCK }))
    expect(await sendBatch(batch)).toEqual({ kind: "ok", results: [], serverTimeUtc: CLOCK })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/pos/offline/sales`)
    expect(init).toMatchObject({ method: "POST", credentials: "include" })
    expect(new Headers(init?.headers).has("Authorization")).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual(batch.body)
  })

  it.each([
    [json({ error: "x", code: "DEVICE_NOT_REGISTERED" }, 403), { kind: "stop", reason: "DEVICE_NOT_REGISTERED" }],
    [json({ error: "x", code: "INVALID_BATCH" }, 400), { kind: "stop", reason: "INVALID_BATCH" }],
    [new Response(null, { status: 413 }), { kind: "stop", reason: "PAYLOAD_TOO_LARGE" }],
    [new Response(null, { status: 415 }), { kind: "stop", reason: "UNSUPPORTED_MEDIA_TYPE" }],
    [new Response(null, { status: 500 }), { kind: "retry" }],
    [new Response(null, { status: 503 }), { kind: "retry" }],
    [json({ error: "x", code: "SOMETHING_ELSE" }, 403), { kind: "retry" }],
    [json({ unexpected: true }), { kind: "retry" }],
  ])("answer %# → %o", async (response, outcome) => {
    fetchMock.mockResolvedValue(response as Response)
    expect(await sendBatch(batch)).toEqual(outcome)
  })

  it("a network failure is a retry", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    expect(await sendBatch(batch)).toEqual({ kind: "retry" })
  })
})

describe("applyResults", () => {
  const result = (overrides: Partial<SaleResult>): SaleResult => ({
    clientOrderId: null,
    result: "CREATED",
    orderId: null,
    orderNumber: null,
    receiptNumber: null,
    collectionNumber: null,
    exceptions: [],
    error: null,
    code: null,
    ...overrides,
  })

  it("marks each sale by its result; INVALID and REFUSED are kept with the error", async () => {
    const entries = [1, 2, 3, 4, 5].map((seq) => newEntry(seq))
    for (const entry of entries) await recordOfflineSale(entry, null)
    const batch = buildBatch(await listOutbox(), CLOCK)!
    const summary = await applyResults(
      batch,
      [
        result({ clientOrderId: "sale-g1-1", result: "CREATED", orderId: 9301, orderNumber: 58, receiptNumber: "T1-20261118-0001", collectionNumber: "T1-1" }),
        result({ clientOrderId: "sale-g1-2", result: "CREATED_WITH_EXCEPTIONS", orderId: 9302, exceptions: [{ code: "OVERSOLD", severity: "REVIEW" }] }),
        result({ clientOrderId: "sale-g1-3", result: "DUPLICATE", orderId: 9288, receiptNumber: "T1-20261118-0003", collectionNumber: "T1-3" }),
        result({ clientOrderId: null, result: "INVALID", error: "clientOrderId is required." }),
        result({ clientOrderId: "sale-g1-5", result: "REFUSED", code: "GRANT_INVALID", error: "The grant for this sale isn't valid." }),
      ],
      CLOCK,
    )
    expect(summary).toEqual({ synced: 3, rejected: 2, unknown: 0 })
    expect(await getOutboxEntry("sale-g1-1")).toMatchObject({ status: "SYNCED", syncedAt: CLOCK, result: { result: "CREATED", orderId: 9301, orderNumber: 58 } })
    expect(await getOutboxEntry("sale-g1-2")).toMatchObject({ status: "SYNCED", result: { exceptions: [{ code: "OVERSOLD", severity: "REVIEW" }] } })
    expect(await getOutboxEntry("sale-g1-3")).toMatchObject({ status: "SYNCED", result: { result: "DUPLICATE", collectionNumber: "T1-3" } })
    expect(await getOutboxEntry("sale-g1-4")).toMatchObject({ status: "INVALID", error: "clientOrderId is required." })
    expect(await getOutboxEntry("sale-g1-5")).toMatchObject({ status: "REFUSED", code: "GRANT_INVALID" })

    // Neither is sent again.
    expect(buildBatch(await listOutbox(), CLOCK)).toBeNull()
  })

  it("leaves a sale PENDING when its result is unknown or missing", async () => {
    for (const seq of [1, 2]) await recordOfflineSale(newEntry(seq), null)
    const batch = buildBatch(await listOutbox(), CLOCK)!
    expect(await applyResults(batch, [result({ clientOrderId: "sale-g1-1", result: "MAYBE" })], CLOCK)).toEqual({ synced: 0, rejected: 0, unknown: 2 })
    expect((await listOutbox()).map((e) => e.status)).toEqual(["PENDING", "PENDING"])
  })

  it("matches a result by its clientOrderId when it isn't at its position", async () => {
    for (const seq of [1, 2]) await recordOfflineSale(newEntry(seq), null)
    const batch = buildBatch(await listOutbox(), CLOCK)!
    await applyResults(batch, [result({ clientOrderId: "sale-g1-2", result: "REFUSED", code: "GRANT_INVALID" }), result({ clientOrderId: "sale-g1-1" })], CLOCK)
    expect((await getOutboxEntry("sale-g1-1"))?.status).toBe("SYNCED")
    expect((await getOutboxEntry("sale-g1-2"))?.status).toBe("REFUSED")
  })
})

describe("retryDelayMs", () => {
  it("backs off to 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000])
  })
})
