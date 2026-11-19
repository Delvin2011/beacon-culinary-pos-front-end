// O3: offline readiness, one test per rule.
import { describe, expect, it } from "vitest"
import { parseGrant, parseSnapshot } from "@/lib/offline/contract"
import { formatElapsed, notReadyMessage, offlineReadiness, type ReadinessInput } from "@/lib/offline/readiness"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

const ready: ReadinessInput = {
  tillStatus,
  userId: 17,
  grant: parseGrant(grantBody),
  grantRefused: false,
  snapshot: parseSnapshot(snapshotBody()),
  storage: "available",
  offlineSince: null,
  now: Date.parse("2026-11-18T10:00:00Z"),
}

const firstReason = (input: Partial<ReadinessInput>) => {
  const result = offlineReadiness({ ...ready, ...input })
  return result.kind === "not-ready" ? notReadyMessage(result.reasons[0]) : result.kind
}

describe("offline readiness", () => {
  it("is ready when every rule holds", () => {
    expect(offlineReadiness(ready)).toEqual({ kind: "ready", limits: { maxOfflineHours: 6, warnOfflineHours: 5 } })
  })

  it("shows nothing when offline is turned off, or before any till-status is known", () => {
    expect(offlineReadiness({ ...ready, tillStatus: { ...tillStatus, offlineEnabled: false } }).kind).toBe("off")
    expect(offlineReadiness({ ...ready, tillStatus: null }).kind).toBe("off")
  })

  it("not registered", () => {
    expect(firstReason({ tillStatus: { ...tillStatus, registered: false } })).toBe("this till isn't registered")
  })

  it("no open shift", () => {
    expect(firstReason({ tillStatus: { ...tillStatus, shift: null } })).toBe("no shift is open on this till")
  })

  it("the shift isn't the signed-in cashier's", () => {
    expect(firstReason({ userId: 1 })).toBe("only Thandi Mokoena can sell offline on this shift")
    expect(firstReason({ userId: null })).toBe("only Thandi Mokoena can sell offline on this shift")
  })

  it("the server said NOT_SHIFT_OWNER", () => {
    expect(firstReason({ grantRefused: true })).toBe("only Thandi Mokoena can sell offline on this shift")
  })

  it("no valid grant: none, another shift's, or expired by server time", () => {
    const message = "it has no offline permission for this shift. Sign in again while online."
    expect(firstReason({ grant: null })).toBe(message)
    expect(firstReason({ grant: parseGrant({ ...grantBody, shiftId: 411 }) })).toBe(message)
    expect(firstReason({ now: Date.parse("2026-11-19T00:03:00Z") })).toBe(message)
  })

  it("no snapshot, or only yesterday's (by server time)", () => {
    expect(firstReason({ snapshot: null })).toBe("today's menu hasn't been downloaded")
    expect(firstReason({ snapshot: parseSnapshot({ ...snapshotBody(), tradingDay: "2026-11-17" }) })).toBe(
      "today's menu hasn't been downloaded",
    )
  })

  it("storage unavailable", () => {
    expect(firstReason({ storage: "unavailable" })).toBe("this browser can't store offline data")
  })

  it("offline for longer than maxOfflineHours", () => {
    expect(firstReason({ offlineSince: "2026-11-18T04:30:00Z" })).toBe("ready")
    expect(firstReason({ offlineSince: "2026-11-18T03:59:00Z" })).toBe("offline for more than 6 hours")
  })

  it("takes the limits from the grant once it has one, else from till-status", () => {
    const result = offlineReadiness({ ...ready, grant: parseGrant({ ...grantBody, maxOfflineHours: 4, warnOfflineHours: 3 }) })
    expect(result.kind === "ready" && result.limits).toEqual({ maxOfflineHours: 4, warnOfflineHours: 3 })
    const before = offlineReadiness({ ...ready, grant: null, snapshot: null, tillStatus: { ...tillStatus, maxOfflineHours: 8 } })
    expect(before.kind === "not-ready" && before.limits.maxOfflineHours).toBe(8)
  })

  it("formats the time offline", () => {
    expect(formatElapsed(45 * 60_000)).toBe("45 min")
    expect(formatElapsed(65 * 60_000)).toBe("1 h 05 min")
  })
})
