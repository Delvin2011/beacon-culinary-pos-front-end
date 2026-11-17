"use client"

import { useCallback, useEffect } from "react"
import { KitchenTicket } from "@/components/receipts/kitchen-ticket"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { usePrintQueue, type PrintJob } from "@/hooks/use-print-queue"
import { currentReceiptSettings, useReceiptSettings } from "@/hooks/use-receipt-settings"
import { claimAutoPrint, clearAutoPrinted } from "@/lib/auto-print-guard"
import { loadPrintSettings } from "@/lib/print-settings"
import { accountIdsOf, fetchAccountNames, hasKitchenLines, receiptCopy, type ReceiptOrder } from "@/lib/receipt"
import { onSessionEnding } from "@/lib/session-events"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

interface Options {
  authFetch: AuthFetch
  // ownerKey(user): whose sign-in the auto-print guard belongs to.
  owner: string | null
  // Accounts the till already has (the payment picker's list), so most ACCOUNT receipts need no extra call.
  knownAccounts: Array<{ id: number; name: string }>
}

// The till's printing (O2b): after a sale, the receipt then the kitchen ticket, each when its switch is on; and the
// local "print again" copies from the completion screen. Printing never throws and never touches the sale.
export function useSalePrinting({ authFetch, owner, knownAccounts }: Options) {
  const { enqueue, portal } = usePrintQueue()
  // Fetches GET /pos/receipt-settings once after this sign-in (O2b handoff 1); the prints read the cached answer.
  useReceiptSettings()

  // A lock or a server-ended session ends this till session: the next sign-in starts a fresh guard.
  useEffect(() => onSessionEnding(() => clearAutoPrinted()), [])

  const accountNamesFor = useCallback(
    async (order: ReceiptOrder): Promise<Record<number, string>> => {
      const ids = accountIdsOf(order)
      if (ids.length === 0) return {}
      const names: Record<number, string> = {}
      for (const account of knownAccounts) names[account.id] = account.name
      if (ids.every((id) => names[id])) return names
      return { ...names, ...(await fetchAccountNames(authFetch)) }
    },
    [authFetch, knownAccounts],
  )

  const jobsFor = useCallback(
    async (order: ReceiptOrder, which: { receipt: boolean; kitchenTicket: boolean }, localCopy: boolean): Promise<PrintJob[]> => {
      const jobs: PrintJob[] = []
      if (which.receipt) {
        const [settings, accountNames] = await Promise.all([currentReceiptSettings(), accountNamesFor(order)])
        jobs.push({
          medium: "RECEIPT80",
          content: <ReceiptView order={order} settings={settings} copy={receiptCopy(order, localCopy)} accountNames={accountNames} />,
        })
      }
      if (which.kitchenTicket && hasKitchenLines(order)) {
        jobs.push({ medium: "RECEIPT80", content: <KitchenTicket order={order} copy={localCopy} /> })
      }
      return jobs
    },
    [accountNamesFor],
  )

  // After a successful sale (once per clientOrderId, a replay included). At most once per order id.
  const autoPrint = useCallback(
    async (order: ReceiptOrder): Promise<void> => {
      try {
        if (typeof order.id !== "number" || !owner) return
        const switches = loadPrintSettings()
        if (!switches.autoPrintReceipt && !switches.autoPrintKitchenTicket) return
        if (!claimAutoPrint(owner, order.id)) return
        enqueue(...(await jobsFor(order, { receipt: switches.autoPrintReceipt, kitchenTicket: switches.autoPrintKitchenTicket }, false)))
      } catch {
        // Never block or fail a sale because of printing.
      }
    },
    [enqueue, jobsFor, owner],
  )

  // "Print receipt again" / "Print kitchen ticket again": from the order on screen, no server call for the order,
  // marked COPY with no number.
  const reprintReceipt = useCallback(
    (order: ReceiptOrder) => {
      void jobsFor(order, { receipt: true, kitchenTicket: false }, true).then((jobs) => enqueue(...jobs), () => undefined)
    },
    [enqueue, jobsFor],
  )

  const reprintKitchenTicket = useCallback(
    (order: ReceiptOrder) => {
      void jobsFor(order, { receipt: false, kitchenTicket: true }, true).then((jobs) => enqueue(...jobs), () => undefined)
    },
    [enqueue, jobsFor],
  )

  return { autoPrint, reprintReceipt, reprintKitchenTicket, portal }
}
