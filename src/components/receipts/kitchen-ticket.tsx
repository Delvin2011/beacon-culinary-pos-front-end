"use client"

import { formatReceiptDateTime, kitchenLines, largeNumber, receiptTime, type ReceiptOrder } from "@/lib/receipt"

// The kitchen's paper ticket (O2b handoff 5): only the KITCHEN lines, with extras and quantities, no prices. BAR lines
// stay on the bar's screen and NONE lines are handed over at payment. Orders have no notes, so none are printed.
// Print it only when hasKitchenLines(order); it renders nothing otherwise.
export function KitchenTicket({ order, copy = false }: { order: ReceiptOrder; copy?: boolean }) {
  const lines = kitchenLines(order)
  if (lines.length === 0) return null
  const when = formatReceiptDateTime(receiptTime(order))
  const big = largeNumber(order)

  return (
    <article data-testid="kitchen-ticket" className="m-0 w-[72mm] space-y-2 p-0 font-mono text-sm leading-snug text-black">
      {copy && <p className="text-center font-black tracking-[0.3em]">** COPY **</p>}
      <p className="text-center text-xs font-bold uppercase tracking-widest">Kitchen</p>
      {big && (
        <p data-testid="ticket-order-number" className="text-center text-6xl font-black leading-none">
          {big.value}
        </p>
      )}
      {order.recordedOffline && <p className="text-center font-bold uppercase tracking-widest">Offline sale</p>}
      {order.wasPendingOnline && (
        <p data-testid="was-pending-online" className="border-2 border-current p-1 text-center font-bold">
          Was pending online: check the kitchen screen before preparing
        </p>
      )}
      {(when || order.tillCode) && (
        <p className="flex justify-between gap-2 text-xs">
          {when && <span>{when}</span>}
          {order.tillCode && <span>Till {order.tillCode}</span>}
        </p>
      )}
      <div className="space-y-1 border-y border-dashed border-current py-1.5">
        {lines.map((line, index) => (
          <div key={line.id ?? index}>
            <p className="text-base font-bold">
              {line.quantity} x {line.name}
            </p>
            {(line.extras ?? []).map((extra, extraIndex) => (
              <p key={extra.id ?? extraIndex} className="pl-4">
                + {extra.quantity > 1 ? `${extra.quantity} x ` : ""}
                {extra.componentName}
              </p>
            ))}
          </div>
        ))}
      </div>
    </article>
  )
}
