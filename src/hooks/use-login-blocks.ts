"use client"

import { useCallback, useEffect, useState } from "react"
import { loginBlockMessage, type LoginBlock, type LoginBlockCode } from "@/lib/login-protection"

interface Entry {
  code: LoginBlockCode
  // When the wait ends (ms since epoch); null when there is no time.
  endsAt: number | null
}

export interface LoginBlockState {
  code: LoginBlockCode
  remainingSeconds: number | null
  // True while a countdown is running: the control it belongs to is disabled.
  // A block without a time shows its message but disables nothing.
  active: boolean
  message: string
}

// Countdowns for 429 blocks, one per key (a tile's person ID, or "self" for the signed-in user).
// Memory only. When a countdown reaches zero the entry is removed so the control re-enables;
// nothing is ever sent again automatically.
export function useLoginBlocks<K extends string | number>() {
  const [entries, setEntries] = useState<ReadonlyMap<K, Entry>>(() => new Map())
  const [now, setNow] = useState(() => Date.now())

  const block = useCallback((key: K, loginBlock: LoginBlock) => {
    const at = Date.now()
    setNow(at)
    setEntries((prev) => {
      const next = new Map(prev)
      next.set(key, {
        code: loginBlock.code,
        endsAt: loginBlock.retryAfterSeconds !== null && loginBlock.retryAfterSeconds > 0 ? at + loginBlock.retryAfterSeconds * 1000 : null,
      })
      return next
    })
  }, [])

  const clear = useCallback((key: K) => {
    setEntries((prev) => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  const clearAll = useCallback(() => setEntries((prev) => (prev.size === 0 ? prev : new Map())), [])

  const hasCountdown = Array.from(entries.values()).some((entry) => entry.endsAt !== null)

  useEffect(() => {
    if (!hasCountdown) return
    const timer = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      setEntries((prev) => {
        let changed = false
        const next = new Map(prev)
        prev.forEach((entry, key) => {
          if (entry.endsAt !== null && entry.endsAt <= at) {
            next.delete(key)
            changed = true
          }
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasCountdown])

  const get = useCallback(
    (key: K | null | undefined): LoginBlockState | null => {
      if (key === null || key === undefined) return null
      const entry = entries.get(key)
      if (!entry) return null
      if (entry.endsAt === null) {
        return { code: entry.code, remainingSeconds: null, active: false, message: loginBlockMessage(entry.code, null) }
      }
      const remainingSeconds = Math.ceil((entry.endsAt - now) / 1000)
      if (remainingSeconds <= 0) return null
      return { code: entry.code, remainingSeconds, active: true, message: loginBlockMessage(entry.code, remainingSeconds) }
    },
    [entries, now],
  )

  return { block, clear, clearAll, get }
}
