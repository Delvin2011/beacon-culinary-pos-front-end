"use client"

// Force close (O2 contract 10.1): a manager closes a shift its owner can't close. Expected cash, a required reason,
// the counted cash or "Drawer can't be counted now", a variance reason when the count differs, then a confirm step.
// Needs a password sign-in within 30 minutes: REAUTH_REQUIRED keeps the form (no password or token) and goes through
// the password re-sign-in, which comes back here.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney } from "@/lib/pos-activity"
import { reauthLoginPath } from "@/lib/return-to"
import {
  SHIFT_REASON_MAX,
  ShiftAdminError,
  VARIANCE_REASON_OPTIONS,
  clearForceCloseDraft,
  fetchExpectedCash,
  forceCloseShift,
  saveForceCloseDraft,
  varianceCents,
  type ForceCloseDraft,
  type VarianceReasonCode,
} from "@/lib/tills-admin"

export interface ForceCloseTarget {
  shiftId: number
  ownerName: string
  // "T1 · Till 1 (front)" or "Unregistered till".
  till: string
}

// "1180.50" or "1180,50" -> 1180.5; null when it isn't an amount.
export function parseCashInput(raw: string): number | null {
  const text = raw.trim().replace(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Number(text)
}

interface ForceCloseDialogProps {
  target: ForceCloseTarget | null
  // A draft kept across the password re-sign-in, for the same shift.
  draft?: ForceCloseDraft | null
  onClose: () => void
  onDone: () => void
  // The shift changed on the server (already closed): reload what's behind the dialog.
  onStale?: () => void
}

export function ForceCloseDialog({ target, draft, onClose, onDone, onStale }: ForceCloseDialogProps) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const [expected, setExpected] = useState<number | null>(null)
  const [expectedError, setExpectedError] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [countedInput, setCountedInput] = useState("")
  const [cannotCount, setCannotCount] = useState(false)
  const [varianceReason, setVarianceReason] = useState<VarianceReasonCode | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const shiftId = target?.shiftId ?? null

  useEffect(() => {
    if (shiftId === null) return
    const kept = draft && draft.shiftId === shiftId ? draft : null
    setReason(kept?.reason ?? "")
    setCountedInput(kept?.countedCash ?? "")
    setCannotCount(kept?.cannotCount ?? false)
    setVarianceReason(kept?.varianceReasonCode ?? null)
    setConfirming(false)
    setError(null)
    setFieldErrors({})
    setExpected(null)
    setExpectedError(null)
    fetchExpectedCash(authFetch, shiftId)
      .then(setExpected)
      .catch((err: unknown) => setExpectedError(err instanceof Error ? err.message : "Unable to load the expected cash."))
  }, [authFetch, draft, shiftId])

  const counted = cannotCount ? null : parseCashInput(countedInput)
  const differs = counted !== null && expected !== null && varianceCents(counted, expected) !== 0
  const variance = counted !== null && expected !== null ? varianceCents(counted, expected) / 100 : null

  const formError = (): string | null => {
    if (!reason.trim()) return "Enter the reason for the force close."
    if (reason.trim().length > SHIFT_REASON_MAX) return `The reason must be at most ${SHIFT_REASON_MAX} characters.`
    if (!cannotCount && counted === null) return "Enter the counted cash, or tick \"Drawer can't be counted now\"."
    if (differs && !varianceReason) return "Choose a reason for the variance."
    return null
  }

  const close = () => {
    clearForceCloseDraft()
    onClose()
  }

  const submit = async () => {
    if (!target) return
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      await forceCloseShift(authFetch, target.shiftId, {
        reason,
        countedCash: counted ?? undefined,
        varianceReasonCode: differs ? (varianceReason ?? undefined) : undefined,
      })
      clearForceCloseDraft()
      onDone()
    } catch (err) {
      if (err instanceof ShiftAdminError && err.needsReauth) {
        saveForceCloseDraft({
          shiftId: target.shiftId,
          ownerName: target.ownerName,
          till: target.till,
          countedCash: countedInput,
          cannotCount,
          reason,
          varianceReasonCode: varianceReason,
        })
        router.push(reauthLoginPath("/pos-activity"))
        return
      }
      setConfirming(false)
      if (err instanceof ShiftAdminError && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors)
        setError("Check the highlighted fields.")
      } else {
        setError(err instanceof Error ? err.message : "Unable to force close the shift.")
      }
      // Closed meanwhile: reload the lists behind the dialog; the dialog stays open to say so.
      if (err instanceof ShiftAdminError && err.code === "SHIFT_ALREADY_CLOSED") onStale?.()
    } finally {
      setSubmitting(false)
    }
  }

  const problem = formError()

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Force close {target?.ownerName}&apos;s shift</DialogTitle>
          <DialogDescription>
            {target?.till}. Closes the shift now and signs {target?.ownerName} out everywhere. You approve any variance.
          </DialogDescription>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4">
            <div className="rounded-md border px-3 py-2">
              <p className="text-xs text-muted-foreground">Expected cash</p>
              <p className="text-lg font-semibold">
                {expectedError ? <span className="text-sm text-destructive">{expectedError}</span> : expected === null ? "…" : formatMoney(expected)}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="force-close-reason">Reason (required)</Label>
              <textarea
                id="force-close-reason"
                rows={2}
                maxLength={SHIFT_REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={!!fieldErrors.reason}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="e.g. Cashier went home ill; drawer counted by manager."
              />
              {fieldErrors.reason && <p className="text-xs text-destructive">{fieldErrors.reason}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="force-close-counted">Counted cash</Label>
              <Input
                id="force-close-counted"
                inputMode="decimal"
                value={countedInput}
                disabled={cannotCount}
                onChange={(event) => setCountedInput(event.target.value)}
                aria-invalid={!!fieldErrors.countedCash}
                placeholder="0.00"
              />
              {fieldErrors.countedCash && <p className="text-xs text-destructive">{fieldErrors.countedCash}</p>}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cannotCount} onChange={(event) => setCannotCount(event.target.checked)} />
                Drawer can&apos;t be counted now
              </label>
              {cannotCount && (
                <p className="text-xs text-muted-foreground">
                  The shift closes as &quot;Not counted&quot;. Record the count later, or confirm there is none at sign-off.
                </p>
              )}
            </div>

            {(differs || fieldErrors.varianceReasonCode) && (
              <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-700 dark:bg-amber-950/30">
                <p className="text-sm font-medium">
                  Variance {variance !== null ? formatMoney(variance) : ""}: choose a reason
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
                {varianceReason === "OTHER" && <p className="text-xs text-muted-foreground">The reason above is used as the note.</p>}
                {fieldErrors.varianceReasonCode && <p className="text-xs text-destructive">{fieldErrors.varianceReasonCode}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              Close {target?.ownerName}&apos;s shift on {target?.till} now?
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>Expected cash {expected === null ? "—" : formatMoney(expected)}</li>
              <li>{counted === null ? "Not counted" : `Counted ${formatMoney(counted)}`}</li>
              {differs && variance !== null && <li>Variance {formatMoney(variance)}</li>}
              <li>Reason: {reason.trim()}</li>
            </ul>
            <p className="text-muted-foreground">{target?.ownerName} is signed out on every till. This can&apos;t be undone.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => (confirming ? setConfirming(false) : close())} disabled={submitting}>
            {confirming ? "Back" : "Cancel"}
          </Button>
          {!confirming ? (
            <Button
              variant="destructive"
              disabled={problem !== null || expected === null}
              title={problem ?? undefined}
              onClick={() => setConfirming(true)}
            >
              Review
            </Button>
          ) : (
            <Button variant="destructive" disabled={submitting} onClick={() => void submit()}>
              {submitting ? "Closing…" : "Force close"}
            </Button>
          )}
        </DialogFooter>
        {!confirming && problem && <p className="text-xs text-muted-foreground">{problem}</p>}
      </DialogContent>
    </Dialog>
  )
}
