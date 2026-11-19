// O3: the server's clock as seen from this till. The offset comes from the most recent serverTimeUtc received
// (GET /health, the grant, the snapshot or the status reply) and is used for "today", grant expiry and, in O4,
// sale timestamps. The till's own clock may be wrong; nothing offline trusts it on its own.

import { parseUtcTimestamp } from "@/lib/receipt"

export const TRADING_TIME_ZONE = "Africa/Johannesburg"

// server clock − till clock, in ms; null until the first server time arrives.
let offsetMs: number | null = null
const listeners = new Set<(offset: number | null) => void>()

function emit() {
  for (const listener of Array.from(listeners)) listener(offsetMs)
}

// Records a server timestamp received now. Returns false (and changes nothing) when it can't be read.
export function recordServerTime(serverTimeUtc: string | null | undefined, localNow: number = Date.now()): boolean {
  const server = parseUtcTimestamp(serverTimeUtc ?? null)
  if (!server) return false
  offsetMs = server.getTime() - localNow
  emit()
  return true
}

export function serverTimeOffsetMs(): number | null {
  return offsetMs
}

// Restores a stored offset (IndexedDB, step 2) and resets it in tests.
export function setServerTimeOffset(value: number | null): void {
  offsetMs = value
  emit()
}

export function onServerTimeChange(listener: (offset: number | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The server's "now", in ms. Before any server time has arrived, the till's clock.
export function serverNow(localNow: number = Date.now()): number {
  return localNow + (offsetMs ?? 0)
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TRADING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// The trading day ("2026-11-18") of an instant, in Africa/Johannesburg.
export function tradingDayAt(ms: number): string {
  return dayFormatter.format(new Date(ms))
}

// Today's trading day by server time.
export function serverToday(localNow: number = Date.now()): string {
  return tradingDayAt(serverNow(localNow))
}
