"use client"

// The manager's Tills view (O2 contract 7.4): every active till with its open shift and lock state, plus the
// unregistered till while it has a shift. From a row: force close, the shift's activity, the device page.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatJhbDateTime, formatJhbTime } from "@/lib/pos-activity"
import { CLOCK_SKEW_WARN_MS, listAdminTills, type AdminTillOffline, type AdminTillRow } from "@/lib/tills-admin"
import { tillLabel } from "@/lib/till"

const POLL_INTERVAL_MS = 30_000

function LockState({ row }: { row: AdminTillRow }) {
  if (!row.shift) return <span className="text-muted-foreground">No shift</span>
  if (row.shift.locked === true) {
    return <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200">Locked</span>
  }
  if (row.shift.locked === false) {
    return <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">In use</span>
  }
  // The unregistered till has no lock state.
  return <span className="text-muted-foreground">Shift open</span>
}

// O3 (offline contract 10.2): the till's latest status report. UNKNOWN: silent for longer than the server's limit
// (10 minutes); its last report still counts.
const chip = "rounded-full border px-2 py-0.5 text-xs font-medium"
const CHIP_STYLES = {
  ok: `${chip} border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200`,
  pending: `${chip} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200`,
  unknown: `${chip} border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200`,
}

function formatSkew(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  return `Clock ${ms > 0 ? "+" : "−"}${minutes} min`
}

export function OfflineCell({ offline }: { offline: AdminTillOffline | null }) {
  if (!offline) return <span className="text-muted-foreground">—</span>
  const at = offline.lastReportAt ? formatJhbTime(offline.lastReportAt) : null
  const pending = offline.pendingCount ?? 0
  let main: JSX.Element
  switch (offline.state) {
    case "OK":
      main = <span className={CHIP_STYLES.ok}>OK{at ? ` · ${at}` : ""}</span>
      break
    case "PENDING":
      main = (
        <span className={CHIP_STYLES.pending}>
          {pending} unsynced{at ? ` · ${at}` : ""}
        </span>
      )
      break
    case "UNKNOWN":
      main = (
        <span className={CHIP_STYLES.unknown}>
          Not heard since {at ?? "—"}
          {pending > 0 ? ` · ${pending} unsynced` : ""}
        </span>
      )
      break
    default:
      main = <span className="text-muted-foreground">No report yet</span>
  }
  const skew = offline.clockSkewMs
  return (
    <div className="flex flex-col items-start gap-1">
      {main}
      {skew !== null && Math.abs(skew) > CLOCK_SKEW_WARN_MS && (
        <span className="text-xs font-medium text-rose-700 dark:text-rose-300">{formatSkew(skew)}</span>
      )}
    </div>
  )
}

interface TillsViewProps {
  // Bumped by the page after a force close, so the list reloads.
  reloadKey: number
  onForceClose: (row: AdminTillRow) => void
  onActivity: (shiftId: number) => void
}

export function TillsView({ reloadKey, onForceClose, onActivity }: TillsViewProps) {
  const { authFetch } = useAuth()
  const [rows, setRows] = useState<AdminTillRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listAdminTills(authFetch))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the tills.")
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Tills</h2>
          <p className="text-sm text-muted-foreground">Each till&apos;s open shift. Locked: the cashier stepped away; only they or a manager can sign in.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" asChild>
            <a href="/pos/login">Open Cashier Portal</a>
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows === null && !error && <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>}

      {rows && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full caption-bottom text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Till</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Offline</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No tills registered.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.deviceId ?? "unregistered"}>
                    <TableCell className="whitespace-nowrap font-medium">{tillLabel(row.tillCode, row.tillName)}</TableCell>
                    <TableCell>{row.shift?.ownerName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.shift ? formatJhbDateTime(row.shift.openedAt) : "—"}</TableCell>
                    <TableCell>
                      <LockState row={row} />
                    </TableCell>
                    <TableCell>
                      <OfflineCell offline={row.offline ?? null} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {row.shift && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => onActivity(row.shift!.shiftId)}>
                              Activity
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => onForceClose(row)}>
                              Force close
                            </Button>
                          </>
                        )}
                        {row.deviceId && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href="/devices">Device</Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
      )}
    </section>
  )
}
