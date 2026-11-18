"use client"

// O4 task 8: Today's Orders while offline: this till's offline sales of the trading day, from the outbox, newest
// first, each marked "Offline, not yet sent", "Sent" or "Needs support". Read-only: no server call.

import type { OutboxEntry } from "@/lib/offline/outbox"
import { formatReceiptAmount, formatReceiptDateTime } from "@/lib/receipt"

function statusLabel(entry: OutboxEntry): { text: string; className: string } {
  if (entry.status === "SYNCED") return { text: "Sent", className: "border-emerald-400/40 text-emerald-300" }
  if (entry.status === "PENDING") return { text: "Offline, not yet sent", className: "border-sky-400/40 text-sky-200" }
  return { text: "Needs support", className: "border-rose-400/40 text-rose-200" }
}

export function OfflineOrdersList({ entries, tradingDay }: { entries: OutboxEntry[]; tradingDay: string }) {
  const today = entries.filter((entry) => entry.tradingDay === tradingDay).sort((a, b) => b.soldAt.localeCompare(a.soldAt))
  if (today.length === 0) return <p className="text-sm text-slate-400">No offline sales today.</p>

  return (
    <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
      <p className="text-xs text-slate-400">Offline sales on this till. Other orders show when the connection is back.</p>
      {today.map((entry) => {
        const status = statusLabel(entry)
        const items = entry.payload.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")
        return (
          <div key={entry.clientOrderId} data-testid="offline-order" className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-white">{entry.payload.collectionNumber}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.text}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {formatReceiptDateTime(entry.soldAt)} · R {formatReceiptAmount(entry.payload.total)} · {entry.payload.offlineReceiptNumber}
            </p>
            <p className="mt-1 truncate text-xs text-slate-300">{items}</p>
          </div>
        )
      })}
    </div>
  )
}
