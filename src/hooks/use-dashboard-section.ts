"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { sectionPath, type LayoutSection, type SectionEnvelope } from "@/lib/dashboard"

// A refresh that takes longer than this shows "Updating…" on the card (the last numbers stay visible).
const SLOW_REFRESH_MS = 2000

export interface DashboardSectionContextValue {
  // false while the tab is hidden: every timer pauses, and all sections refresh when it shows again.
  visible: boolean
  // Bumped per key to ask a section to refresh now (e.g. after a stock request).
  refreshSignals: Record<string, number>
  requestRefresh: (keys: string[]) => void
  // Each section reports when its figures were computed; the header shows the latest.
  reportAsOf: (key: string, asOf: string) => void
  // 404 / 403: the section was switched off or permissions changed since the layout loaded.
  dropSection: (key: string) => void
  // 400: the range was refused.
  resetRange: () => void
}

export const DashboardSectionContext = createContext<DashboardSectionContextValue | null>(null)

export function useDashboardContext(): DashboardSectionContextValue {
  const context = useContext(DashboardSectionContext)
  if (!context) throw new Error("Dashboard sections must be rendered inside the dashboard.")
  return context
}

export interface SectionState<T> {
  envelope: SectionEnvelope<T> | null
  // First load, nothing to show yet: the card shows a skeleton.
  loading: boolean
  // A refresh is taking a while: the card keeps its numbers and shows "Updating…".
  updating: boolean
  error: string | null
  retry: () => void
}

interface Options {
  // Query parameters for the request (range, sortBy…); undefined values are left out.
  params: Record<string, string | undefined>
  // A 403 that the card can resolve itself (e.g. sortBy=VALUE refused): return true to keep the card.
  onForbidden?: () => boolean
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    for (const key of ["message", "error"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return fallback
}

// Loads one dashboard section and keeps it fresh on its own timer (refreshSeconds from the layout). A failing or
// slow section never affects the others, and a refresh never blanks the card.
export function useDashboardSection<T>(section: LayoutSection, { params, onForbidden }: Options): SectionState<T> {
  const { authFetch } = useAuth()
  const context = useDashboardContext()
  const { visible, refreshSignals } = context
  // The context callbacks are read through a ref so the loader (and its timer) never restarts because of them.
  const contextRef = useRef(context)
  contextRef.current = context
  const [envelope, setEnvelope] = useState<SectionEnvelope<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paramsKey = JSON.stringify(params)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const onForbiddenRef = useRef(onForbidden)
  onForbiddenRef.current = onForbidden
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const controllerRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasDataRef = useRef(false)
  const mountedRef = useRef(true)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const load = useCallback(async () => {
    clearTimer()
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    const slowTimer = setTimeout(() => {
      if (!controller.signal.aborted && hasDataRef.current) setUpdating(true)
    }, SLOW_REFRESH_MS)

    let scheduleNext = true
    try {
      const res = await authFetch(sectionPath(section.key, paramsRef.current), { signal: controller.signal })
      const body = (await res.json().catch(() => null)) as unknown
      if (controller.signal.aborted) return

      if (res.ok && body && typeof body === "object") {
        const next = body as SectionEnvelope<T>
        hasDataRef.current = true
        setEnvelope(next)
        setError(null)
        if (next.asOf) contextRef.current.reportAsOf(section.key, next.asOf)
      } else if (res.status === 404) {
        scheduleNext = false
        contextRef.current.dropSection(section.key)
      } else if (res.status === 403) {
        if (onForbiddenRef.current?.()) return
        scheduleNext = false
        contextRef.current.dropSection(section.key)
      } else if (res.status === 400) {
        contextRef.current.resetRange()
      } else if (res.status === 401) {
        // authFetch has already tried to refresh the session; the page sends the user to sign in.
        scheduleNext = false
        setError("Your session has expired. Please sign in again.")
      } else {
        // 500 { key, error }: the server's error is for the logs; the card says it plainly and offers Retry.
        setError(res.status >= 500 ? "This section couldn't be loaded." : errorMessage(body, "This section couldn't be loaded."))
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return
      setError("This section couldn't be loaded. Check the connection.")
    } finally {
      clearTimeout(slowTimer)
      if (controllerRef.current === controller && mountedRef.current) {
        controllerRef.current = null
        setLoading(false)
        setUpdating(false)
        if (scheduleNext && visibleRef.current) {
          timerRef.current = setTimeout(() => void load(), Math.max(5, section.refreshSeconds || 60) * 1000)
        }
      }
    }
  }, [authFetch, section.key, section.refreshSeconds])

  // First load, and a reload whenever the parameters change (range, sort). The card keeps its numbers meanwhile.
  const refreshSignal = refreshSignals[section.key] ?? 0
  useEffect(() => {
    if (!visibleRef.current) return
    void load()
  }, [load, paramsKey, refreshSignal])

  // Hidden tab: pause the timer and drop any request in flight. Visible again: refresh straight away.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible === wasVisible.current) return
    wasVisible.current = visible
    if (visible) {
      void load()
    } else {
      clearTimer()
      controllerRef.current?.abort()
      controllerRef.current = null
      setUpdating(false)
    }
  }, [visible, load])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      controllerRef.current?.abort()
    }
  }, [])

  const retry = useCallback(() => void load(), [load])

  return { envelope, loading: loading && !envelope, updating, error, retry }
}
