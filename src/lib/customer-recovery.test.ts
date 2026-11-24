// T1-3: while suspended, the only call is one /health check every 60 s ± 15 s; the suspension ends on its own when
// /health no longer answers CUSTOMER_SUSPENDED.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetApiFetch } from "@/lib/api-fetch"
import { checkCustomerNow, recoveryDelay, startRecoveryChecks } from "@/lib/customer-recovery"
import { getCustomerStatus, noteCustomerAnswer, resetCustomerStatus } from "@/lib/customer-status"

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const suspendedAnswer = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
const paths = () => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(async () => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  await noteCustomerAnswer(suspendedAnswer())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetCustomerStatus()
  resetApiFetch()
})

describe("recoveryDelay", () => {
  it("is 60 s ± 15 s", () => {
    expect(recoveryDelay(() => 0)).toBe(45_000)
    expect(recoveryDelay(() => 0.5)).toBe(60_000)
    expect(recoveryDelay(() => 0.999999)).toBe(75_000)
    for (let i = 0; i < 200; i += 1) {
      const delay = recoveryDelay()
      expect(delay).toBeGreaterThanOrEqual(45_000)
      expect(delay).toBeLessThanOrEqual(75_000)
    }
  })
})

describe("startRecoveryChecks", () => {
  it("checks /health once per delay while suspended, and nothing else", async () => {
    fetchMock.mockImplementation(async () => suspendedAnswer())
    const stop = startRecoveryChecks(() => 0.5)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(paths()).toEqual(["/api/health"])
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(paths()).toEqual(["/api/health", "/api/health", "/api/health", "/api/health"])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "omit", cache: "no-store" })
    expect(getCustomerStatus().suspended).toBe(true)
    stop()
  })

  it("ends the suspension when /health answers 200, then stops checking", async () => {
    fetchMock.mockResolvedValueOnce(suspendedAnswer()).mockResolvedValue(json(200, { status: "UP" }))
    const stop = startRecoveryChecks(() => 0)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(getCustomerStatus().suspended).toBe(true)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(getCustomerStatus().suspended).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(paths()).toHaveLength(2)
    stop()
  })

  it("ends the suspension on 503 CUSTOMER_UNAVAILABLE (then an outage)", async () => {
    fetchMock.mockResolvedValue(json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" }))
    const stop = startRecoveryChecks(() => 0.5)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getCustomerStatus()).toMatchObject({ suspended: false, unavailable: true })
    stop()
  })

  it("stays suspended when /health doesn't answer, and keeps checking", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const stop = startRecoveryChecks(() => 0.5)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(paths()).toHaveLength(2)
    expect(getCustomerStatus().suspended).toBe(true)
    stop()
  })

  it("starts checking when a suspension begins later, and stops when told to", async () => {
    resetCustomerStatus()
    fetchMock.mockImplementation(async () => suspendedAnswer())
    const stop = startRecoveryChecks(() => 0.5)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    await noteCustomerAnswer(suspendedAnswer())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(paths()).toHaveLength(1)
    stop()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(paths()).toHaveLength(1)
  })
})

describe("checkCustomerNow (Try again)", () => {
  it("checks /health at once, even while suspended", async () => {
    fetchMock.mockResolvedValue(json(200, { status: "UP" }))
    await checkCustomerNow()
    expect(paths()).toEqual(["/api/health"])
    expect(getCustomerStatus().suspended).toBe(false)
  })
})
