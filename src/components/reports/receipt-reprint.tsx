"use client"

import { useEffect, useState } from "react"
import { Printer } from "lucide-react"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { usePrint } from "@/hooks/use-print"
import { useReceiptSettings } from "@/hooks/use-receipt-settings"
import { accountIdsOf, fetchAccountNames, receiptCopy, type ReceiptOrder } from "@/lib/receipt"

// The full OrderDto plus the reprint stamp from POST /admin/orders/{id}/reprint-receipt (O2b contract: cashier and
// till are the original sale's; the header comes from the current settings).
export type ReceiptPayload = ReceiptOrder & { id: number; orderNumber: number }

export function isReceiptPayload(body: unknown): body is ReceiptPayload {
  return !!body && typeof body === "object" && typeof (body as ReceiptPayload).orderNumber === "number"
}

// Shows a reprinted receipt with a Print button. A reprint never changes the order, so nothing else is offered here.
export function ReceiptReprintDialog({ receipt, onClose }: { receipt: ReceiptPayload | null; onClose: () => void }) {
  const { print, portal } = usePrint()
  const { authFetch } = useAuth()
  const settings = useReceiptSettings()
  const [accountNames, setAccountNames] = useState<Record<number, string>>({})
  const needsAccounts = receipt ? accountIdsOf(receipt).length > 0 : false

  useEffect(() => {
    if (!needsAccounts) return
    let active = true
    void fetchAccountNames(authFetch).then((names) => {
      if (active) setAccountNames(names)
    })
    return () => {
      active = false
    }
  }, [needsAccounts, authFetch])

  const slip = receipt ? <ReceiptView order={receipt} settings={settings} copy={receiptCopy(receipt)} accountNames={accountNames} /> : null

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
          {receipt && <div className="flex justify-center rounded-md border bg-white p-3 text-black">{slip}</div>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => slip && print("RECEIPT80", slip)}>
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
