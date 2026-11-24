// T1-3: the till's connection indicator and the /health ping for the customer's answers. Suspended: "Service
// suspended", never offline, and no ping until the suspension ends. Unavailable: an outage ("Server unavailable").
// Unknown address: still online.
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionProvider, PING_INTERVAL_MS, useConnection } from "@/contexts/connection-context"
import { ConnectionIndicator } from "@/components/pos/connection-indicator"
import { getCustomerStatus, noteCustomerAnswer } from "@/lib/customer-status"
import { reportConnectionSignal, signalForResponse } from "@/lib/connection-signals"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const SUSPENDED = { error: "Suspended.", code: "CUSTOMER_SUSPENDED" }
const UNAVAILABLE = { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" }

let health: () => Response
const fetchMock = vi.fn<typeof fetch>()
const healthCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/health").length

let seen: ReturnType<typeof useConnection>
function Probe() {
  seen = useConnection()
  return null
}

function renderTill() {
  return render(
    <ConnectionProvider>
      <ConnectionIndicator />
      <Probe />
    </ConnectionProvider>,
  )
}

const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => health())
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("CUSTOMER_SUSPENDED", () => {
  it("shows Service suspended, never goes offline, and stops pinging until the suspension ends", async () => {
    health = () => json(503, SUSPENDED)
    renderTill()
    await advance(0)
    expect(screen.getByRole("status", { name: "Connection: Service suspended" })).toHaveTextContent("Service suspended")
    expect(seen).toMatchObject({ isOnline: true, status: "online", suspended: true })

    // Ten minutes: no ping (the recovery check lives elsewhere), and requests that say "suspended" change nothing.
    for (let i = 0; i < 5; i += 1) {
      const signal = signalForResponse(503, "suspended")
      if (signal) act(() => reportConnectionSignal(signal))
    }
    await advance(10 * 60_000)
    expect(healthCalls()).toBe(1)
    expect(seen.isOnline).toBe(true)
    expect(screen.queryByText("Offline")).not.toBeInTheDocument()

    // The suspension ends (the recovery check saw a 200): the ping starts again at once.
    health = () => json(200, { status: "UP" })
    await act(async () => {
      await noteCustomerAnswer(json(200, {}))
    })
    await advance(0)
    expect(healthCalls()).toBe(2)
    expect(screen.getByRole("status", { name: "Connection: online" })).toBeInTheDocument()
  })

  it("over an outage: Service suspended is shown instead of Offline, and the state isn't changed", async () => {
    health = () => {
      throw new TypeError("Failed to fetch")
    }
    renderTill()
    await advance(0)
    await advance(PING_INTERVAL_MS * 3)
    expect(seen.isOnline).toBe(false)
    expect(screen.getByRole("status", { name: /Offline/ })).toBeInTheDocument()

    await act(async () => {
      await noteCustomerAnswer(json(503, SUSPENDED))
    })
    expect(screen.getByRole("status", { name: "Connection: Service suspended" })).toBeInTheDocument()
    expect(seen).toMatchObject({ isOnline: false, suspended: true })
  })
})

describe("CUSTOMER_UNAVAILABLE", () => {
  it("is an outage: Server unavailable after three answers", async () => {
    health = () => json(503, UNAVAILABLE)
    renderTill()
    await advance(0)
    expect(seen.isOnline).toBe(true)
    await advance(PING_INTERVAL_MS * 2)
    expect(seen).toMatchObject({ isOnline: false, reason: "server-down", suspended: false })
    expect(screen.getByRole("status", { name: /Server unavailable/ })).toBeInTheDocument()
    expect(getCustomerStatus()).toMatchObject({ unavailable: true, suspended: false })
  })
})

describe("an unknown address (404 with an empty body)", () => {
  it("is not offline", async () => {
    health = () => new Response(null, { status: 404 })
    renderTill()
    await advance(PING_INTERVAL_MS * 4)
    expect(seen.isOnline).toBe(true)
    expect(screen.getByRole("status", { name: "Connection: online" })).toBeInTheDocument()
    expect(getCustomerStatus().unknownAddress).toBe(true)
  })
})
