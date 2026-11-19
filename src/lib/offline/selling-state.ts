// O4 task 1: may the till sell offline right now? Built on O3's readiness, which already holds the stops (the
// offline limit, a grant no longer valid, a snapshot of another trading day). This names the three stops the
// cashier must understand, each with its own reason, and adds the warning from warnOfflineHours.

import type { OfflineGrant, OfflineSnapshot } from "@/lib/offline/contract"
import type { NotReadyReason, OfflineLimits, OfflineReadiness } from "@/lib/offline/readiness"
import { tradingDayAt } from "@/lib/offline/server-time"

const HOUR_MS = 3_600_000

export type StopReason = "limit" | "grant-expired" | "new-day"

export const STOP_MESSAGES: Record<StopReason, string> = {
  limit: "Offline limit reached. Reconnect to keep selling.",
  "grant-expired": "This till's offline permission has expired. Reconnect to keep selling.",
  "new-day": "A new trading day has started and the offline menu is for the previous day. Reconnect to keep selling.",
}

export type OfflineSellingState =
  // offlineEnabled false (or no till-status yet): the till behaves as before O3.
  | { kind: "off" }
  // Online: sales go to the server as usual.
  | { kind: "online" }
  // Offline and allowed to sell. warn: from warnOfflineHours on.
  | { kind: "selling"; warn: boolean; limits: OfflineLimits }
  // Offline, was able to sell, and a limit has stopped it.
  | { kind: "stopped"; reason: StopReason; message: string }
  // Offline and never ready (no shift, no grant, …): O3's reason.
  | { kind: "not-ready"; reason: NotReadyReason }

export interface SellingInput {
  readiness: OfflineReadiness
  isOnline: boolean
  // Time offline (null when unknown).
  elapsedMs: number | null
  grant: OfflineGrant | null
  snapshot: OfflineSnapshot | null
  // Server time, ms.
  now: number
}

// The stop that applies, in this order: the offline limit, the grant's expiry, midnight.
export function stopReason(input: Omit<SellingInput, "readiness" | "isOnline"> & { limits: OfflineLimits }): StopReason | null {
  const { elapsedMs, grant, snapshot, now, limits } = input
  if (elapsedMs !== null && elapsedMs > limits.maxOfflineHours * HOUR_MS) return "limit"
  if (grant && Date.parse(grant.expiresAt) <= now) return "grant-expired"
  if (snapshot && snapshot.tradingDay < tradingDayAt(now)) return "new-day"
  return null
}

export function offlineSellingState(input: SellingInput): OfflineSellingState {
  const { readiness, isOnline, elapsedMs } = input
  if (readiness.kind === "off") return { kind: "off" }
  if (isOnline) return { kind: "online" }

  const stop = stopReason({ ...input, limits: readiness.limits })
  if (stop) return { kind: "stopped", reason: stop, message: STOP_MESSAGES[stop] }
  if (readiness.kind === "not-ready") return { kind: "not-ready", reason: readiness.reasons[0] }

  const warn = elapsedMs !== null && elapsedMs >= readiness.limits.warnOfflineHours * HOUR_MS
  return { kind: "selling", warn, limits: readiness.limits }
}

// "1 sale waiting to send", "3 sales waiting to send".
export function waitingText(count: number): string {
  return `${count} sale${count === 1 ? "" : "s"} waiting to send`
}
