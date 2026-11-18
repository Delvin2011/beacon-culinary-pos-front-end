// O4: the status report carries the outbox's waiting sales and the last sync.
import { describe, expect, it, vi } from "vitest"
import { APP_VERSION, buildStatusReport, onStatusReportRequested, requestStatusReport } from "@/lib/offline/heartbeat"

describe("buildStatusReport (O4)", () => {
  it("reports the waiting sales per shift and day, the oldest, and the last sync", () => {
    const now = Date.parse("2026-11-18T13:05:01Z")
    expect(
      buildStatusReport({
        now,
        offlineSince: "2026-11-18T10:00:00Z",
        lastSyncAt: "2026-11-18T13:05:00.000Z",
        pending: {
          pendingCount: 3,
          pending: [{ shiftId: 412, tradingDay: "2026-11-18", count: 3, oldestSoldAt: "2026-11-18T10:42:15.000Z" }],
          oldestPendingSoldAt: "2026-11-18T10:42:15.000Z",
        },
      }),
    ).toEqual({
      pendingCount: 3,
      pending: [{ shiftId: 412, tradingDay: "2026-11-18", count: 3, oldestSoldAt: "2026-11-18T10:42:15.000Z" }],
      oldestPendingSoldAt: "2026-11-18T10:42:15.000Z",
      lastSyncAt: "2026-11-18T13:05:00.000Z",
      offlineSince: "2026-11-18T10:00:00Z",
      tillClockUtc: "2026-11-18T13:05:01.000Z",
      appVersion: APP_VERSION,
    })
  })

  it("an empty outbox reports 0 (OFFLINE_SALES_PENDING clears)", () => {
    expect(buildStatusReport({ pending: { pendingCount: 0, pending: [], oldestPendingSoldAt: null } })).toMatchObject({ pendingCount: 0, pending: [] })
    expect(buildStatusReport({ pending: { pendingCount: 0, pending: [], oldestPendingSoldAt: null } })).not.toHaveProperty("oldestPendingSoldAt")
  })
})

describe("requestStatusReport", () => {
  it("reaches every listener until it unsubscribes", () => {
    const listener = vi.fn()
    const stop = onStatusReportRequested(listener)
    requestStatusReport()
    stop()
    requestStatusReport()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
