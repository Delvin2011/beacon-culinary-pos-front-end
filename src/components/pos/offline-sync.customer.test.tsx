// T1-3: offline sync and the heartbeat while the customer is suspended: nothing is sent, the outbox is kept exactly
// as it is (never deleted or marked), and both pick up again when the suspension ends.
import "fake-indexeddb/auto"
import { act, render, waitFor } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineHeartbeat } from "@/components/pos/offline-heartbeat"
import { OfflineSync } from "@/components/pos/offline-sync"
import { OutboxProvider } from "@/contexts/outbox-context"
import { noteCustomerAnswer } from "@/lib/customer-status"
import { OFFLINE_DB_NAME, resetOfflineDbForTests } from "@/lib/offline/db"
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { listOutbox, recordOfflineSale, type NewOutboxEntry } from "@/lib/offline/outbox"

// Online as far as the connection goes; suspended as the customer's status says (the real hook).
vi.mock("@/contexts/connection-context", async () => {
  const { useCustomerStatus } = await import("@/hooks/use-customer-status")
  return { useConnection: () => ({ isOnline: true, suspended: useCustomerStatus().suspended }) }
})

function newEntry(seq: number): NewOutboxEntry {
  const soldAt = `2026-11-18T10:0${seq}:00.000Z`
  const result = buildOfflineSale({
    clientOrderId: `sale-${seq}`,
    grant: { grantId: "g1", shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: seq,
    soldAt,
    unlockedOffline: false,
    snapshotVersion: "v1",
    vatRate: 0.15,
    lines: [{ dailyMealOptionId: 912, name: "Water", station: "NONE", unitPriceCents: 2000, quantity: 1, extras: [] }],
    payments: [{ method: "CASH", amountCents: 2000, tenderedCents: 2000 }],
    rules: { accountsEnabled: false },
  })
  if (!result.ok) throw new Error(result.message)
  return {
    clientOrderId: result.sale.clientOrderId,
    payload: result.sale,
    grant: "signed.g1",
    grantId: "g1",
    shiftId: 412,
    tradingDay: "2026-11-18",
    soldAt,
    recordedAt: soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: null, cashierName: "Thandi", accountNames: {} },
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const SUSPENDED = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
let suspendedServer: boolean
let paths: string[]

const created = (body: { sales: Array<{ clientOrderId: string; offlineSeq: number }> }) =>
  json(200, {
    results: body.sales.map((sale) => ({
      clientOrderId: sale.clientOrderId,
      result: "CREATED",
      orderId: 9000 + sale.offlineSeq,
      orderNumber: 50 + sale.offlineSeq,
      receiptNumber: `T1-20261118-000${sale.offlineSeq}`,
      collectionNumber: `T1-${sale.offlineSeq}`,
      exceptions: [],
    })),
    serverTimeUtc: "2026-11-18T13:05:01Z",
  })

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  suspendedServer = false
  paths = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^\/api(?=\/)/, "")
      paths.push(path)
      if (suspendedServer) return SUSPENDED()
      if (path === "/pos/offline/sales") return created(JSON.parse(String(init?.body)) as never)
      if (path === "/pos/offline/status") return json(200, { receivedAt: "2026-11-18T13:05:02Z", clockSkewMs: 0, serverTimeUtc: "2026-11-18T13:05:02Z" })
      if (path === "/pos/till-status") return json(200, { registered: false })
      return json(200, {})
    }),
  )
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

const renderSync = () =>
  render(
    <OutboxProvider>
      <OfflineHeartbeat />
      <OfflineSync />
    </OutboxProvider>,
  )

describe("offline sync while the customer is suspended", () => {
  it("sends nothing and keeps the outbox; resumes and syncs when the suspension ends", async () => {
    await recordOfflineSale(newEntry(1), null)
    await recordOfflineSale(newEntry(2), null)
    suspendedServer = true
    await act(async () => {
      await noteCustomerAnswer(SUSPENDED())
    })

    renderSync()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect(paths).toEqual([])
    expect((await listOutbox()).map((entry) => [entry.clientOrderId, entry.status])).toEqual([["sale-1", "PENDING"], ["sale-2", "PENDING"]])

    // Active again (the /health check saw a 200): sync and the heartbeat start, and the outbox is sent.
    suspendedServer = false
    await act(async () => {
      await noteCustomerAnswer(json(200, {}))
    })
    await waitFor(async () => expect((await listOutbox()).map((entry) => entry.status)).toEqual(["SYNCED", "SYNCED"]))
    expect(paths).toContain("/pos/offline/sales")
    expect(paths).toContain("/pos/offline/status")
  })

  it("the first answer saying CUSTOMER_SUSPENDED (to sync or the heartbeat) stops both; the outbox is kept", async () => {
    await recordOfflineSale(newEntry(1), null)
    suspendedServer = true
    renderSync()
    await waitFor(() => expect(paths.length).toBeGreaterThan(0))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    // The status report and the batch may both be out before the first answer; nothing is sent after it.
    const sent = paths.length
    expect(sent).toBeLessThanOrEqual(2)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
    expect(paths.length).toBe(sent)
    const [entry] = await listOutbox()
    expect(entry).toMatchObject({ clientOrderId: "sale-1", status: "PENDING" })

    suspendedServer = false
    await act(async () => {
      await noteCustomerAnswer(json(200, {}))
    })
    await waitFor(async () => expect((await listOutbox()).map((e) => e.status)).toEqual(["SYNCED"]))
  })
})
