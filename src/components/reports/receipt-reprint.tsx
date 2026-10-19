"use client"

import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePrint } from "@/hooks/use-print"
import { complimentaryReasonLabel, isComplimentary, type OrderComplimentary } from "@/lib/complimentary"
import { formatJhbDateTime } from "@/lib/pos-activity"
import { formatZarCurrency } from "@/lib/utils"

// The normal order/receipt payload, plus the reprint stamp from POST /admin/orders/{id}/reprint-receipt.
export interface ReceiptPayload {
  id: number
  orderNumber: number
  createdAt?: string
  orderKind?: string
  total: number
  preDiscountTotal?: number
  saleDiscount?: number
  originalTotal?: number
  lines?: Array<{
    id: number
    name: string
    quantity: number
    lineTotal: number
    extras?: Array<{ id: number; componentName: string; quantity: number; lineTotal: number }>
  }>
  payments?: Array<{ id: number; method: string; amount: number; amountTendered?: number; changeDue?: number }>
  complimentary?: OrderComplimentary | null
  rungBy?: { name: string }
  reprint?: { copyNumber: number; reprintedBy: { id: number; name: string }; reprintedAt: string }
}

export function isReceiptPayload(body: unknown): body is ReceiptPayload {
  return !!body && typeof body === "object" && typeof (body as ReceiptPayload).orderNumber === "number"
}

function CopyMark({ copyNumber }: { copyNumber: number }) {
  return (
    <p className="border-2 border-current py-1 text-center text-lg font-black uppercase tracking-[0.3em]">COPY {copyNumber}</p>
  )
}

// One receipt layout for screen and the 80 mm slip. A reprint is marked COPY n at the top and the bottom, so it can't pass as the original.
export function ReceiptView({ receipt }: { receipt: ReceiptPayload }) {
  const complimentary = isComplimentary(receipt)
  const payments = receipt.payments ?? []
  const amountPaid = receipt.originalTotal ?? receipt.total

  return (
    <article className="w-[72mm] space-y-2 font-mono text-[11px] leading-snug">
      {receipt.reprint && <CopyMark copyNumber={receipt.reprint.copyNumber} />}
      {complimentary && <p className="text-center text-sm font-bold uppercase tracking-widest">Complimentary</p>}
      <div className="text-center">
        <p className="text-base font-bold">Order #{receipt.orderNumber}</p>
        {receipt.createdAt && <p>{formatJhbDateTime(receipt.createdAt)}</p>}
        {receipt.rungBy && <p>Rung by {receipt.rungBy.name}</p>}
      </div>

      <div className="space-y-1 border-y border-dashed border-current py-1.5">
        {(receipt.lines ?? []).map((line) => (
          <div key={line.id}>
            <div className="flex justify-between gap-2">
              <span>
                {line.name} x{line.quantity}
              </span>
              <span className="tabular-nums">{formatZarCurrency(line.lineTotal)}</span>
            </div>
            {(line.extras ?? []).map((extra) => (
              <div key={extra.id} className="flex justify-between gap-2 pl-2">
                <span>
                  + {extra.componentName} x{extra.quantity}
                </span>
                <span className="tabular-nums">{formatZarCurrency(extra.lineTotal)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {complimentary ? (
        <div className="space-y-0.5">
          <div className="flex justify-between">
            <span>List value</span>
            <span className="tabular-nums">{formatZarCurrency(receipt.preDiscountTotal ?? 0)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Amount due</span>
            <span className="tabular-nums">{formatZarCurrency(0)}</span>
          </div>
          {receipt.complimentary && (
            <>
              <p>Reason: {complimentaryReasonLabel(receipt.complimentary.reasonCode)}</p>
              {receipt.complimentary.note && <p>Note: {receipt.complimentary.note}</p>}
              <p>Approved by {receipt.complimentary.authorizedBy.name}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          {(receipt.saleDiscount ?? 0) > 0 && (
            <>
              <div className="flex justify-between">
                <span>Before discount</span>
                <span className="tabular-nums">{formatZarCurrency(receipt.preDiscountTotal ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Discount</span>
                <span className="tabular-nums">−{formatZarCurrency(receipt.saleDiscount ?? 0)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatZarCurrency(amountPaid)}</span>
          </div>
          {payments.map((payment) => (
            <div key={payment.id}>
              <div className="flex justify-between">
                <span>{payment.method}</span>
                <span className="tabular-nums">{formatZarCurrency(payment.amount)}</span>
              </div>
              {payment.method === "CASH" && typeof payment.amountTendered === "number" && (
                <p className="pl-2">
                  Tendered {formatZarCurrency(payment.amountTendered)}
                  {payment.changeDue ? ` · Change ${formatZarCurrency(payment.changeDue)}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {receipt.reprint && (
        <div className="space-y-1 border-t border-dashed border-current pt-1.5">
          <p className="text-center">
            Reprinted by {receipt.reprint.reprintedBy.name} at {formatJhbDateTime(receipt.reprint.reprintedAt)}
          </p>
          <CopyMark copyNumber={receipt.reprint.copyNumber} />
        </div>
      )}
    </article>
  )
}

// Shows a reprinted receipt with a Print button. A reprint never changes the order, so nothing else is offered here.
export function ReceiptReprintDialog({ receipt, onClose }: { receipt: ReceiptPayload | null; onClose: () => void }) {
  const { print, portal } = usePrint()

  return (
    <>
      <Dialog open={receipt !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Receipt reprint{receipt?.reprint ? ` · COPY ${receipt.reprint.copyNumber}` : ""}
            </DialogTitle>
            <DialogDescription>Order #{receipt?.orderNumber}. Reprinting doesn&apos;t change the order.</DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="flex justify-center rounded-md border bg-white p-3 text-black">
              <ReceiptView receipt={receipt} />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => receipt && print("SLIP80", <ReceiptView receipt={receipt} />)}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {portal}
    </>
  )
}
