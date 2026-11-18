"use client"

// O4: the completion screen of an offline sale, shown only after the sale is in the outbox. The collection number
// the customer listens for, the change to hand over, "Print again" as online, and the receipt on screen. There is
// no server order yet, so none of the online screen's server actions (reload, mark print failed, void, refund).

import { CloudOff, Printer } from "lucide-react"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { formatReceiptAmount, hasKitchenLines, type ReceiptOrder } from "@/lib/receipt"
import type { ReceiptSettings } from "@/lib/receipt-settings"

export interface OfflineSaleCompleteProps {
  order: ReceiptOrder
  settings: ReceiptSettings | null
  accountNames: Record<number, string>
  onPrintReceipt: () => void
  onPrintKitchenTicket: () => void
  onNext: () => void
}

export function OfflineSaleComplete({ order, settings, accountNames, onPrintReceipt, onPrintKitchenTicket, onNext }: OfflineSaleCompleteProps) {
  const change = (order.payments ?? []).reduce((sum, payment) => sum + (payment.changeDue ?? 0), 0)

  return (
    <section className="rounded-3xl border border-sky-400/40 bg-sky-500/10 p-6 text-slate-100">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-sky-200">
        <CloudOff className="h-4 w-4" />
        Offline sale recorded
      </p>
      <p className="mt-4 text-xs uppercase tracking-widest text-sky-100/80">Collection number</p>
      <p data-testid="offline-collection-number" className="text-6xl font-black leading-none text-white">
        {order.collectionNumber}
      </p>
      <p className="mt-3 text-sm text-slate-300">Receipt {order.receiptNumber}</p>
      <p className="mt-1 text-lg font-semibold">Total R {formatReceiptAmount(order.total)}</p>
      {change > 0 && <p className="text-lg font-semibold text-emerald-300">Change R {formatReceiptAmount(change)}</p>}
      <p className="mt-3 text-sm text-sky-100/90">Saved on this till. It will be sent to the server when the till is back online.</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPrintReceipt}
          className="inline-flex items-center gap-2 rounded-xl border border-sky-300/50 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-300/10"
        >
          <Printer className="h-4 w-4" />
          Print receipt again
        </button>
        {hasKitchenLines(order) && (
          <button
            type="button"
            onClick={onPrintKitchenTicket}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-300/50 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-300/10"
          >
            <Printer className="h-4 w-4" />
            Print kitchen ticket again
          </button>
        )}
        <button type="button" onClick={onNext} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900">
          Next Customer
        </button>
      </div>

      <div className="mt-8 rounded-2xl border border-sky-300/30 bg-white p-4">
        <ReceiptView order={order} settings={settings} accountNames={accountNames} />
      </div>
    </section>
  )
}
