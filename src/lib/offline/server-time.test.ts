// O3: the server time offset, and "today" in Africa/Johannesburg by server time.
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  onServerTimeChange,
  recordServerTime,
  serverNow,
  serverTimeOffsetMs,
  serverToday,
  setServerTimeOffset,
  tradingDayAt,
} from "@/lib/offline/server-time"

afterEach(() => {
  setServerTimeOffset(null)
})

describe("server time", () => {
  it("uses the till's clock until a server time arrives", () => {
    expect(serverTimeOffsetMs()).toBeNull()
    expect(serverNow(1_000)).toBe(1_000)
  })

  it("keeps the offset of the most recent server time", () => {
    const local = Date.parse("2026-11-18T09:15:00Z")
    expect(recordServerTime("2026-11-18T09:15:02Z", local)).toBe(true)
    expect(serverTimeOffsetMs()).toBe(2_000)
    expect(serverNow(local + 500)).toBe(local + 2_500)

    recordServerTime("2026-11-18T09:14:59Z", local)
    expect(serverTimeOffsetMs()).toBe(-1_000)
  })

  it("ignores a missing or unreadable server time", () => {
    recordServerTime("2026-11-18T09:15:02Z", Date.parse("2026-11-18T09:15:00Z"))
    expect(recordServerTime("not a time")).toBe(false)
    expect(recordServerTime(null)).toBe(false)
    expect(serverTimeOffsetMs()).toBe(2_000)
  })

  it("tells listeners when the offset changes", () => {
    const listener = vi.fn()
    const stop = onServerTimeChange(listener)
    recordServerTime("2026-11-18T09:15:02Z", Date.parse("2026-11-18T09:15:00Z"))
    expect(listener).toHaveBeenCalledWith(2_000)
    stop()
    setServerTimeOffset(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("gives the trading day in Johannesburg time", () => {
    // 22:30 UTC is 00:30 the next day in Johannesburg.
    expect(tradingDayAt(Date.parse("2026-11-18T21:59:59Z"))).toBe("2026-11-18")
    expect(tradingDayAt(Date.parse("2026-11-18T22:30:00Z"))).toBe("2026-11-19")
  })

  it("decides today by server time, not by a wrong till clock", () => {
    // The till's clock says 21:50 UTC (23:50 local); the server is 20 minutes ahead (00:10 the next day).
    const local = Date.parse("2026-11-18T21:50:00Z")
    expect(serverToday(local)).toBe("2026-11-18")
    recordServerTime("2026-11-18T22:10:00Z", local)
    expect(serverToday(local)).toBe("2026-11-19")
  })
})
