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

export const HEARTBEAT_INTERVAL_MS = 60_000

// The build id (next.config.mjs), at most 50 characters.
export const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, APP_VERSION_MAX_LENGTH)

// pendingCount and pending stay 0 and [] until O4; lastSyncAt is O4's.
export function buildStatusReport({ offlineSince, now = Date.now() }: { offlineSince?: string | null; now?: number }): StatusReport {
  const report: StatusReport = { pendingCount: 0, pending: [], tillClockUtc: new Date(now).toISOString(), appVersion: APP_VERSION }
  if (offlineSince) report.offlineSince = offlineSince
  return report
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
