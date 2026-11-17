"use client"

// A shift force-closed without a count (cashCount UNCOUNTED): record the count now (POST /admin/shifts/{id}/count),
// or sign it off confirming there will be no count (sign-off with confirmNoCount and a required note).
// Both need a password sign-in within 30 minutes (REAUTH_REQUIRED goes through the password re-sign-in).

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseCashInput } from "@/components/pos-activity/force-close-dialog"
import { formatMoney } from "@/lib/pos-activity"
import { reauthLoginPath } from "@/lib/return-to"
import {
  SHIFT_REASON_MAX,
  ShiftAdminError,
  VARIANCE_REASON_OPTIONS,
  confirmNoCount,
  recordLateCount,
  varianceCents,
  type VarianceReasonCode,
} from "@/lib/tills-admin"

export type CashCountMode = "count" | "no-count"

export interface CashCountTarget {
  shiftId: number
  ownerName: string
  // The expected cash snapshotted at close.
  expectedCash: number | null
  mode: CashCountMode
}

interface CashCountDialogProps {
  target: CashCountTarget | null
  onClose: () => void
  onDone: () => void
}

export function CashCountDialog({ target, onClose, onDone }: CashCountDialogProps) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const [countedInput, setCountedInput] = useState("")
  const [varianceReason, setVarianceReason] = useState<VarianceReasonCode | null>(null)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setCountedInput("")
    setVarianceReason(null)
    setNote("")
    setError(null)
    setFieldErrors({})
  }, [target])

  const mode = target?.mode
  const expected = target?.expectedCash ?? null
  const counted = parseCashInput(countedInput)
  const differs = counted !== null && expected !== null && varianceCents(counted, expected) !== 0

  const problem = (() => {
    if (mode === "no-count") return note.trim() ? null : "A note is required to confirm there is no count."
    if (counted === null) return "Enter the counted cash."
    if (differs && !varianceReason) return "Choose a reason for the variance."
    if (varianceReason === "OTHER" && differs && !note.trim()) return "A note is required when the reason is Other."
    return null
  })()

  const submit = async () => {
    if (!target) return
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      if (target.mode === "no-count") {
        await confirmNoCount(authFetch, target.shiftId, note)
      } else {
        await recordLateCount(authFetch, target.shiftId, {
          countedCash: counted ?? 0,
          varianceReasonCode: differs ? (varianceReason ?? undefined) : undefined,
          note,
        })
      }
      onDone()
    } catch (err) {
      if (err instanceof ShiftAdminError && err.needsReauth) {
        router.push(reauthLoginPath("/pos-activity"))
        return
      }
      if (err instanceof ShiftAdminError && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors)
        setError("Check the highlighted fields.")
      } else {
        setError(err instanceof Error ? err.message : "The action failed. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "no-count" ? "Confirm there is no count" : "Record the cash count"}</DialogTitle>
          <DialogDescription>
            {target?.ownerName}&apos;s shift was force-closed without a count. Expected cash at close:{" "}
            {expected === null ? "—" : formatMoney(expected)}.
          </DialogDescription>
        </DialogHeader>

        {mode === "count" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="late-count-cash">Counted cash</Label>
              <Input
                id="late-count-cash"
                inputMode="decimal"
                value={countedInput}
                onChange={(event) => setCountedInput(event.target.value)}
                aria-invalid={!!fieldErrors.countedCash}
                placeholder="0.00"
              />
              {fieldErrors.countedCash && <p className="text-xs text-destructive">{fieldErrors.countedCash}</p>}
            </div>
            {(differs || fieldErrors.varianceReasonCode) && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Variance {counted !== null && expected !== null ? formatMoney(varianceCents(counted, expected) / 100) : ""}: choose a reason
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {VARIANCE_REASON_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={varianceReason === option.value ? "default" : "outline"}
                      onClick={() => setVarianceReason(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                {fieldErrors.varianceReasonCode && <p className="text-xs text-destructive">{fieldErrors.varianceReasonCode}</p>}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="cash-count-note">
            Note {mode === "no-count" || (differs && varianceReason === "OTHER") ? "(required)" : "(optional)"}
          </Label>
          <textarea
            id="cash-count-note"
            rows={2}
            maxLength={SHIFT_REASON_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={!!fieldErrors.note}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={mode === "no-count" ? "Why will this shift never be counted?" : "e.g. Counted next morning from the sealed bag."}
          />
          {fieldErrors.note && <p className="text-xs text-destructive">{fieldErrors.note}</p>}
          {mode === "no-count" && (
            <p className="text-xs text-muted-foreground">This signs the shift off. Counted cash and variance stay blank.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button disabled={problem !== null || submitting} title={problem ?? undefined} onClick={() => void submit()}>
            {submitting ? "Saving…" : mode === "no-count" ? "Confirm no count and sign off" : "Record count"}
          </Button>
        </DialogFooter>
        {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
      </DialogContent>
    </Dialog>
  )
}
