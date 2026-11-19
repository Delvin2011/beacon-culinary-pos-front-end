"use client"

// O3: the status heartbeat (contract 9) and offlineSince. Mounted on every POS screen; renders nothing.
// - Sends at mount, every 60 s while online, and at once when the connection comes back. Never while offline.
// - Owns offlineSince: recorded (server time) when the till goes offline, unless already set, so a reload while
//   offline keeps the start; sent with the first report after reconnecting and cleared once that report succeeds.
// - DEVICE_NOT_REGISTERED stops it (kept across reloads) until this browser registers or till-status says registered.

import { useCallback, useEffect, useRef } from "react"
import { useConnection } from "@/contexts/connection-context"
import { deleteMeta, getMeta, setMeta } from "@/lib/offline/db"
import { HEARTBEAT_INTERVAL_MS, buildStatusReport, onStatusReportRequested, sendStatusReport } from "@/lib/offline/heartbeat"
import { listOutbox, pendingSummary } from "@/lib/offline/outbox"
import { recordServerTime, serverNow } from "@/lib/offline/server-time"
import { fetchTillStatus } from "@/lib/till"

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080"

async function loadStopped(): Promise<boolean> {
  if ((await getMeta("heartbeatStopped")) !== true) return false
  // Stopped earlier: registered since (another way than this browser's devices page)?
  try {
    const status = await fetchTillStatus(API_BASE)
    if (status.registered) {
      await deleteMeta("heartbeatStopped")
      return false
    }
  } catch {
    // No answer: stay stopped until the next load.
  }
  return true
}

export function OfflineHeartbeat() {
  const { isOnline } = useConnection()
  const onlineRef = useRef(isOnline)
  onlineRef.current = isOnline
  const stoppedRef = useRef<Promise<boolean> | null>(null)
  const sendingRef = useRef(false)
  // O4: a report asked for while one is out: one more goes straight after, so the latest counts always reach the server.
  const againRef = useRef(false)

  const send = useCallback(async (): Promise<void> => {
    if (sendingRef.current) {
      againRef.current = true
      return
    }
    sendingRef.current = true
    try {
      stoppedRef.current ??= loadStopped()
      if (await stoppedRef.current) return

      // O4: the outbox's waiting sales and the last sync.
      const [offlineSince, entries, lastSyncAt] = await Promise.all([getMeta("offlineSince"), listOutbox(), getMeta("lastSyncAt")])
      const result = await sendStatusReport(API_BASE, buildStatusReport({ offlineSince, pending: pendingSummary(entries), lastSyncAt }))
      if (result.kind === "not-registered") {
        stoppedRef.current = Promise.resolve(true)
        await setMeta("heartbeatStopped", true)
        return
      }
      if (result.kind !== "ok") return

      const reply = result.reply
      if (reply?.serverTimeUtc) recordServerTime(reply.serverTimeUtc)
      await setMeta("lastStatusAt", reply?.receivedAt ?? new Date().toISOString())
      if (typeof reply?.clockSkewMs === "number") await setMeta("clockSkewMs", reply.clockSkewMs)
      // The outage it reported is over, unless the till went offline again (a newer start) meanwhile.
      if (offlineSince && onlineRef.current && (await getMeta("offlineSince")) === offlineSince) {
        await deleteMeta("offlineSince")
      }
    } finally {
      sendingRef.current = false
    }
    if (againRef.current) {
      againRef.current = false
      if (onlineRef.current) await send()
    }
  }, [])

  // O4: sync asks for a report straight after each batch.
  useEffect(() => onStatusReportRequested(() => {
    if (onlineRef.current) void send()
  }), [send])

  useEffect(() => {
    if (!isOnline) {
      void (async () => {
        if (!(await getMeta("offlineSince"))) await setMeta("offlineSince", new Date(serverNow()).toISOString())
      })()
      return
    }
    void send()
    const timer = window.setInterval(() => void send(), HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isOnline, send])

  return null
}
