// O3: is this till ready to sell offline? A pure function of what the till knows; every rule must hold.
// The reasons are in the prompt's order, and the banner shows the first. With offlineEnabled false (or no
// till-status yet) nothing offline is shown at all: the till behaves as before O3.

import type { OfflineGrant, OfflineSnapshot } from "@/lib/offline/contract"
import type { StorageStatus } from "@/lib/offline/db"
import { isGrantValid } from "@/lib/offline/grant-sync"
import { parseUtcTimestamp } from "@/lib/receipt"
import { tradingDayAt } from "@/lib/offline/server-time"
import { DEFAULT_MAX_OFFLINE_HOURS, DEFAULT_WARN_OFFLINE_HOURS, type TillStatus } from "@/lib/till"

export type NotReadyReason =
  | { kind: "not-registered" }
  | { kind: "no-shift" }
  | { kind: "not-shift-owner"; ownerName: string | null }
  | { kind: "no-grant" }
  | { kind: "no-snapshot" }
  | { kind: "storage-unavailable" }
  | { kind: "offline-too-long"; maxOfflineHours: number }

export interface OfflineLimits {
  maxOfflineHours: number
  warnOfflineHours: number
}

export type OfflineReadiness =
  // offlineEnabled false, or no till-status known: show nothing.
  | { kind: "off" }
  | { kind: "ready"; limits: OfflineLimits }
  | { kind: "not-ready"; reasons: NotReadyReason[]; limits: OfflineLimits }

export interface ReadinessInput {
  tillStatus: TillStatus | null
  userId: number | null
  grant: OfflineGrant | null
  grantRefused: boolean
  snapshot: OfflineSnapshot | null
  storage: StorageStatus
  // Set while offline (the heartbeat records it).
  offlineSince: string | null
  // Server time, ms.
  now: number
}

// The grant's and snapshot's limits once the till has them, else till-status's (before sign-in).
export function offlineLimits(input: Pick<ReadinessInput, "tillStatus" | "grant" | "snapshot">): OfflineLimits {
  const { tillStatus, grant, snapshot } = input
  return {
    maxOfflineHours:
      grant?.maxOfflineHours ?? snapshot?.limits?.maxOfflineHours ?? tillStatus?.maxOfflineHours ?? DEFAULT_MAX_OFFLINE_HOURS,
    warnOfflineHours:
      grant?.warnOfflineHours ?? snapshot?.limits?.warnOfflineHours ?? tillStatus?.warnOfflineHours ?? DEFAULT_WARN_OFFLINE_HOURS,
  }
}

export function offlineElapsedMs(offlineSince: string | null, now: number): number | null {
  const since = parseUtcTimestamp(offlineSince)
  return since ? Math.max(0, now - since.getTime()) : null
}

export function offlineReadiness(input: ReadinessInput): OfflineReadiness {
  const { tillStatus, userId, grant, grantRefused, snapshot, storage, offlineSince, now } = input
  if (!tillStatus || !tillStatus.offlineEnabled) return { kind: "off" }
  const limits = offlineLimits(input)
  const reasons: NotReadyReason[] = []
  const shift = tillStatus.shift

  if (!tillStatus.registered) reasons.push({ kind: "not-registered" })
  if (!shift) reasons.push({ kind: "no-shift" })
  else if (userId === null || shift.ownerId !== userId || grantRefused) {
    reasons.push({ kind: "not-shift-owner", ownerName: shift.ownerName ?? null })
  }
  if (!isGrantValid(grant, { shiftId: shift?.shiftId ?? null, ownerId: shift?.ownerId ?? null, userId, now })) {
    reasons.push({ kind: "no-grant" })
  }
  if (!snapshot || snapshot.tradingDay !== tradingDayAt(now)) reasons.push({ kind: "no-snapshot" })
  if (storage !== "available") reasons.push({ kind: "storage-unavailable" })
  const elapsed = offlineElapsedMs(offlineSince, now)
  if (elapsed !== null && elapsed > limits.maxOfflineHours * 3_600_000) {
    reasons.push({ kind: "offline-too-long", maxOfflineHours: limits.maxOfflineHours })
  }

  return reasons.length === 0 ? { kind: "ready", limits } : { kind: "not-ready", reasons, limits }
}

const hoursText = (hours: number) => `${hours} hour${hours === 1 ? "" : "s"}`

// The text after "This till can't sell offline: ".
export function notReadyMessage(reason: NotReadyReason): string {
  switch (reason.kind) {
    case "not-registered":
      return "this till isn't registered"
    case "no-shift":
      return "no shift is open on this till"
    case "not-shift-owner":
      return reason.ownerName ? `only ${reason.ownerName} can sell offline on this shift` : "only the shift's owner can sell offline"
    case "no-grant":
      return "it has no offline permission for this shift. Sign in again while online."
    case "no-snapshot":
      return "today's menu hasn't been downloaded"
    case "storage-unavailable":
      return "this browser can't store offline data"
    case "offline-too-long":
      return `offline for more than ${hoursText(reason.maxOfflineHours)}`
  }
}

// "45 min", "1 h 05 min".
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`
}
