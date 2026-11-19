"use client"

// O3: the "Offline ready" marker (online) and the offline banner. Both show nothing while offlineEnabled is false.
// O4: the banner shows the sales waiting to send, the warning from warnOfflineHours, and why selling has stopped
// (the offline limit, the grant's expiry, midnight).

import { CloudOff, ShieldCheck, TriangleAlert } from "lucide-react"
import { useOutbox } from "@/contexts/outbox-context"
import { useOfflineReadiness } from "@/hooks/use-offline-readiness"
import { useOfflineSelling } from "@/hooks/use-offline-selling"
import { formatElapsed, notReadyMessage } from "@/lib/offline/readiness"
import { waitingText } from "@/lib/offline/selling-state"

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

const STOPPED_CLASSES = "flex items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-sm text-rose-100"

export function OfflineBanner() {
  const { selling, isOnline, elapsedMs } = useOfflineSelling()
  const { summary } = useOutbox()
  if (isOnline || selling.kind === "off" || selling.kind === "online") return null

  if (selling.kind === "not-ready") {
    return (
      <div role="alert" className={STOPPED_CLASSES}>
        <CloudOff className="h-4 w-4 shrink-0" />
        <span>Offline. This till can&apos;t sell offline: {notReadyMessage(selling.reason)}</span>
      </div>
    )
  }

  const elapsed = elapsedMs !== null ? ` · ${formatElapsed(elapsedMs)}` : ""
  const waiting = summary.pendingCount > 0 ? ` · ${waitingText(summary.pendingCount)}` : ""

  if (selling.kind === "stopped") {
    return (
      <div role="alert" className={STOPPED_CLASSES}>
        <CloudOff className="h-4 w-4 shrink-0" />
        <span>
          Offline{elapsed}
          {waiting}. {selling.message}
        </span>
      </div>
    )
  }

  const { warn } = selling
  const { maxOfflineHours } = selling.limits
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
        {waiting}
        {warn && <> · Get back online soon: selling offline stops at {maxOfflineHours} h.</>}
      </span>
    </div>
  )
}
