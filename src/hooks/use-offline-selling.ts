"use client"

// O4: whether the till may sell offline now, for the banner and the order builder. The readiness hook ticks every
// 30 s; a sale re-checks with the current time when it's confirmed.

import { useMemo } from "react"
import { useOffline } from "@/contexts/offline-context"
import { useOfflineReadiness } from "@/hooks/use-offline-readiness"
import { offlineSellingState, type OfflineSellingState } from "@/lib/offline/selling-state"
import { serverNow } from "@/lib/offline/server-time"

export function useOfflineSelling(): { selling: OfflineSellingState; elapsedMs: number | null; isOnline: boolean } {
  const { readiness, isOnline, elapsedMs } = useOfflineReadiness()
  const { grant, snapshot } = useOffline()
  const selling = useMemo(
    () => offlineSellingState({ readiness, isOnline, elapsedMs, grant, snapshot, now: serverNow() }),
    // readiness changes on every tick, so serverNow() is current enough here.
    [readiness, isOnline, elapsedMs, grant, snapshot],
  )
  return { selling, elapsedMs, isOnline }
}
