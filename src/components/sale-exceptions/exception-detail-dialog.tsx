"use client"

// O4 8.2 to 8.4: one exception with its full order. Open: Resolve (note required), or for an account charge awaiting
// approval, Approve account charge (note optional; records this manager as the approver). To reverse a sale or reject
// a charge, refund the order: resolving never changes the sale.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { OfflineOrderMarks, formatTradingDay } from "@/components/orders/offline-order-marks"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { useAuth } from "@/hooks/use-auth"
import { formatReceiptDateTime } from "@/lib/receipt"
import {
  ACCOUNT_APPROVAL_CODE,
  EXCEPTION_CODES,
  NOTE_MAX_LENGTH,
  SaleExceptionError,
  approveAccountCharge,
  exceptionLabel,
  fetchSaleException,
  noteProblem,
  resolveSaleException,
  type SaleExceptionDetail,
} from "@/lib/sale-exceptions"

// "requested" → "Requested", "componentStockId" → "Component stock id".
function detailLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function ExceptionDetailDialog({ exceptionId, onClose, onChanged }: { exceptionId: number | null; onClose: () => void; onChanged: () => void }) {
  const { authFetch } = useAuth()
  const [detail, setDetail] = useState<SaleExceptionDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (id: number) => {
      setLoadError(null)
      try {
        setDetail(await fetchSaleException(authFetch, id))
      } catch (err) {
        setDetail(null)
        setLoadError(err instanceof Error ? err.message : "Unable to load this exception.")
      }
    },
    [authFetch],
  )

  useEffect(() => {
    setDetail(null)
    setNote("")
    setNoteError(null)
    setActionError(null)
    if (exceptionId !== null) void load(exceptionId)
  }, [exceptionId, load])

  const isAccountApproval = detail?.code === ACCOUNT_APPROVAL_CODE
  const open = detail?.status === "OPEN"

  const act = async () => {
    if (!detail) return
    const problem = noteProblem(note, !isAccountApproval)
    setNoteError(problem)
    setActionError(null)
    if (problem) return
    setBusy(true)
    try {
      const updated = isAccountApproval ? await approveAccountCharge(authFetch, detail.id, note) : await resolveSaleException(authFetch, detail.id, note)
      setDetail(updated)
      setNote("")
      onChanged()
    } catch (err) {
      if (err instanceof SaleExceptionError) {
        if (err.noteError) setNoteError(err.noteError)
        else setActionError(err.message)
        // Someone else resolved it, or it's gone: show what the server has now.
        if (err.code === "EXCEPTION_ALREADY_RESOLVED") {
          await load(detail.id)
          onChanged()
        }
      } else {
        setActionError("Unable to save. Try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={exceptionId !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail ? exceptionLabel(detail.code) : "Sale exception"}</DialogTitle>
          <DialogDescription>
            {detail ? EXCEPTION_CODES[detail.code]?.description ?? detail.code : loadError ? "" : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            {loadError}
          </p>
        )}

        {detail && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Code</dt>
              <dd className="font-mono">{detail.code}</dd>
              <dt className="text-muted-foreground">Severity</dt>
              <dd>{detail.severity}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{detail.status === "OPEN" ? "Open" : "Resolved"}</dd>
              <dt className="text-muted-foreground">Trading day</dt>
              <dd>{detail.tradingDay ? formatTradingDay(detail.tradingDay) : "—"}</dd>
              <dt className="text-muted-foreground">Till</dt>
              <dd>{detail.tillCode ?? "—"}</dd>
              {Object.entries(detail.detail).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{detailLabel(key)}</dt>
                  <dd className="break-all">{detailValue(value)}</dd>
                </div>
              ))}
            </dl>

            {detail.status !== "OPEN" && (
              <div className="rounded-md border p-3">
                <p className="font-semibold">
                  {detail.resolution === "ACCOUNT_APPROVED" ? "Account charge approved" : "Resolved"}
                  {detail.resolvedBy ? ` by ${detail.resolvedBy.name}` : ""}
                  {detail.resolvedAt ? ` on ${formatReceiptDateTime(detail.resolvedAt)}` : ""}
                </p>
                {detail.resolutionNote && <p className="mt-1">{detail.resolutionNote}</p>}
              </div>
            )}

            {detail.order && (
              <div className="space-y-2">
                <p className="font-semibold">
                  Order {detail.order.receiptNumber ?? `#${detail.order.id}`}
                  {typeof detail.order.orderNumber === "number" ? ` · #${detail.order.orderNumber}` : ""}
                </p>
                <OfflineOrderMarks order={detail.order} />
                <div className="flex justify-center rounded-md border bg-white p-3 text-black">
                  <ReceiptView order={detail.order} settings={null} />
                </div>
                <p className="text-xs text-muted-foreground">To reverse this sale or reject a charge, refund the order. Resolving doesn&apos;t change the sale.</p>
              </div>
            )}

            {open && (
              <div className="space-y-2">
                <Label htmlFor="exception-note">{isAccountApproval ? "Note (optional)" : "Note (required)"}</Label>
                <textarea
                  id="exception-note"
                  value={note}
                  maxLength={NOTE_MAX_LENGTH}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  placeholder={isAccountApproval ? "e.g. Approved by the finance manager." : "What was checked, and what was done."}
                />
                {noteError && (
                  <p role="alert" className="text-rose-600 dark:text-rose-300">
                    {noteError}
                  </p>
                )}
              </div>
            )}
            {actionError && (
              <p role="alert" className="text-rose-600 dark:text-rose-300">
                {actionError}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {detail && open && (
            <Button disabled={busy} onClick={() => void act()}>
              {isAccountApproval ? "Approve account charge" : "Resolve"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
