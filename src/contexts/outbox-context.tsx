"use client"

// O4: the outbox as the POS screens see it: every entry and the waiting counts, read again whenever something
// changes it. Code outside React (the sale recorder, sync) calls notifyOutboxChanged().

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { listOutbox, pendingSummary, type OutboxEntry, type PendingSummary } from "@/lib/offline/outbox"

const listeners = new Set<() => void>()

// Something wrote to the outbox: every mounted provider reads it again.
export function notifyOutboxChanged(): void {
  for (const listener of Array.from(listeners)) listener()
}

export interface OutboxContextValue {
  entries: OutboxEntry[]
  // False until the first read finishes.
  loaded: boolean
  summary: PendingSummary
  refresh: () => Promise<void>
}

const EMPTY_SUMMARY: PendingSummary = { pendingCount: 0, pending: [], oldestPendingSoldAt: null }

const NO_OUTBOX: OutboxContextValue = { entries: [], loaded: false, summary: EMPTY_SUMMARY, refresh: async () => {} }

const OutboxContext = createContext<OutboxContextValue | null>(null)

export function OutboxProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<OutboxEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const mountedRef = useRef(true)
  // Reads never overlap; a change during a read schedules one more.
  const readingRef = useRef<Promise<void> | null>(null)
  const againRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (readingRef.current) {
      againRef.current = true
      return readingRef.current
    }
    const run = async () => {
      do {
        againRef.current = false
        const list = await listOutbox()
        if (!mountedRef.current) return
        setEntries(list)
        setLoaded(true)
      } while (againRef.current)
    }
    readingRef.current = run().finally(() => {
      readingRef.current = null
    })
    return readingRef.current
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const listener = () => void refresh()
    listeners.add(listener)
    void refresh()
    return () => {
      mountedRef.current = false
      listeners.delete(listener)
    }
  }, [refresh])

  const value = useMemo<OutboxContextValue>(
    () => ({ entries, loaded, summary: pendingSummary(entries), refresh }),
    [entries, loaded, refresh],
  )
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>
}

// Outside the POS (or in tests without the provider): an empty outbox.
export function useOutbox(): OutboxContextValue {
  return useContext(OutboxContext) ?? NO_OUTBOX
}
