import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ConnectionProvider,
  INITIAL_CONNECTION,
  OFFLINE_PING_INTERVAL_MS,
  PING_INTERVAL_MS,
  nextConnectionState,
  type ConnectionState,
} from "@/contexts/connection-context"
import { ConnectionIndicator } from "@/components/pos/connection-indicator"
import { reportConnectionSignal, signalForError, signalForHealth, signalForResponse } from "@/lib/connection-signals"
import { RequestTimeoutError } from "@/lib/net"

const fail = { ok: false as const, reason: "no-connection" as const }
const ok = { ok: true as const }

describe("hysteresis", () => {
  it("needs 3 failures in a row to go offline; a success in between starts again", () => {
    let s: ConnectionState = INITIAL_CONNECTION
    s = nextConnectionState(s, fail)
    s = nextConnectionState(s, fail)
    expect(s.status).toBe("online")
    s = nextConnectionState(s, ok)
    s = nextConnectionState(s, fail)
    s = nextConnectionState(s, fail)
    expect(s.status).toBe("online")
    s = nextConnectionState(s, fail)
    expect(s).toEqual({ status: "offline", reason: "no-connection", streak: 0 })
  })

  it("needs 2 successes in a row to come back online", () => {
    let s: ConnectionState = { status: "offline", reason: "server-down", streak: 0 }
    s = nextConnectionState(s, ok)
    expect(s.status).toBe("offline")
    s = nextConnectionState(s, fail)
    s = nextConnectionState(s, ok)
    expect(s.status).toBe("offline")
    s = nextConnectionState(s, ok)
    expect(s).toEqual(INITIAL_CONNECTION)
  })
})

describe("classifying signals", () => {
  it("reads /health per the contract and ignores a 404 (no /health before the O1 backend)", () => {
    expect(signalForHealth(200)).toEqual({ ok: true })
    expect(signalForHealth(503)).toEqual({ ok: false, reason: "server-down" })
    expect(signalForHealth(404)).toBeNull()
  })

  it("treats any ordinary answer as reachable, except gateway/unavailable", () => {
    expect(signalForResponse(200)).toEqual({ ok: true })
    expect(signalForResponse(409)).toEqual({ ok: true })
    expect(signalForResponse(401)).toEqual({ ok: true })
    expect(signalForResponse(500)).toBeNull()
    expect(signalForResponse(503)).toEqual({ ok: false, reason: "server-down" })
    expect(signalForError(new TypeError("Failed to fetch"))).toEqual(fail)
    expect(signalForError(new RequestTimeoutError(5000))).toEqual(fail)
    expect(signalForError(new DOMException("aborted", "AbortError"))).toBeNull()
  })
})

describe("ConnectionProvider", () => {
  const fetchMock = vi.fn<typeof fetch>()
  let health: () => Promise<Response>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => health())
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const renderIndicator = () =>
    render(
      <ConnectionProvider>
        <ConnectionIndicator />
      </ConnectionProvider>,
    )
  const label = () => screen.getByRole("status").getAttribute("aria-label")

  it("goes offline only after 3 failed pings, and back after 2 good ones", async () => {
    health = () => Promise.reject(new TypeError("Failed to fetch"))
    renderIndicator()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // first ping
    })
    expect(label()).toBe("Connection: online")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS) // second
    })
    expect(label()).toBe("Connection: online")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS) // third
    })
    expect(label()).toBe("Connection: Offline. Check again")

    health = async () => new Response(JSON.stringify({ status: "UP" }), { status: 200 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OFFLINE_PING_INTERVAL_MS)
    })
    expect(label()).toBe("Connection: Offline. Check again")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OFFLINE_PING_INTERVAL_MS)
    })
    expect(label()).toBe("Connection: online")
  })

  it("shows 'Server unavailable' for 503 DOWN", async () => {
    health = async () => new Response(JSON.stringify({ status: "DOWN" }), { status: 503 })
    renderIndicator()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2)
    })
    expect(label()).toBe("Connection: Server unavailable. Check again")
  })

  it("stays online when /health doesn't exist yet (404)", async () => {
    health = async () => new Response(null, { status: 404 })
    renderIndicator()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 5)
    })
    expect(label()).toBe("Connection: online")
  })

  it("counts request failures, but a burst of parallel failures counts once", async () => {
    health = async () => new Response(null, { status: 404 })
    renderIndicator()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      for (let i = 0; i < 5; i += 1) reportConnectionSignal(fail)
    })
    expect(label()).toBe("Connection: online")

    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500)
        reportConnectionSignal(fail)
      })
    }
    expect(label()).toBe("Connection: Offline. Check again")
  })
})
