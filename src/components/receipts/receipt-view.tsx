"use client"

import { complimentaryReasonLabel } from "@/lib/complimentary"
import {
  formatReceiptAmount,
  formatReceiptDateTime,
  paymentMethodLabel,
  receiptTillLabel,
  receiptTotal,
  vatLine,
  type ReceiptCopy,
  type ReceiptOrder,
} from "@/lib/receipt"
import type { ReceiptSettings } from "@/lib/receipt-settings"

function Row({ label, amount, className }: { label: string; amount: string; className?: string }) {
  return (
    <div className={`flex justify-between gap-2 ${className ?? ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{amount}</span>
    </div>
  )
}

function CopyMark({ copy }: { copy: NonNullable<ReceiptCopy> }) {
  return (
    <p data-testid="copy-mark" className="py-1 text-center text-sm font-black uppercase tracking-[0.3em]">
      ** {copy.kind === "NUMBERED" ? `COPY ${copy.copyNumber}` : "COPY"} **
    </p>
  )
}

export interface ReceiptViewProps {
  order: ReceiptOrder
  // null when GET /pos/receipt-settings failed: no header, no footer, no VAT line.
  settings: ReceiptSettings | null
  copy?: ReceiptCopy
  // Names for payments[].accountId, from GET /accounts.
  accountNames?: Record<number, string>
}

// The customer receipt, for the screen and the 80 mm printer (72 mm print width, no margins). Every part is printed
// only when it has a value: a slip with empty settings is valid (O2b handoff 3).
export function ReceiptView({ order, settings, copy = null, accountNames = {} }: ReceiptViewProps) {
  const complimentary = order.orderKind === "COMPLIMENTARY"
  const payments = order.payments ?? []
  const when = formatReceiptDateTime(order.createdAt)
  const till = receiptTillLabel(order)
  const vat = vatLine(order, settings?.showVatLine ?? false)
  const discount = order.saleDiscount ?? 0

  return (
    <article data-testid="receipt" className="m-0 w-[72mm] space-y-1.5 p-0 font-mono text-[11px] leading-snug text-black">
      {copy && <CopyMark copy={copy} />}

      {settings && (
        <header className="text-center">
          {settings.receiptTitle && <p className="text-sm font-bold">{settings.receiptTitle}</p>}
          {settings.businessName && <p className="font-bold">{settings.businessName}</p>}
          {settings.addressLines.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          {settings.phone && <p>Tel {settings.phone}</p>}
          {settings.vatNumber && <p>VAT No. {settings.vatNumber}</p>}
        </header>
      )}

      <div>
        {order.receiptNumber && <p>Receipt {order.receiptNumber}</p>}
        {typeof order.orderNumber === "number" && (
          <p className="text-center">
            <span className="block text-[10px] uppercase tracking-widest">Order</span>
            <span data-testid="order-number" className="block text-4xl font-black leading-none">
              {order.orderNumber}
            </span>
          </p>
        )}
        {(when || till) && (
          <p className="flex justify-between gap-2">
            {when && <span>{when}</span>}
            {till && <span>Till {till}</span>}
          </p>
        )}
        {order.cashierName && <p>Cashier: {order.cashierName}</p>}
      </div>

      {complimentary && <p className="text-center font-bold uppercase tracking-widest">Complimentary</p>}

      <div className="space-y-0.5 border-y border-dashed border-current py-1">
        {(order.lines ?? []).map((line, index) => (
          <div key={line.id ?? index}>
            <Row label={`${line.quantity} x ${line.name}`} amount={formatReceiptAmount(line.lineTotal)} />
            {(line.extras ?? []).map((extra, extraIndex) => (
              <Row
                key={extra.id ?? extraIndex}
                className="pl-3"
                label={`+ ${extra.quantity > 1 ? `${extra.quantity} x ` : ""}${extra.componentName}`}
                amount={formatReceiptAmount(extra.lineTotal)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-0.5">
        {complimentary ? (
          <>
            {typeof order.preDiscountTotal === "number" && <Row label="List value" amount={formatReceiptAmount(order.preDiscountTotal)} />}
            <Row label="TOTAL" amount={formatReceiptAmount(0)} className="text-sm font-bold" />
            {order.complimentary && (
              <>
                <p>Reason: {complimentaryReasonLabel(order.complimentary.reasonCode)}</p>
                {order.complimentary.note && <p>Note: {order.complimentary.note}</p>}
                <p>Approved by {order.complimentary.authorizedBy.name}</p>
              </>
            )}
          </>
        ) : (
          <>
            {discount > 0 && (
              <>
                {typeof order.preDiscountTotal === "number" && <Row label="Subtotal" amount={formatReceiptAmount(order.preDiscountTotal)} />}
                <Row label="Discount" amount={formatReceiptAmount(-discount)} />
              </>
            )}
            <Row label="TOTAL" amount={formatReceiptAmount(receiptTotal(order))} className="text-sm font-bold" />
          </>
        )}
        {vat && <p data-testid="vat-line">{vat}</p>}

        {payments.map((payment, index) => (
          <div key={payment.id ?? index}>
            <Row label={paymentMethodLabel(payment.method)} amount={formatReceiptAmount(payment.amount)} />
            {typeof payment.amountTendered === "number" && <Row className="pl-3" label="Tendered" amount={formatReceiptAmount(payment.amountTendered)} />}
            {typeof payment.changeDue === "number" && <Row className="pl-3" label="Change" amount={formatReceiptAmount(payment.changeDue)} />}
            {payment.cardReference && <p className="pl-3">Card ref {payment.cardReference}</p>}
            {typeof payment.accountId === "number" && accountNames[payment.accountId] && (
              <p className="pl-3">Account: {accountNames[payment.accountId]}</p>
            )}
          </div>
        ))}
      </div>

      {settings?.footerText && <p className="whitespace-pre-line border-t border-dashed border-current pt-1 text-center">{settings.footerText}</p>}

      {order.reprint && (
        <p className="text-center">
          Reprinted by {order.reprint.reprintedBy.name}
          {formatReceiptDateTime(order.reprint.reprintedAt) ? ` at ${formatReceiptDateTime(order.reprint.reprintedAt)}` : ""}
        </p>
      )}
      {copy && <CopyMark copy={copy} />}
    </article>
  )
}
