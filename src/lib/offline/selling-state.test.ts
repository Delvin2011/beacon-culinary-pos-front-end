// O4 task 1: selling offline, the warning and the three stops, on a fake server clock.
import { describe, expect, it } from "vitest"
import { parseGrant, parseSnapshot } from "@/lib/offline/contract"
import { offlineElapsedMs, offlineReadiness } from "@/lib/offline/readiness"
import { STOP_MESSAGES, offlineSellingState, waitingText } from "@/lib/offline/selling-state"
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

const grant = parseGrant(grantBody)
const snapshot = parseSnapshot(snapshotBody())

// The state at server time `at`, offline since `since` (null: online).
function stateAt(at: string, since: string | null, overrides: { grant?: typeof grant; tillStatus?: TillStatus } = {}) {
  const now = Date.parse(at)
  const g = overrides.grant === undefined ? grant : overrides.grant
  const readiness = offlineReadiness({
    tillStatus: overrides.tillStatus ?? tillStatus,
    userId: 17,
    grant: g,
    grantRefused: false,
    snapshot,
    storage: "available",
    offlineSince: since,
    now,
  })
  return offlineSellingState({
    readiness,
    isOnline: since === null,
    elapsedMs: offlineElapsedMs(since, now),
    grant: g,
    snapshot,
    now,
  })
}

describe("offlineSellingState", () => {
  it("online: sales go to the server", () => {
    expect(stateAt("2026-11-18T10:00:00Z", null)).toEqual({ kind: "online" })
  })

  it("offlineEnabled false: off, online or offline", () => {
    const off = { ...tillStatus, offlineEnabled: false }
    expect(stateAt("2026-11-18T10:00:00Z", null, { tillStatus: off })).toEqual({ kind: "off" })
    expect(stateAt("2026-11-18T10:00:00Z", "2026-11-18T09:00:00Z", { tillStatus: off })).toEqual({ kind: "off" })
  })

  it("offline and ready: selling, with no warning before warnOfflineHours", () => {
    expect(stateAt("2026-11-18T13:59:59Z", "2026-11-18T09:00:00Z")).toEqual({
      kind: "selling",
      warn: false,
      limits: { maxOfflineHours: 6, warnOfflineHours: 5 },
    })
  })

  it("warns from warnOfflineHours", () => {
    expect(stateAt("2026-11-18T14:00:00Z", "2026-11-18T09:00:00Z")).toMatchObject({ kind: "selling", warn: true })
  })

  it("stops after maxOfflineHours", () => {
    expect(stateAt("2026-11-18T15:00:00Z", "2026-11-18T09:00:00Z")).toMatchObject({ kind: "selling" })
    expect(stateAt("2026-11-18T15:00:01Z", "2026-11-18T09:00:00Z")).toEqual({
      kind: "stopped",
      reason: "limit",
      message: "Offline limit reached. Reconnect to keep selling.",
    })
  })

  it("stops when the grant's expiresAt has passed", () => {
    const shortGrant = parseGrant({ ...grantBody, expiresAt: "2026-11-18T12:00:00Z" })
    expect(stateAt("2026-11-18T11:59:59Z", "2026-11-18T11:00:00Z", { grant: shortGrant })).toMatchObject({ kind: "selling" })
    expect(stateAt("2026-11-18T12:00:00Z", "2026-11-18T11:00:00Z", { grant: shortGrant })).toEqual({
      kind: "stopped",
      reason: "grant-expired",
      message: STOP_MESSAGES["grant-expired"],
    })
  })

  it("stops at midnight in Johannesburg: the snapshot is for its own trading day only", () => {
    // 2026-11-19 00:00 SAST is 2026-11-18 22:00 UTC.
    expect(stateAt("2026-11-18T21:59:59Z", "2026-11-18T20:00:00Z")).toMatchObject({ kind: "selling" })
    expect(stateAt("2026-11-18T22:00:00Z", "2026-11-18T20:00:00Z")).toEqual({
      kind: "stopped",
      reason: "new-day",
      message: STOP_MESSAGES["new-day"],
    })
  })

  it("names the offline limit first when several stops apply", () => {
    expect(stateAt("2026-11-19T01:00:00Z", "2026-11-18T18:00:00Z")).toMatchObject({ kind: "stopped", reason: "limit" })
  })

  it("never ready offline: O3's first reason", () => {
    expect(stateAt("2026-11-18T10:00:00Z", "2026-11-18T09:00:00Z", { tillStatus: { ...tillStatus, shift: null } })).toEqual({
      kind: "not-ready",
      reason: { kind: "no-shift" },
    })
  })
})

describe("waitingText", () => {
  it("counts sales", () => {
    expect(waitingText(1)).toBe("1 sale waiting to send")
    expect(waitingText(3)).toBe("3 sales waiting to send")
  })
})
