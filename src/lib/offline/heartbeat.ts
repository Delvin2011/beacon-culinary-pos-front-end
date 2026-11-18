// O3: the till's status report (contract 9). Authenticated by the till cookie only: no bearer token, so it keeps
// working signed out, locked, unlocked offline, and whatever offlineEnabled says.

import { readApiError } from "@/lib/api-error"
import { fetchWithTimeout, timeoutFor } from "@/lib/net"
import {
  APP_VERSION_MAX_LENGTH,
  OfflineErrorCode,
  parseStatusReply,
  type StatusReply,
  type StatusReport,
} from "@/lib/offline/contract"
import type { PendingSummary } from "@/lib/offline/outbox"

export const HEARTBEAT_INTERVAL_MS = 60_000

// The build id (next.config.mjs), at most 50 characters.
export const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, APP_VERSION_MAX_LENGTH)

// O4: the outbox's waiting sales (outbox.pendingSummary) and when the last sales batch was answered.
export function buildStatusReport({
  offlineSince,
  now = Date.now(),
  pending,
  lastSyncAt,
}: {
  offlineSince?: string | null
  now?: number
  pending?: PendingSummary
  lastSyncAt?: string | null
}): StatusReport {
  const report: StatusReport = {
    pendingCount: pending?.pendingCount ?? 0,
    pending: (pending?.pending ?? []).map(({ shiftId, tradingDay, count, oldestSoldAt }) => ({ shiftId, tradingDay, count, oldestSoldAt })),
    tillClockUtc: new Date(now).toISOString(),
    appVersion: APP_VERSION,
  }
  if (pending?.oldestPendingSoldAt) report.oldestPendingSoldAt = pending.oldestPendingSoldAt
  if (lastSyncAt) report.lastSyncAt = lastSyncAt
  if (offlineSince) report.offlineSince = offlineSince
  return report
}

// O4: sync asks for a report straight after each batch; the heartbeat sends it.
const reportListeners = new Set<() => void>()

export function requestStatusReport(): void {
  for (const listener of Array.from(reportListeners)) listener()
}

export function onStatusReportRequested(listener: () => void): () => void {
  reportListeners.add(listener)
  return () => {
    reportListeners.delete(listener)
  }
}

export type StatusResult = { kind: "ok"; reply: StatusReply | null } | { kind: "not-registered" } | { kind: "failed" }

export async function sendStatusReport(apiBase: string, report: StatusReport): Promise<StatusResult> {
  const url = `${apiBase}/pos/offline/status`
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      },
      timeoutFor(url, "POST"),
    )
    if (res.ok) return { kind: "ok", reply: parseStatusReply(await res.json().catch(() => null)) }
    const { code } = await readApiError(res)
    return code === OfflineErrorCode.DEVICE_NOT_REGISTERED ? { kind: "not-registered" } : { kind: "failed" }
  } catch {
    return { kind: "failed" }
  }
}
