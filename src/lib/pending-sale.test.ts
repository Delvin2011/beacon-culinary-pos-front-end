import { beforeEach, describe, expect, it } from "vitest"
import {
  PENDING_SALE_KEY,
  classifySaleError,
  classifySaleResponse,
  createPendingSale,
  isSaleCompleted,
  loadPendingSale,
  markSaleCompleted,
  ownerKey,
  savePendingSale,
  withNewApproval,
} from "./pending-sale"
import { RequestTimeoutError } from "./net"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const summary = { lines: [{ name: "Beef Burger", quantity: 2 }], total: 170 }
const owner = { key: "cashier:7", name: "Ann" }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

beforeEach(() => {
  localStorage.clear()
})

describe("creating a pending sale", () => {
  it("adds a UUID clientOrderId and freezes a copy of the body", () => {
    const body = { lines: [{ dailyMealOptionId: 412, quantity: 2, extras: [] }], payments: [{ method: "CASH", amount: 170 }] }
    const sale = createPendingSale("SALE", body, summary, owner)

    expect(sale.clientOrderId).toMatch(UUID)
    expect(sale.body.clientOrderId).toBe(sale.clientOrderId)
    ;(body.lines[0] as { quantity: number }).quantity = 99
    expect((sale.body.lines as Array<{ quantity: number }>)[0].quantity).toBe(2)
  })

  it("gives every sale its own id", () => {
    const a = createPendingSale("SALE", {}, summary, owner)
    const b = createPendingSale("SALE", {}, summary, owner)
    expect(a.clientOrderId).not.toBe(b.clientOrderId)
  })

  it("survives a reload: stored in localStorage, not sessionStorage", () => {
    const sale = createPendingSale("COMPLIMENTARY", { lines: [] }, summary, owner)
    savePendingSale(sale)
    expect(localStorage.getItem(PENDING_SALE_KEY)).toContain(sale.clientOrderId)
    expect(loadPendingSale()).toEqual(sale)
  })

  it("reads a corrupt store as empty", () => {
    localStorage.setItem(PENDING_SALE_KEY, "{not json")
    expect(loadPendingSale()).toBeNull()
  })
})

describe("completing once per clientOrderId", () => {
  it("clears the pending sale and says so only the first time", () => {
    const sale = createPendingSale("SALE", {}, summary, owner)
    savePendingSale(sale)
    expect(markSaleCompleted(sale.clientOrderId)).toBe(true)
    expect(loadPendingSale()).toBeNull()
    expect(isSaleCompleted(sale.clientOrderId)).toBe(true)
    expect(markSaleCompleted(sale.clientOrderId)).toBe(false)
  })
})

describe("a new manager approval", () => {
  it("swaps only the authorization tokens and keeps the id", () => {
    const sale = createPendingSale(
      "SALE",
      {
        lines: [{ dailyMealOptionId: 1, quantity: 1, extras: [] }],
        payments: [
          { method: "CASH", amount: 10 },
          { method: "ACCOUNT", amount: 50, accountId: 3, authorization: { sessionToken: "old" } },
        ],
        discount: { type: "PERCENT", value: 10, reasonCode: "STAFF", authorization: { sessionToken: "old" } },
      },
      summary,
      owner,
    )
    const next = withNewApproval(sale, "new")

    expect(next.clientOrderId).toBe(sale.clientOrderId)
    expect(next.body.clientOrderId).toBe(sale.clientOrderId)
    const payments = next.body.payments as Array<Record<string, unknown>>
    expect(payments[0]).toEqual({ method: "CASH", amount: 10 })
    expect(payments[1].authorization).toEqual({ sessionToken: "new" })
    expect((next.body.discount as Record<string, unknown>).authorization).toEqual({ sessionToken: "new" })
    expect(next.body.lines).toEqual(sale.body.lines)
  })
})

describe("classifying a send", () => {
  it("201 and 200 replay both complete", async () => {
    expect(await classifySaleResponse(json(201, { id: 5 }))).toEqual({ kind: "done", order: { id: 5 }, replay: false })
    expect(await classifySaleResponse(json(200, { id: 5, status: "DONE" }, { "Idempotent-Replay": "true" }))).toEqual({
      kind: "done",
      order: { id: 5, status: "DONE" },
      replay: true,
    })
  })

  it("retries on no answer, 5xx, 429 and 409 ORDER_NUMBER_CONFLICT", async () => {
    expect(classifySaleError(new TypeError("Failed to fetch")).kind).toBe("retry")
    expect(classifySaleError(new RequestTimeoutError(20_000)).kind).toBe("retry")
    expect((await classifySaleResponse(json(503, {}))).kind).toBe("retry")
    expect(await classifySaleResponse(json(429, {}, { "Retry-After": "4" }))).toMatchObject({ kind: "retry", retryAfterMs: 4000 })
    expect((await classifySaleResponse(json(409, { code: "ORDER_NUMBER_CONFLICT" }))).kind).toBe("retry")
  })

  it("never retries 409 IDEMPOTENCY_CONFLICT", async () => {
    expect(await classifySaleResponse(json(409, { error: "Reused id.", code: "IDEMPOTENCY_CONFLICT" }))).toEqual({
      kind: "conflict",
      message: "Reused id.",
    })
  })

  it("asks for a PIN on AUTHORIZATION_INVALID, and passes other refusals back", async () => {
    expect((await classifySaleResponse(json(401, { code: "AUTHORIZATION_INVALID" }))).kind).toBe("needs-approval")
    expect((await classifySaleResponse(new Response(null, { status: 401 }))).kind).toBe("signed-out")
    expect(await classifySaleResponse(json(409, { code: "NO_OPEN_SHIFT" }))).toMatchObject({ kind: "rejected", code: "NO_OPEN_SHIFT" })
    expect(await classifySaleResponse(json(400, { code: "ITEM_UNAVAILABLE" }))).toMatchObject({ kind: "rejected", status: 400 })
  })
})

describe("ownerKey", () => {
  it("prefers the cashier id, then the account id, then the email", () => {
    expect(ownerKey({ cashierId: 7, email: "a@x" })).toBe("cashier:7")
    expect(ownerKey({ id: "u1", email: "a@x" })).toBe("user:u1")
    expect(ownerKey({ email: "A@X" })).toBe("email:a@x")
    expect(ownerKey(null)).toBeNull()
  })
})
