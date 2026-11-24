// T1-3: what a response says about the customer, and the status every screen reads.
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  classifyCustomerAnswer,
  customerAnswerOf,
  getCustomerStatus,
  markUnknownAddress,
  noteCustomerAnswer,
  resetCustomerStatus,
  subscribeCustomerStatus,
  whenNotSuspended,
} from "@/lib/customer-status"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const suspended = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
const unavailable = () => json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" })

afterEach(() => resetCustomerStatus())

describe("classifyCustomerAnswer", () => {
  it.each([
    ["a 200", () => json(200, {}), "ok"],
    ["a 204", () => new Response(null, { status: 204 }), "ok"],
    ["503 CUSTOMER_SUSPENDED", suspended, "suspended"],
    ["503 CUSTOMER_UNAVAILABLE", unavailable, "unavailable"],
    ["503 without a customer code (O1 DOWN)", () => json(503, { status: "DOWN" }), "other"],
    ["503 with no body", () => new Response(null, { status: 503 }), "other"],
    ["404 with an empty body", () => new Response(null, { status: 404 }), "empty-404"],
    ["404 with only whitespace", () => new Response("  \n", { status: 404 }), "empty-404"],
    ["404 with an ErrorDto", () => json(404, { error: "Not found.", code: "NOT_FOUND" }), "other"],
    ["a 401", () => new Response(null, { status: 401 }), "other"],
    ["a 500", () => new Response(null, { status: 500 }), "other"],
  ])("%s → %s", async (_name, make, expected) => {
    expect(await classifyCustomerAnswer(make())).toBe(expected)
  })

  it("leaves the body for the caller to read", async () => {
    const res = suspended()
    await classifyCustomerAnswer(res)
    expect(await res.json()).toEqual({ error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
  })
})

describe("the customer's status", () => {
  it("is suspended on CUSTOMER_SUSPENDED and active again on any 2xx", async () => {
    await noteCustomerAnswer(suspended())
    expect(getCustomerStatus()).toEqual({ suspended: true, unavailable: false, unknownAddress: false })
    await noteCustomerAnswer(json(200, {}))
    expect(getCustomerStatus()).toEqual({ suspended: false, unavailable: false, unknownAddress: false })
  })

  it("CUSTOMER_UNAVAILABLE ends a suspension (an outage, not a suspension)", async () => {
    await noteCustomerAnswer(suspended())
    await noteCustomerAnswer(unavailable())
    expect(getCustomerStatus()).toEqual({ suspended: false, unavailable: true, unknownAddress: false })
  })

  it("other answers change nothing; an empty 404 alone doesn't mean an unknown address", async () => {
    await noteCustomerAnswer(suspended())
    for (const res of [new Response(null, { status: 401 }), new Response(null, { status: 404 }), new Response(null, { status: 503 })]) {
      await noteCustomerAnswer(res)
    }
    expect(getCustomerStatus()).toEqual({ suspended: true, unavailable: false, unknownAddress: false })
  })

  it("an unknown address lasts until a 2xx", async () => {
    markUnknownAddress()
    expect(getCustomerStatus().unknownAddress).toBe(true)
    await noteCustomerAnswer(json(200, {}))
    expect(getCustomerStatus().unknownAddress).toBe(false)
  })

  it("remembers what each response said", async () => {
    const res = unavailable()
    expect(customerAnswerOf(res)).toBeNull()
    await noteCustomerAnswer(res)
    expect(customerAnswerOf(res)).toBe("unavailable")
  })

  it("tells listeners about changes only", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCustomerStatus(listener)
    await noteCustomerAnswer(suspended())
    await noteCustomerAnswer(suspended())
    await noteCustomerAnswer(json(200, {}))
    unsubscribe()
    expect(listener.mock.calls.map(([status]) => status.suspended)).toEqual([true, false])
  })

  it("whenNotSuspended waits for the end of a suspension", async () => {
    await expect(whenNotSuspended()).resolves.toBeUndefined()
    await noteCustomerAnswer(suspended())
    let done = false
    void whenNotSuspended().then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    await noteCustomerAnswer(json(200, {}))
    await Promise.resolve()
    expect(done).toBe(true)
  })
})
