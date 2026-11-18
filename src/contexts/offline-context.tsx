"use client"

// O3: keeps the till's offline data current and deletes it when it stops being valid.
// - till-status (public) is read at mount, on sign-in, on a shift change, every 5 minutes online and on reconnect;
//   the deletion rules run only on a fresh answer:
//     not registered (revoked) and something stored  -> everything
//     offlineEnabled false                           -> grant and unlock value
//     no shift, or not the grant's shift             -> grant and unlock value, and the snapshot's accounts
// - The snapshot (any POS session on this till) and the grant (the owner of this till's open shift) follow, never
//   while offlineEnabled is false. Neither counts as session activity on the server.
// - NOT_SHIFT_OWNER is quiet; NO_OPEN_SHIFT, DEVICE_NOT_REGISTERED and OFFLINE_DISABLED delete the grant.
// Nothing here ever blocks or changes an online sale.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useConnection } from "@/contexts/connection-context"
import { useAuth } from "@/hooks/use-auth"
import { useShift } from "@/hooks/use-shift"
import { OfflineErrorCode, type OfflineGrant, type OfflineSnapshot } from "@/lib/offline/contract"
import {
  clearSnapshotAccounts,
  deleteGrantAndUnlock,
  getGrant,
  getMeta,
  getSnapshot,
  getUnlockVerifier,
  offlineStorageStatus,
  onOfflineStorageStatus,
  persistServerTime,
  requestPersistentStorage,
  restoreServerTime,
  setMeta,
  wipeAll,
  type StorageStatus,
} from "@/lib/offline/db"
import { GRANT_DELETING_CODES, grantNeedsRenewal, isGrantValid, requestGrant } from "@/lib/offline/grant-sync"
import { serverNow } from "@/lib/offline/server-time"
import { signedInUserId } from "@/lib/offline/signed-in-user"
import { SNAPSHOT_REFRESH_MS, refreshSnapshot } from "@/lib/offline/snapshot-sync"
import { fetchTillStatus, type TillStatus } from "@/lib/till"

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080"

export interface OfflineContextValue {
  // The last till-status answer; null until one arrives (e.g. a reload while offline).
  tillStatus: TillStatus | null
  storage: StorageStatus
  grant: OfflineGrant | null
  snapshot: OfflineSnapshot | null
  snapshotReceivedAt: string | null
  // The server said NOT_SHIFT_OWNER (e.g. an ADMIN covering): not ready, quietly.
  grantRefused: boolean
  // Runs the sync now (it never runs twice at once).
  refresh: () => void
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export { signedInUserId }

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { authFetch, user, isAuthenticated } = useAuth()
  const { shift } = useShift()
  const { isOnline } = useConnection()

  const [tillStatus, setTillStatus] = useState<TillStatus | null>(null)
  const [storage, setStorage] = useState<StorageStatus>(offlineStorageStatus())
  const [grant, setGrant] = useState<OfflineGrant | null>(null)
  const [snapshot, setSnapshot] = useState<{ snapshot: OfflineSnapshot; receivedAt: string } | null>(null)
  const [grantRefused, setGrantRefused] = useState(false)

  // The latest inputs, for the sync that runs outside render.
  const inputsRef = useRef({ authFetch, user, isAuthenticated, isOnline })
  inputsRef.current = { authFetch, user, isAuthenticated, isOnline }

  // A new user object is a sign-in or resume (a token refresh keeps the same object).
  const signInSeqRef = useRef(0)
  // The sign-in and shift the last grant request was for: one request per sign-in and shift, plus renewals.
  const grantKeyRef = useRef<string | null>(null)
  // The till's shift at the last till-status answer: a change means it closed or another one opened.
  const seenShiftIdRef = useRef<number | null | undefined>(undefined)

  const reloadStored = useCallback(async () => {
    const [storedGrant, storedSnapshot] = await Promise.all([getGrant(), getSnapshot()])
    setGrant(storedGrant?.grant ?? null)
    setSnapshot(storedSnapshot ? { snapshot: storedSnapshot.snapshot, receivedAt: storedSnapshot.receivedAt } : null)
  }, [])

