// T1-3: a pending sale (O1) while the customer is suspended: it is kept as it is (same id, same body), waits without
// sending or using up its retries, and goes through once the suspension ends.
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePendingSale, type UsePendingSaleOptions } from "./use-pending-sale"
import { apiFetch } from "@/lib/api-fetch"
import { noteCustomerAnswer } from "@/lib/customer-status"
import { loadPendingSale } from "@/lib/pending-sale"

const ann = { cashierId: 7, email: "ann@x", name: "Ann" }
const summary = { lines: [{ name: "Beef stew", quantity: 1 }], total: 50 }
const saleBody = { lines: [{ dailyMealOptionId: 801, quantity: 1, extras: [] }], payments: [{ method: "CASH", amount: 50, amountTendered: 50 }] }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const SUSPENDED = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })

// authFetch as the auth context makes it: apiFetch, so a suspension is seen and later calls are refused.
let server: () => Response
const fetchMock = vi.fn<typeof fetch>()
const authFetch: UsePendingSaleOptions["authFetch"] = (path, init) => apiFetch(path, { ...init, credentials: "include" })
const onCompleted = vi.fn()

const ordersCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/orders")

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  onCompleted.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => server())
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = (ms = 0) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

describe("a pending sale while the customer is suspended", () => {
  it("waits, kept as it is, using up no retry, then completes once the suspension ends", async () => {
    server = SUSPENDED
    const { result } = renderHook(() =>
      usePendingSale({ authFetch, user: ann, isOnline: true, onCompleted, onRejected: vi.fn(), onNeedsApproval: vi.fn() }),
    )
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush(0)
    const stored = loadPendingSale()
    expect(stored).toMatchObject({ body: saleBody })
    expect(ordersCalls()).toHaveLength(1)

    // An hour: no further attempt, the sale still "Checking…", not "unconfirmed".
    await flush(60 * 60_000)
    expect(ordersCalls()).toHaveLength(1)
    expect(result.current.phase).toBe("sending")
    expect(loadPendingSale()).toEqual(stored)

    // Active again: the same sale (same clientOrderId, same body) is sent and completes.
    server = () => json(201, { id: 77, orderNumber: 41 })
    await act(async () => {
      await noteCustomerAnswer(json(200, {}))
    })
    await flush(0)
    expect(ordersCalls()).toHaveLength(2)
    const sent = ordersCalls().map(([, init]) => JSON.parse(String(init?.body)) as unknown)
    expect(sent[0]).toEqual(sent[1])
    expect(onCompleted).toHaveBeenCalledWith({ id: 77, orderNumber: 41 }, expect.objectContaining({ clientOrderId: stored!.clientOrderId }), false)
    expect(loadPendingSale()).toBeNull()
  })
})
