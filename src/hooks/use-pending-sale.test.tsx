import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePendingSale, type UsePendingSaleOptions } from "./use-pending-sale"
import { PENDING_SALE_KEY, createPendingSale, loadPendingSale, savePendingSale } from "@/lib/pending-sale"
import { SALE_RETRY_DELAYS_MS } from "@/lib/pending-sale"

const ann = { cashierId: 7, email: "ann@x", name: "Ann" }
const bob = { cashierId: 8, email: "bob@x", name: "Bob" }
const summary = { lines: [{ name: "Beef Burger", quantity: 1 }], total: 85 }
const saleBody = {
  lines: [{ dailyMealOptionId: 412, quantity: 1, extras: [] }],
  payments: [{ method: "ACCOUNT", amount: 85, accountId: 3, authorization: { sessionToken: "mgr-1" } }],
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

const authFetch = vi.fn<UsePendingSaleOptions["authFetch"]>()
const onCompleted = vi.fn()
const onRejected = vi.fn()
const onNeedsApproval = vi.fn()

function setup(user: UsePendingSaleOptions["user"] = ann, isOnline = true) {
  return renderHook((props: { user: UsePendingSaleOptions["user"]; isOnline: boolean }) =>
    usePendingSale({ authFetch, user: props.user, isOnline: props.isOnline, onCompleted, onRejected, onNeedsApproval }),
    { initialProps: { user, isOnline } },
  )
}

// The bodies sent to POST /orders, parsed.
const sentBodies = () => authFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  authFetch.mockReset()
  onCompleted.mockReset()
  onRejected.mockReset()
  onNeedsApproval.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("retries", () => {
  it("resends the same body with the same clientOrderId, and a 200 replay completes it", async () => {
    authFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(409, { code: "ORDER_NUMBER_CONFLICT" }))
      .mockResolvedValueOnce(json(200, { id: 55, status: "DONE" }, { "Idempotent-Replay": "true" }))
    const { result } = setup()

    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    expect(result.current.phase).toBe("sending")
    await flush(1_000 + 2_000 + 4_000)

    const bodies = sentBodies()
    expect(bodies).toHaveLength(4)
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
    expect(bodies[0].clientOrderId).toEqual(expect.any(String))
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledWith({ id: 55, status: "DONE" }, expect.anything(), true)
    expect(result.current.phase).toBe("idle")
    expect(loadPendingSale()).toBeNull()
  })

  it("completes on 201 too", async () => {
    authFetch.mockResolvedValueOnce(json(201, { id: 56 }))
    const { result } = setup()
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush()
    expect(onCompleted).toHaveBeenCalledWith({ id: 56 }, expect.anything(), false)
  })

  it("keeps the sale after the retries run out, and resends when the connection comes back", async () => {
    authFetch.mockRejectedValue(new TypeError("Failed to fetch"))
    const { result, rerender } = setup()
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush(SALE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0))

    expect(authFetch).toHaveBeenCalledTimes(SALE_RETRY_DELAYS_MS.length + 1)
    expect(result.current.phase).toBe("unconfirmed")
    expect(loadPendingSale()).not.toBeNull()

    authFetch.mockReset()
    authFetch.mockResolvedValueOnce(json(201, { id: 57 }))
    rerender({ user: ann, isOnline: false })
    rerender({ user: ann, isOnline: true })
    await flush()
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it("never retries 409 IDEMPOTENCY_CONFLICT and keeps the sale for a supervisor", async () => {
    authFetch.mockImplementation(async () => json(409, { code: "IDEMPOTENCY_CONFLICT", error: "x" }))
    const { result } = setup()
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush(60_000)

    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe("conflict")
    expect(loadPendingSale()?.conflict).toBe(true)
  })

  it("passes a refusal back and clears the sale: nothing was created", async () => {
    authFetch.mockResolvedValueOnce(json(409, { code: "NO_OPEN_SHIFT", error: "x" }))
    const { result } = setup()
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush()
    expect(onRejected).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: "NO_OPEN_SHIFT" }))
    expect(result.current.phase).toBe("idle")
    expect(loadPendingSale()).toBeNull()
  })
})

describe("manager approval during a retry", () => {
  it("asks for the PIN, then resends with the same id and the new token", async () => {
    authFetch
      .mockRejectedValueOnce(new RangeError("odd")) // thrown: no answer
      .mockResolvedValueOnce(json(401, { code: "AUTHORIZATION_INVALID" }))
      .mockResolvedValueOnce(json(201, { id: 58 }))
    const { result } = setup()
    act(() => {
      result.current.start("SALE", saleBody, summary)
    })
    await flush(1_000)

    expect(result.current.phase).toBe("needs-approval")
    expect(onNeedsApproval).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.resendWithApproval("mgr-2")
    })
    await flush()

    const [first, , third] = sentBodies()
    expect(third.clientOrderId).toBe(first.clientOrderId)
    expect((third.payments as Array<Record<string, unknown>>)[0].authorization).toEqual({ sessionToken: "mgr-2" })
    expect(third.lines).toEqual(first.lines)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })
})

describe("one pending sale at a time, across reloads", () => {
  it("refuses a second sale while one is pending", async () => {
    authFetch.mockReturnValue(new Promise(() => {}))
    const { result } = setup()
    let second: unknown
    act(() => {
      result.current.start("SALE", saleBody, summary)
      second = result.current.start("SALE", saleBody, summary)
    })
    expect(second).toBeNull()
    expect(authFetch).toHaveBeenCalledTimes(1)
  })

  it("resumes a stored sale on start with the same id and body", async () => {
    const stored = createPendingSale("SALE", saleBody, summary, { key: "cashier:7", name: "Ann" })
    savePendingSale(stored)
    authFetch.mockResolvedValueOnce(json(200, { id: 59 }, { "Idempotent-Replay": "true" }))

    setup()
    await flush()

    expect(sentBodies()[0]).toEqual(stored.body)
    expect(onCompleted).toHaveBeenCalledWith({ id: 59 }, expect.objectContaining({ clientOrderId: stored.clientOrderId }), true)
  })

  it("completes once even if two loops both get 200 for the same id", async () => {
    const stored = createPendingSale("SALE", saleBody, summary, { key: "cashier:7", name: "Ann" })
    savePendingSale(stored)
    authFetch.mockImplementation(async () => json(200, { id: 60 }, { "Idempotent-Replay": "true" }))

    const first = setup()
    const second = setup()
    await flush()
    expect(first.result.current.phase).toBe("idle")
    expect(second.result.current.phase).toBe("idle")
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it("doesn't resend someone else's sale", async () => {
    savePendingSale(createPendingSale("SALE", saleBody, summary, { key: "cashier:7", name: "Ann" }))
    const { result } = setup(bob)
    await flush()
    expect(authFetch).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("other-user")
    expect(result.current.pending?.owner.name).toBe("Ann")
  })

  it("discard clears it for a supervisor", async () => {
    savePendingSale(createPendingSale("SALE", saleBody, summary, { key: "cashier:7", name: "Ann" }))
    const { result } = setup(bob)
    await flush()
    act(() => result.current.discard())
    expect(result.current.phase).toBe("idle")
    expect(localStorage.getItem(PENDING_SALE_KEY)).not.toContain("clientOrderId")
  })
})
