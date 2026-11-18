"use client"

// O3: the "Offline ready" marker (online) and the offline banner. Both show nothing while offlineEnabled is false.
// Selling offline is O4: in O3 Confirm still waits for the connection.

import { CloudOff, ShieldCheck, TriangleAlert } from "lucide-react"
import { useOfflineReadiness } from "@/hooks/use-offline-readiness"
import { formatElapsed, notReadyMessage } from "@/lib/offline/readiness"

export function OfflineReadyMarker() {
  const { readiness, isOnline } = useOfflineReadiness()
  if (!isOnline || readiness.kind !== "ready") return null
  return (
    <span
      role="status"
      title="This till can keep selling if the connection drops."
      className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-200"
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      Offline ready
    </span>
  )
}

export function OfflineBanner() {
  const { readiness, isOnline, elapsedMs } = useOfflineReadiness()
  if (isOnline || readiness.kind === "off") return null

  if (readiness.kind === "not-ready") {
    return (
      <div role="alert" className="flex items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-sm text-rose-100">
        <CloudOff className="h-4 w-4 shrink-0" />
        <span>Offline. This till can&apos;t sell offline: {notReadyMessage(readiness.reasons[0])}</span>
      </div>
    )
  }

  const { maxOfflineHours, warnOfflineHours } = readiness.limits
  const warn = elapsedMs !== null && elapsedMs >= warnOfflineHours * 3_600_000
  const elapsed = elapsedMs !== null ? ` · ${formatElapsed(elapsedMs)}` : ""
  return (
    <div
      role="status"
      className={
        warn
          ? "flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-6 py-2 text-sm text-amber-100"
          : "flex items-center gap-3 border-b border-sky-500/30 bg-sky-500/10 px-6 py-2 text-sm text-sky-100"
      }
    >
      {warn ? <TriangleAlert className="h-4 w-4 shrink-0" /> : <CloudOff className="h-4 w-4 shrink-0" />}
      <span>
        Offline mode{elapsed}
        {warn && <> · Get back online soon: selling offline stops at {maxOfflineHours} h.</>}
      </span>
    </div>
  )
}
