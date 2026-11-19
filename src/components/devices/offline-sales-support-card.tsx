"use client"

// O4 (decision 3): offline sales on this browser that the server couldn't take: INVALID (the till sent something
// unreadable, a bug) or REFUSED (a bad or another till's grant). They're kept (rule I) and counted as waiting until
// an ADMIN hands them to support: then they're kept but no longer counted. Read from this browser's storage only.

import { useCallback, useEffect, useState } from "react"
import { Copy, LifeBuoy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { notifyOutboxChanged } from "@/contexts/outbox-context"
import { useAuth } from "@/hooks/use-auth"
import { requestStatusReport } from "@/lib/offline/heartbeat"
import { listOutbox, markHandedToSupport, type OutboxEntry } from "@/lib/offline/outbox"
import { formatReceiptAmount, formatReceiptDateTime } from "@/lib/receipt"
import { isAdminRole } from "@/lib/roles"

export const SUPPORT_REASON_MAX_LENGTH = 500

// Everything support needs to find or re-key the sale. No grant string (it's a credential).
export function supportDetails(entry: OutboxEntry): string {
  return JSON.stringify(
    {
      clientOrderId: entry.clientOrderId,
      status: entry.status,
      code: entry.code,
      error: entry.error,
      grantId: entry.grantId,
      shiftId: entry.shiftId,
      tradingDay: entry.tradingDay,
      soldAt: entry.soldAt,
      wasPendingOnline: entry.wasPendingOnline,
      sale: entry.payload,
    },
    null,
    2,
  )
}

function SupportRow({ entry, canHandOver, onChanged }: { entry: OutboxEntry; canHandOver: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [handing, setHanding] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(supportDetails(entry))
      setCopied(true)
    } catch {
      setError("Couldn't copy. Select the details below and copy them by hand.")
    }
  }

  const handOver = async () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError("Enter a reason.")
      return
    }
    const ok = await markHandedToSupport(entry.clientOrderId, {
      at: new Date().toISOString(),
      by: user?.name || user?.email || "Admin",
      reason: trimmed,
    })
    if (!ok) {
      setError("Couldn't save this on the till. Try again.")
      return
    }
    setHanding(false)
    notifyOutboxChanged()
    requestStatusReport()
    onChanged()
  }

  return (
    <li data-testid="support-sale" className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {entry.payload.collectionNumber} · {entry.payload.offlineReceiptNumber}
        </p>
        <span className="rounded-full border border-rose-400/50 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
          {entry.status === "INVALID" ? "Not readable (INVALID)" : `Refused (${entry.code ?? "REFUSED"})`}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {formatReceiptDateTime(entry.soldAt)} · R {formatReceiptAmount(entry.payload.total)}
      </p>
      {entry.error && <p className="mt-1">Server: {entry.error}</p>}
      {entry.handedToSupport && (
        <p className="mt-1 text-muted-foreground">
          Handed to support by {entry.handedToSupport.by} on {formatReceiptDateTime(entry.handedToSupport.at)}: {entry.handedToSupport.reason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy details for support"}
        </Button>
        {canHandOver && !entry.handedToSupport && !handing && (
          <Button type="button" size="sm" variant="outline" onClick={() => setHanding(true)}>
            <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
            Handed to support
          </Button>
        )}
      </div>

      {handing && (
        <div className="mt-2 space-y-2">
          <label htmlFor={`support-reason-${entry.clientOrderId}`} className="block text-xs font-medium">
            Reason (kept on this till; the sale stays here but no longer counts as waiting)
          </label>
          <textarea
            id={`support-reason-${entry.clientOrderId}`}
            value={reason}
            maxLength={SUPPORT_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border bg-background p-2 text-sm"
            rows={2}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setHanding(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handOver()}>
              Save
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">{supportDetails(entry)}</pre>
      </details>
    </li>
  )
}

export function OfflineSalesSupportCard() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<OutboxEntry[]>([])

  const load = useCallback(async () => {
    const all = await listOutbox()
    setEntries(all.filter((entry) => entry.status === "INVALID" || entry.status === "REFUSED"))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (entries.length === 0) return null
  const waiting = entries.filter((entry) => !entry.handedToSupport).length

  return (
    <section aria-labelledby="offline-support-title" className="rounded-lg border border-rose-400/40 p-4">
      <h2 id="offline-support-title" className="text-lg font-semibold">
        Offline sales that need support
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The server couldn&apos;t record these sales from this till. They&apos;re kept here. {waiting > 0 ? `${waiting} still count as waiting to send.` : ""}
      </p>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <SupportRow key={entry.clientOrderId} entry={entry} canHandOver={isAdminRole(user?.role)} onChanged={() => void load()} />
        ))}
      </ul>
    </section>
  )
}
