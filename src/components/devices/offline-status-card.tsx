"use client"

// O3: what this browser (the till the page is open on) holds for offline use, and its status reports. Read from
// this browser's own storage: no server call. Never shows the grant string, the unlock check value or any accounts.

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OfflineGrant, OfflineSnapshot } from "@/lib/offline/contract"
import {
  getGrant,
  getMeta,
  getSnapshot,
  getUnlockVerifier,
  openOfflineDb,
  offlineStorageStatus,
  type PersistResult,
  type StorageStatus,
  type UnlockVerifier,
} from "@/lib/offline/db"
import { serverToday } from "@/lib/offline/server-time"
import { UNLOCK_TARGET_MS } from "@/lib/offline/unlock"
import { formatJhbDateTime, formatJhbTime } from "@/lib/pos-activity"
import { CLOCK_SKEW_WARN_MS } from "@/lib/tills-admin"

interface OfflineStatus {
  storage: StorageStatus
  persist: PersistResult | null
  lastStatusAt: string | null
  heartbeatStopped: boolean
  clockSkewMs: number | null
  grant: OfflineGrant | null
  snapshot: { snapshot: OfflineSnapshot; receivedAt: string } | null
  verifier: UnlockVerifier | null
}

async function readOfflineStatus(): Promise<OfflineStatus> {
  await openOfflineDb()
  const [persist, lastStatusAt, heartbeatStopped, clockSkewMs, grant, snapshot, verifier] = await Promise.all([
    getMeta("persistResult"),
    getMeta("lastStatusAt"),
    getMeta("heartbeatStopped"),
    getMeta("clockSkewMs"),
    getGrant(),
    getSnapshot(),
    getUnlockVerifier(),
  ])
  return {
    storage: offlineStorageStatus(),
    persist,
    lastStatusAt,
    heartbeatStopped: heartbeatStopped === true,
    clockSkewMs,
    grant: grant?.grant ?? null,
    snapshot: snapshot ? { snapshot: snapshot.snapshot, receivedAt: snapshot.receivedAt } : null,
    verifier,
  }
}

// "+1.5 s (till ahead)", "−3 min (till behind)".
export function describeClockSkew(ms: number): string {
  const abs = Math.abs(ms)
  const amount = abs < 60_000 ? `${(abs / 1000).toFixed(1)} s` : `${Math.round(abs / 60_000)} min`
  if (abs < 500) return "In step with the server"
  return `${ms > 0 ? "+" : "−"}${amount} (till ${ms > 0 ? "ahead" : "behind"})`
}

function storageText(status: OfflineStatus): string {
  if (status.storage === "unavailable") return "Not available: offline won't work in this browser"
  if (status.storage === "unknown") return "Checking…"
  if (status.persist === "persisted") return "Available · Persistent"
  if (status.persist === "not-persisted") return "Available · may be cleared by the browser"
  return "Available"
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function OfflineStatusCard() {
  const [status, setStatus] = useState<OfflineStatus | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    void readOfflineStatus().then((next) => {
      if (alive) setStatus(next)
    })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const skew = status?.clockSkewMs ?? null
  const skewWarning = skew !== null && Math.abs(skew) > CLOCK_SKEW_WARN_MS
  const snapshot = status?.snapshot ?? null
  const snapshotToday = snapshot ? snapshot.snapshot.tradingDay === serverToday() : false
  const grant = status?.grant ?? null
  const verifier = status?.verifier ?? null

  return (
    <section aria-labelledby="offline-status-heading" className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="offline-status-heading" className="font-semibold">
            Offline on this till
          </h2>
          <p className="text-sm text-muted-foreground">What this browser holds to keep selling through an outage.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((n) => n + 1)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {!status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Storage">{storageText(status)}</Row>
          <Row label="Status reports">
            {status.heartbeatStopped
              ? "Stopped: this till isn't registered"
              : status.lastStatusAt
                ? `Last report ${formatJhbTime(status.lastStatusAt)}`
                : "None yet"}
          </Row>
          <Row label="Clock difference">
            {skew === null ? (
              "Not measured yet"
            ) : (
              <>
                {describeClockSkew(skew)}
                {skewWarning && (
                  <p role="alert" className="mt-1 text-destructive">
                    The till&apos;s clock is off by {Math.round(Math.abs(skew) / 60_000)} min. Check the Windows time settings.
                  </p>
                )}
              </>
            )}
          </Row>
          <Row label="Offline permission">
            {grant ? `For shift ${grant.shiftId} (${grant.cashierName}), until ${formatJhbDateTime(grant.expiresAt)}` : "None"}
          </Row>
          <Row label="Today's menu">
            {!snapshot
              ? "None"
              : snapshotToday
                ? `Downloaded ${formatJhbTime(snapshot.receivedAt)} for ${snapshot.snapshot.tradingDay}`
                : `From ${snapshot.snapshot.tradingDay}: not usable today`}
          </Row>
          <Row label="Offline unlock">
            {verifier
              ? `Set up for ${grant && grant.cashierId === verifier.userId ? grant.cashierName : `cashier ${verifier.userId}`} (PIN check ≈ ${(UNLOCK_TARGET_MS / 1000).toFixed(1)} s, ${verifier.iterations.toLocaleString("en-ZA")} rounds)`
              : "Not set up"}
          </Row>
        </dl>
      )}
    </section>
  )
}