  const runSync = useCallback(async () => {
    const { authFetch, user, isAuthenticated, isOnline } = inputsRef.current
    if (!isOnline) return

    let status: TillStatus
    try {
      status = await fetchTillStatus(API_BASE)
    } catch {
      return // No answer: keep everything.
    }
    setTillStatus(status)
    await setMeta("tillStatus", status)

    const [storedGrant, storedSnapshot, verifier] = await Promise.all([getGrant(), getSnapshot(), getUnlockVerifier()])
    const tillShiftId = status.shift?.shiftId ?? null
    const previousShiftId = seenShiftIdRef.current
    seenShiftIdRef.current = tillShiftId

    if (!status.registered) {
      if (storedGrant || storedSnapshot || verifier) await wipeAll()
      setGrantRefused(false)
      await reloadStored()
      return
    }
    if (!status.offlineEnabled) {
      if (storedGrant || verifier) await deleteGrantAndUnlock()
      setGrantRefused(false)
      await reloadStored()
      return
    }

    const grantForOtherShift = storedGrant !== null && storedGrant.grant.shiftId !== tillShiftId
    const verifierForOtherShift = verifier !== null && verifier.shiftId !== tillShiftId
    if (grantForOtherShift || verifierForOtherShift) await deleteGrantAndUnlock()
    const shiftEnded = previousShiftId !== undefined && previousShiftId !== null && previousShiftId !== tillShiftId
    if (grantForOtherShift || shiftEnded) await clearSnapshotAccounts()

    if (!isAuthenticated) {
      await reloadStored()
      return
    }

    await refreshSnapshot(authFetch, { keepAccounts: status.shift !== null })

    const userId = signedInUserId(user)
    const ownerId = status.shift?.ownerId ?? null
    if (status.shift && userId !== null && ownerId === userId) {
      const current = grantForOtherShift ? null : ((await getGrant())?.grant ?? null)
      const now = serverNow()
      const key = `${signInSeqRef.current}:${status.shift.shiftId}`
      const due =
        grantKeyRef.current !== key ||
        !isGrantValid(current, { shiftId: status.shift.shiftId, ownerId, userId, now }) ||
        grantNeedsRenewal(current, status.maxOfflineHours, now)
      if (due) {
        const result = await requestGrant(authFetch)
        if (result.kind === "ok") {
          grantKeyRef.current = key
          setGrantRefused(false)
        } else if (result.kind === "refused" && result.code === OfflineErrorCode.NOT_SHIFT_OWNER) {
          grantKeyRef.current = key
          setGrantRefused(true)
        } else if (result.kind === "refused" && result.code && GRANT_DELETING_CODES.includes(result.code)) {
          await deleteGrantAndUnlock()
        }
        // No answer or a 5xx: nothing changes; the next sync asks again.
      }
    } else {
      setGrantRefused(false)
    }

    await reloadStored()
  }, [reloadStored])

  // Triggers in the same tick (sign-in, shift and online at mount) make one sync; never two at once: a trigger
  // during a sync runs it once more afterwards.
  const scheduledRef = useRef(false)
  const syncingRef = useRef(false)
  const againRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const sync = useCallback(() => {
    if (scheduledRef.current) return
    scheduledRef.current = true
    queueMicrotask(() => {
      scheduledRef.current = false
      if (!mountedRef.current) return
      if (syncingRef.current) {
        againRef.current = true
        return
      }
      syncingRef.current = true
      void (async () => {
        try {
          do {
            againRef.current = false
            await runSync()
          } while (againRef.current && mountedRef.current)
        } finally {
          syncingRef.current = false
        }
      })()
    })
  }, [runSync])

  // Once: the stored server time offset, persistent storage, and what is already stored.
  useEffect(() => {
    const stopSaving = persistServerTime()
    const stopWatching = onOfflineStorageStatus(setStorage)
    void restoreServerTime()
    void requestPersistentStorage().then(() => setStorage(offlineStorageStatus()))
    void reloadStored()
    // After a reload while offline: the last answer, until a fresh one arrives.
    void getMeta("tillStatus").then((stored) => {
      if (stored) setTillStatus((current) => current ?? stored)
    })
    return () => {
      stopSaving()
      stopWatching()
    }
  }, [reloadStored])

  // Sign-in or resume.
  useEffect(() => {
    if (!user) return
    signInSeqRef.current += 1
    void sync()
  }, [user, sync])

  // Shift opened, closed or changed.
  const shiftId = shift?.id ?? null
  useEffect(() => {
    void sync()
  }, [shiftId, sync])

  // At mount and on reconnect, then every 5 minutes while online.
  useEffect(() => {
    if (!isOnline) return
    void sync()
    const timer = window.setInterval(() => void sync(), SNAPSHOT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [isOnline, sync])

  const value = useMemo<OfflineContextValue>(
    () => ({
      tillStatus,
      storage,
      grant,
      snapshot: snapshot?.snapshot ?? null,
      snapshotReceivedAt: snapshot?.receivedAt ?? null,
      grantRefused,
      refresh: () => void sync(),
    }),
    [tillStatus, storage, grant, snapshot, grantRefused, sync],
  )

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

const NO_OFFLINE: OfflineContextValue = {
  tillStatus: null,
  storage: "unknown",
  grant: null,
  snapshot: null,
  snapshotReceivedAt: null,
  grantRefused: false,
  refresh: () => {},
}

// Outside an OfflineProvider (back office, tests): nothing offline.
export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext) ?? NO_OFFLINE
}
