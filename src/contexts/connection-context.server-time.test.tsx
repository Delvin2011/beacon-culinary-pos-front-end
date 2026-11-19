// O3: the /health ping also records the server's clock ({status, serverTimeUtc}).
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionProvider } from "@/contexts/connection-context"
import { serverTimeOffsetMs, setServerTimeOffset } from "@/lib/offline/server-time"

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-18T09:15:00Z"))
  setServerTimeOffset(null)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setServerTimeOffset(null)
})

async function ping(response: Response) {
  fetchMock.mockResolvedValue(response)
  render(<ConnectionProvider>{null}</ConnectionProvider>)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe("server time from /health", () => {
  it("records serverTimeUtc from a 200", async () => {
    await ping(new Response(JSON.stringify({ status: "UP", serverTimeUtc: "2026-11-18T09:15:03Z" }), { status: 200 }))
    expect(serverTimeOffsetMs()).toBe(3_000)
  })

  it("ignores a body without a server time (a pre-O3 server)", async () => {
    await ping(new Response(JSON.stringify({ status: "UP" }), { status: 200 }))
    expect(serverTimeOffsetMs()).toBeNull()
  })

  it("ignores a 404 page", async () => {
    await ping(new Response("<html></html>", { status: 404 }))
    expect(serverTimeOffsetMs()).toBeNull()
  })
})
