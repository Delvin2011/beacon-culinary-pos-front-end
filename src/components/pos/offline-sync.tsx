"use client"

// O4: sends the outbox whenever the till is online, on every POS screen (sign-in included). Shows its progress
// ("Sending 12 offline sales…") and, when sync has stopped, a manager alert. Straight after each batch it asks the
// heartbeat for a status report with the new counts, so the server's OFFLINE_SALES_PENDING clears at 0.
//
// - 5xx / network failure: waits (5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min) and resends the same sales.
// - 403 DEVICE_NOT_REGISTERED: stops until this browser is registered again (registerDevice, or till-status says
//   registered). 400 INVALID_BATCH, 413, 415: a bug in what the till sent; stops until a new app version or a
//   manager's "Try again". The outbox is kept in every case.

import { useCallback, useEffect, useRef, useState } from "react"
import { CloudUpload, TriangleAlert } from "lucide-react"
import { useConnection } from "@/contexts/connection-context"
import { notifyOutboxChanged, useOutbox } from "@/contexts/outbox-context"
import { deleteMeta, getMeta, setMeta } from "@/lib/offline/db"
import { APP_VERSION, requestStatusReport } from "@/lib/offline/heartbeat"
import { isSendable, listOutbox, purgeOldSynced } from "@/lib/offline/outbox"
import { applyResults, buildBatch, retryDelayMs, sendBatch, type SyncStopReason } from "@/lib/offline/sales-sync"
import { recordServerTime, serverNow } from "@/lib/offline/server-time"
import { fetchTillStatus } from "@/lib/till"

type SyncUiState =
  | { kind: "idle" }
  | { kind: "sending"; count: number }
  | { kind: "waiting"; count: number }
  | { kind: "stopped"; reason: SyncStopReason }

const salesText = (count: number) => `${count} offline sale${count === 1 ? "" : "s"}`

export const SYNC_STOP_MESSAGES: Record<SyncStopReason, string> = {
  DEVICE_NOT_REGISTERED:
    "Offline sales can't be sent: this browser isn't a registered till. A manager must register it again on Registered tills. The sales are kept on this till.",
  INVALID_BATCH: "Offline sales couldn't be sent: the server couldn't read what the till sent. Call support. The sales are kept on this till.",
  PAYLOAD_TOO_LARGE: "Offline sales couldn't be sent: the batch was too large. Call support. The sales are kept on this till.",
  UNSUPPORTED_MEDIA_TYPE: "Offline sales couldn't be sent: the server refused the format. Call support. The sales are kept on this till.",
}

// Stopped earlier, and still stopped? A 403 ends once the till is registered; the others with a new app version.
async function stillStopped(): Promise<SyncStopReason | null> {
  const stopped = await getMeta("syncStopped")
  if (!stopped) return null
  if (stopped.reason === "DEVICE_NOT_REGISTERED") {
    try {
      if ((await fetchTillStatus()).registered) {
        await deleteMeta("syncStopped")
        return null
      }
    } catch {
      // No answer: stay stopped for now.
    }
    return stopped.reason
  }
  if (stopped.appVersion !== APP_VERSION) {
    await deleteMeta("syncStopped")
    return null
  }
  return stopped.reason
}

export function OfflineSync() {
  const { isOnline } = useConnection()
  const { entries } = useOutbox()
  const [state, setState] = useState<SyncUiState>({ kind: "idle" })

  const onlineRef = useRef(isOnline)
  onlineRef.current = isOnline
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const attemptRef = useRef(0)
  // After a failure, exactly these sales are sent again.
  const retryIdsRef = useRef<string[] | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const run = useCallback(async () => {
    if (runningRef.current || !onlineRef.current) return
    runningRef.current = true
    try {
      const stopped = await stillStopped()
      if (stopped) {
        if (mountedRef.current) setState({ kind: "stopped", reason: stopped })
        return
      }
      await purgeOldSynced(serverNow())

      while (mountedRef.current && onlineRef.current) {
        const all = await listOutbox()
        const batch = buildBatch(all, new Date().toISOString(), retryIdsRef.current)
        if (!batch) {
          if (retryIdsRef.current !== null) {
            retryIdsRef.current = null
            continue
          }
          break
        }
        setState({ kind: "sending", count: all.filter(isSendable).length })

        const outcome = await sendBatch(batch)
        if (outcome.kind === "stop") {
          await setMeta("syncStopped", { reason: outcome.reason, at: new Date().toISOString(), appVersion: APP_VERSION })
          if (mountedRef.current) setState({ kind: "stopped", reason: outcome.reason })
          return
        }
        if (outcome.kind === "retry") {
          retryIdsRef.current = batch.clientOrderIds
          attemptRef.current += 1
          if (mountedRef.current) {
            setState({ kind: "waiting", count: all.filter(isSendable).length })
            clearTimer()
            timerRef.current = window.setTimeout(() => {
              timerRef.current = null
              void run()
            }, retryDelayMs(attemptRef.current))
          }
          return
        }

        retryIdsRef.current = null
        attemptRef.current = 0
        if (outcome.serverTimeUtc) recordServerTime(outcome.serverTimeUtc)
        const syncedAt = new Date(serverNow()).toISOString()
        const applied = await applyResults(batch, outcome.results, syncedAt)
        await setMeta("lastSyncAt", syncedAt)
        notifyOutboxChanged()
        // The status report with the new counts, straight after the batch.
        requestStatusReport()
        // Nothing in the answer was usable: don't loop on the same sales; try again later.
        if (applied.synced + applied.rejected === 0) {
          attemptRef.current += 1
          clearTimer()
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            void run()
          }, retryDelayMs(attemptRef.current))
          break
        }
      }
      if (mountedRef.current) setState((current) => (current.kind === "waiting" ? current : { kind: "idle" }))
    } finally {
      runningRef.current = false
    }
  }, [])

  const sendable = entries.filter(isSendable).length

  // Online with something to send, and not waiting for a resend: send now.
  useEffect(() => {
    if (!isOnline) {
      clearTimer()
      retryIdsRef.current = null
      attemptRef.current = 0
      setState((current) => (current.kind === "stopped" ? current : { kind: "idle" }))
      return
    }
    if (sendable > 0 && timerRef.current === null) void run()
  }, [isOnline, sendable, run])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [])

  const tryAgain = async () => {
    await deleteMeta("syncStopped")
    setState({ kind: "idle" })
    void run()
  }

  if (state.kind === "stopped" && sendable > 0) {
    return (
      <div role="alert" className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-rose-400/50 bg-rose-950/95 p-4 text-sm text-rose-100 shadow-xl">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1">
          <p>{SYNC_STOP_MESSAGES[state.reason]}</p>
          <p className="mt-1 text-rose-200/80">{salesText(sendable)} waiting.</p>
        </div>
        {state.reason !== "DEVICE_NOT_REGISTERED" && (
          <button
            type="button"
            onClick={() => void tryAgain()}
            className="shrink-0 rounded-lg border border-rose-300/50 px-3 py-1.5 text-xs font-semibold hover:bg-rose-500/20"
          >
            Try again
          </button>
        )}
      </div>
    )
  }
  if (state.kind === "sending" || state.kind === "waiting") {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-slate-900/95 px-4 py-2 text-sm text-sky-100 shadow-lg">
        <CloudUpload className="h-4 w-4" />
        {state.kind === "sending"
          ? `Sending ${salesText(state.count)}…`
          : `${salesText(state.count)} waiting to send. Trying again shortly.`}
      </div>
    )
  }
  return null
}
