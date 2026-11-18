"use client"

// O3: offline readiness for the POS screens, with the time offline (updated every 30 s while offline).

import { useEffect, useMemo, useState } from "react"
import { useConnection } from "@/contexts/connection-context"
import { signedInUserId, useOffline } from "@/contexts/offline-context"
import { useAuth } from "@/hooks/use-auth"
import { getMeta } from "@/lib/offline/db"
import { offlineElapsedMs, offlineReadiness, type OfflineReadiness } from "@/lib/offline/readiness"
import { serverNow } from "@/lib/offline/server-time"

export const READINESS_TICK_MS = 30_000

export function useOfflineReadiness(): { readiness: OfflineReadiness; isOnline: boolean; elapsedMs: number | null } {
  const offline = useOffline()
  const { user } = useAuth()
  const { isOnline } = useConnection()
  const [now, setNow] = useState(() => serverNow())
  // Read from the heartbeat's record while offline; online it doesn't count (the heartbeat clears it soon after).
  const [offlineSince, setOfflineSince] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const tick = () => {
      setNow(serverNow())
      if (isOnline) {
        setOfflineSince(null)
        return
      }
      void getMeta("offlineSince").then((since) => {
        if (alive) setOfflineSince(since)
      })
    }
    tick()
    const timer = window.setInterval(tick, READINESS_TICK_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [isOnline])

  const userId = signedInUserId(user)
  const readiness = useMemo(
    () =>
      offlineReadiness({
        tillStatus: offline.tillStatus,
        userId,
        grant: offline.grant,
        grantRefused: offline.grantRefused,
        snapshot: offline.snapshot,
        storage: offline.storage,
        offlineSince: isOnline ? null : offlineSince,
        now,
      }),
    [offline.tillStatus, offline.grant, offline.grantRefused, offline.snapshot, offline.storage, userId, isOnline, offlineSince, now],
  )

  return { readiness, isOnline, elapsedMs: isOnline ? null : offlineElapsedMs(offlineSince, now) }
}
