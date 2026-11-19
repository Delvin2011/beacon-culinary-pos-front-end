"use client"

// O3 (D13): can this till be unlocked offline, and by whom? Read from the till's own storage (no server):
// a check value bound to the saved till-status's shift, a valid grant for it (by server time), offline on and the
// till registered, and fewer than 5 wrong tries since the till was last online.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { getGrant, getMeta, getUnlockVerifier, setMeta } from "@/lib/offline/db"
import { isGrantValid } from "@/lib/offline/grant-sync"
import { serverNow } from "@/lib/offline/server-time"
import { MAX_UNLOCK_FAILURES, checkUnlockPin, recordUnlockFailure, unlockFailures, webCryptoAvailable } from "@/lib/offline/unlock"

export interface OfflineUnlockOwner {
  cashierId: number
  name: string
  role?: string
}

export type OfflineUnlockState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "available"; owner: OfflineUnlockOwner; triesLeft: number }
  | { state: "disabled"; owner: OfflineUnlockOwner }

export type UnlockResult = "unlocked" | "wrong" | "disabled" | "unavailable"

export async function readOfflineUnlock(): Promise<OfflineUnlockState> {
  if (!webCryptoAvailable()) return { state: "unavailable" }
  const [verifier, stored, tillStatus, lastShift, failures] = await Promise.all([
    getUnlockVerifier(),
    getGrant(),
    getMeta("tillStatus"),
    getMeta("lastShift"),
    unlockFailures(),
  ])
  if (!verifier || verifier.shiftId === null || !tillStatus?.offlineEnabled || !tillStatus.registered) return { state: "unavailable" }
  if (tillStatus.shift?.shiftId !== verifier.shiftId) return { state: "unavailable" }
  const grant = stored?.grant ?? null
  const valid = isGrantValid(grant, {
    shiftId: verifier.shiftId,
    ownerId: verifier.userId,
    userId: verifier.userId,
    now: serverNow(),
  })
  if (!valid || !grant) return { state: "unavailable" }
  const owner: OfflineUnlockOwner = {
    cashierId: grant.cashierId,
    name: grant.cashierName || tillStatus.shift.ownerName,
    role: lastShift?.id === verifier.shiftId ? lastShift.owner.role : undefined,
  }
  if (failures >= MAX_UNLOCK_FAILURES) return { state: "disabled", owner }
  return { state: "available", owner, triesLeft: MAX_UNLOCK_FAILURES - failures }
}

export function useOfflineUnlock(active: boolean): OfflineUnlockState & { unlock: (pin: string) => Promise<UnlockResult> } {
  const { startOfflineSession } = useAuth()
  const [state, setState] = useState<OfflineUnlockState>({ state: "loading" })

  useEffect(() => {
    if (!active) {
      setState({ state: "loading" })
      return
    }
    let alive = true
    void readOfflineUnlock().then((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
    }
  }, [active])

  const unlock = useCallback(
    async (pin: string): Promise<UnlockResult> => {
      const current = await readOfflineUnlock()
      if (current.state === "disabled") {
        setState(current)
        return "disabled"
      }
      if (current.state !== "available") {
        setState(current)
        return "unavailable"
      }
      const verifier = await getUnlockVerifier()
      if (verifier && (await checkUnlockPin(pin, verifier))) {
        await setMeta("unlockFailures", 0)
        startOfflineSession(current.owner)
        return "unlocked"
      }
      const failures = await recordUnlockFailure()
      const next: OfflineUnlockState =
        failures >= MAX_UNLOCK_FAILURES
          ? { state: "disabled", owner: current.owner }
          : { state: "available", owner: current.owner, triesLeft: MAX_UNLOCK_FAILURES - failures }
      setState(next)
      return next.state === "disabled" ? "disabled" : "wrong"
    },
    [startOfflineSession],
  )

  return { ...state, unlock }
}
