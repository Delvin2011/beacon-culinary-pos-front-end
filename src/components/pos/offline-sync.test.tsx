// O4: the sync component empties the outbox when online, sends a status report after each batch, backs off and
// resends the same sales after a 500, stops (keeping the outbox) on 403 / 400, and sends nothing offline.
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineHeartbeat } from "@/components/pos/offline-heartbeat"
import { OfflineSync } from "@/components/pos/offline-sync"
import { OutboxProvider } from "@/contexts/outbox-context"
import { OFFLINE_DB_NAME, getMeta, resetOfflineDbForTests } from "@/lib/offline/db"
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { listOutbox, recordOfflineSale, type NewOutboxEntry } from "@/lib/offline/outbox"

let online: boolean
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: online }) }))

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
type Call = { path: string; body: Record<string, unknown> | null }
let calls: Call[]
let salesAnswer: (body: { sales: Array<{ clientOrderId: string; offlineSeq: number }> }) => Response | Promise<Response>

const created = (body: { sales: Array<{ clientOrderId: string; offlineSeq: number }> }) =>
  json({
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

// The long back-off waits are caught here and run by the test; short timers run as usual.
let pendingRetries: Array<{ delay: number; run: () => void }>

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  online = true
  calls = []
  pendingRetries = []
  salesAnswer = created
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, "")
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      calls.push({ path, body })
      if (path === "/pos/offline/sales") return salesAnswer(body as never)
      if (path === "/pos/offline/status") return json({ receivedAt: "2026-11-18T13:05:02Z", clockSkewMs: 0, serverTimeUtc: "2026-11-18T13:05:02Z" })
      if (path === "/pos/till-status") return json({ registered: false })
      return json({})
    }),
  )
  // Long timers are held (request time limits are cleared once answered; what's left are the back-off waits).
  const realSetTimeout = window.setTimeout.bind(window)
  const realClearTimeout = window.clearTimeout.bind(window)
  let nextId = 1_000_000
  const held = new Map<number, { delay: number; run: () => void }>()
  vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if ((delay ?? 0) >= 5_000 && typeof handler === "function") {
      const id = nextId++
      const timer = { delay: delay!, run: () => (handler as () => void)() }
      held.set(id, timer)
      pendingRetries.push(timer)
      return id
    }
    return realSetTimeout(handler, delay, ...args)
  }) as typeof window.setTimeout)
  vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
    const timer = id !== undefined ? held.get(id) : undefined
    if (timer) {
      held.delete(id!)
      pendingRetries = pendingRetries.filter((t) => t !== timer)
      return
    }
    realClearTimeout(id)
  }) as typeof window.clearTimeout)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

const salesCalls = () => calls.filter((call) => call.path === "/pos/offline/sales")

function renderSync() {
  return render(
    <OutboxProvider>
      <OfflineHeartbeat />
      <OfflineSync />
    </OutboxProvider>,
  )
}

describe("OfflineSync", () => {
  it("sends the outbox with its grants, marks every sale synced, and shows progress", async () => {
    await recordOfflineSale(newEntry(1), null)
    await recordOfflineSale(newEntry(2), null)
    let answer!: (response: Response) => void
    salesAnswer = (body) => new Promise<Response>((resolve) => (answer = () => resolve(created(body))))

    renderSync()
    expect(await screen.findByText("Sending 2 offline sales…")).toBeInTheDocument()
    expect(salesCalls()[0].body).toMatchObject({ grants: ["signed.g1"], sales: [{ clientOrderId: "sale-1" }, { clientOrderId: "sale-2" }] })

    await act(async () => answer(new Response()))
    await waitFor(async () => expect((await listOutbox()).map((e) => e.status)).toEqual(["SYNCED", "SYNCED"]))
    await waitFor(() => expect(screen.queryByText(/Sending/)).not.toBeInTheDocument())
    expect(await getMeta("lastSyncAt")).toBeTruthy()
  })

  it("sends a status report with the new counts straight after the batch", async () => {
    await recordOfflineSale(newEntry(1), null)
    renderSync()
    await waitFor(() => {
      const salesIndex = calls.findIndex((call) => call.path === "/pos/offline/sales")
      const after = calls.slice(salesIndex + 1).filter((call) => call.path === "/pos/offline/status")
      expect(salesIndex).toBeGreaterThanOrEqual(0)
      expect(after.some((call) => call.body?.pendingCount === 0 && call.body?.lastSyncAt)).toBe(true)
    })
  })

  it("after a 500, waits and resends the same sales", async () => {
    await recordOfflineSale(newEntry(1), null)
    let first = true
    salesAnswer = (body) => {
      if (first) {
        first = false
        return new Response(null, { status: 500 })
      }
      return created(body)
    }
    renderSync()
    expect(await screen.findByText("1 offline sale waiting to send. Trying again shortly.")).toBeInTheDocument()
    expect(pendingRetries.map((retry) => retry.delay)).toEqual([5_000])
    // A sale made meanwhile isn't added to the resend.
    await recordOfflineSale(newEntry(2), null)

    await act(async () => pendingRetries[0].run())
    await waitFor(() => expect(salesCalls().length).toBeGreaterThanOrEqual(2))
    expect((salesCalls()[1].body as { sales: Array<{ clientOrderId: string }> }).sales.map((s) => s.clientOrderId)).toEqual(["sale-1"])
    await waitFor(async () => expect((await listOutbox()).every((e) => e.status === "SYNCED")).toBe(true))
  })

  it("403 DEVICE_NOT_REGISTERED stops sync, keeps the outbox and alerts a manager", async () => {
    await recordOfflineSale(newEntry(1), null)
    salesAnswer = () => json({ error: "x", code: "DEVICE_NOT_REGISTERED" }, 403)
    renderSync()
    expect(await screen.findByRole("alert")).toHaveTextContent("this browser isn't a registered till")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect((await listOutbox())[0].status).toBe("PENDING")
    expect(await getMeta("syncStopped")).toMatchObject({ reason: "DEVICE_NOT_REGISTERED" })
    expect(salesCalls()).toHaveLength(1)
    expect(pendingRetries).toEqual([])
  })

  it("400 INVALID_BATCH stops sync with Try again, which sends again", async () => {
    await recordOfflineSale(newEntry(1), null)
    salesAnswer = () => json({ error: "x", code: "INVALID_BATCH" }, 400)
    renderSync()
    expect(await screen.findByRole("alert")).toHaveTextContent("the server couldn't read what the till sent")
    expect((await listOutbox())[0].status).toBe("PENDING")

    salesAnswer = created
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    await waitFor(async () => expect((await listOutbox())[0].status).toBe("SYNCED"))
  })

  it("sends nothing while offline", async () => {
    await recordOfflineSale(newEntry(1), null)
    online = false
    renderSync()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(salesCalls()).toEqual([])
    expect((await listOutbox())[0].status).toBe("PENDING")
  })
})
