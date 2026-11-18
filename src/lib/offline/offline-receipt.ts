// O4: an offline sale as the O2b receipt and kitchen ticket read it. Built from the outbox entry only, so the slips
// show exactly what was recorded and will be sent: the till's receipt and collection numbers, soldAt, the local
// VAT. No orderNumber: the server's number is never printed for an offline sale.

import type { NewOutboxEntry } from "@/lib/offline/outbox"
import type { ReceiptOrder, ReceiptPayment } from "@/lib/receipt"

export function offlineReceiptOrder(entry: NewOutboxEntry): ReceiptOrder {
  const { payload, print } = entry
  return {
    receiptNumber: payload.offlineReceiptNumber,
    collectionNumber: payload.collectionNumber,
    soldAt: payload.soldAt,
    recordedOffline: true,
    wasPendingOnline: entry.wasPendingOnline,
    orderKind: "SALE",
    tillCode: print.tillCode,
    tillName: print.tillName,
    cashierName: print.cashierName,
    total: payload.total,
    originalTotal: payload.total,
    vatRate: payload.vatRate,
    vatIncludedAmount: payload.vatIncludedAmount,
    lines: payload.lines.map((line, index) => ({
      id: index,
      name: line.name,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      station: line.station,
      extras: line.extras.map((extra, extraIndex) => ({
        id: extraIndex,
        componentName: extra.name,
        quantity: extra.quantity,
        lineTotal: extra.lineTotal,
      })),
    })),
    payments: payload.payments.map((payment, index): ReceiptPayment => {
      switch (payment.method) {
        case "CASH":
          return { id: index, method: "CASH", amount: payment.amount, amountTendered: payment.amountTendered, changeDue: payment.changeDue }
        case "CARD":
          return payment.cardReference
            ? { id: index, method: "CARD", amount: payment.amount, cardReference: payment.cardReference }
            : { id: index, method: "CARD", amount: payment.amount }
        case "ACCOUNT":
          return { id: index, method: "ACCOUNT", amount: payment.amount, accountId: payment.accountId }
      }
    }),
  }
}
