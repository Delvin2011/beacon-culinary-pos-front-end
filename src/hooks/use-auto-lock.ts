"use client"

// Auto-lock (O2): after idleLockMinutes (from GET /pos/till-status) without pointer, touch or key input, warn for
// 30 s, then do what "Lock till" does. Never while something must finish first (lib/lock-guard): the countdown
// waits, and starts again from the moment the screen is free.

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { isLockBusy, useLockBusy } from "@/lib/lock-guard"
import { DEFAULT_IDLE_LOCK_MINUTES, fetchTillStatus } from "@/lib/till"

export const AUTO_LOCK_WARNING_MS = 30_000
const TICK_MS = 1_000
const ACTIVITY_EVENTS = ["pointerdown", "touchstart", "keydown"] as const

export interface AutoLockState {
  // Seconds left before the lock, while the warning shows; null otherwise.
  warningSecondsLeft: number | null
  staySignedIn: () => void
}

export function useAutoLock(onLocked: () => void): AutoLockState {
  const { isAuthenticated, lockTill } = useAuth()
  const busy = useLockBusy()
  const [idleLockMinutes, setIdleLockMinutes] = useState(DEFAULT_IDLE_LOCK_MINUTES)
  const [warningUntil, setWarningUntilState] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastActivityRef = useRef(Date.now())
  // Kept in step with the state at once, so a tick never reads a value from before the last render.
  const warningUntilRef = useRef<number | null>(null)
  const setWarningUntil = useCallback((value: number | null) => {
    warningUntilRef.current = value
    setWarningUntilState(value)
  }, [])
  const lockingRef = useRef(false)
  const onLockedRef = useRef(onLocked)
  onLockedRef.current = onLocked

  // The limit is the server's setting; until it arrives (or if it can't be read), the default.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    fetchTillStatus()
      .then((status) => {
        if (!cancelled) setIdleLockMinutes(status.idleLockMinutes)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const restart = useCallback(() => {
    lastActivityRef.current = Date.now()
    setWarningUntil(null)
  }, [setWarningUntil])

  // Input counts as activity, except while the warning shows: only "Stay signed in" ends it.
  useEffect(() => {
    if (!isAuthenticated) return
    const onActivity = () => {
      if (warningUntilRef.current === null) lastActivityRef.current = Date.now()
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { capture: true, passive: true })
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity, { capture: true })
    }
  }, [isAuthenticated])

  // Signing in, or something becoming busy, starts the countdown again.
  useEffect(() => {
    if (isAuthenticated) restart()
  }, [isAuthenticated, restart])
  useEffect(() => {
    if (busy) restart()
  }, [busy, restart])

  useEffect(() => {
    if (!isAuthenticated) return
    lockingRef.current = false
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (lockingRef.current) return
      // Postponed: the countdown restarts once the payment, sale, dialog or cash-up has finished.
      if (isLockBusy()) {
        lastActivityRef.current = current
        if (warningUntilRef.current !== null) setWarningUntil(null)
        return
      }
      const until = warningUntilRef.current
      if (until === null) {
        if (current - lastActivityRef.current >= idleLockMinutes * 60_000) setWarningUntil(current + AUTO_LOCK_WARNING_MS)
        return
      }
      if (current >= until) {
        lockingRef.current = true
        setWarningUntil(null)
        void lockTill().then(() => onLockedRef.current())
      }
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [idleLockMinutes, isAuthenticated, lockTill, setWarningUntil])

  return {
    warningSecondsLeft: warningUntil === null ? null : Math.max(0, Math.ceil((warningUntil - now) / 1000)),
    staySignedIn: restart,
  }
}
