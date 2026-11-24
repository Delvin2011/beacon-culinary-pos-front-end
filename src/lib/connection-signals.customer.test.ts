// T1-3: a suspended customer never counts towards offline; an unavailable one is an outage like any other 503.
import { describe, expect, it } from "vitest"
import { signalForHealth, signalForResponse } from "@/lib/connection-signals"

describe("connection signals for the customer's answers", () => {
  it("CUSTOMER_SUSPENDED gives no signal, from a request or from /health", () => {
    expect(signalForResponse(503, "suspended")).toBeNull()
    expect(signalForHealth(503, "suspended")).toBeNull()
  })

  it("CUSTOMER_UNAVAILABLE is server-down, as any 503", () => {
    expect(signalForResponse(503, "unavailable")).toEqual({ ok: false, reason: "server-down" })
    expect(signalForHealth(503, "unavailable")).toEqual({ ok: false, reason: "server-down" })
    expect(signalForResponse(503)).toEqual({ ok: false, reason: "server-down" })
  })

  it("an empty 404 is not offline: the server answered (a request), or no signal (/health)", () => {
    expect(signalForResponse(404, "empty-404")).toEqual({ ok: true })
    expect(signalForHealth(404, "empty-404")).toBeNull()
  })
})
