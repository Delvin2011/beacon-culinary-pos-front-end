"use client"

// Deactivate or activate a meal period (POST /admin/meal-periods/{id}/deactivate | /activate), after a confirm that
// says what it does. A refusal stays in the dialog in plain words: PERIOD_IN_USE with the counts and the first
// planned date, PERIOD_OVERLAP naming the other period, a name now taken by an active period (400 on name).

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import {
  MealPeriodError,
  activateMealPeriod,
  deactivateMealPeriod,
  formatPeriodTimes,
  refusalMessage,
  type AdminMealPeriod,
} from "@/lib/meal-periods"

export interface PeriodStatusDialogProps {
  period: AdminMealPeriod | null
  onClose: () => void
  onDone: (period: AdminMealPeriod) => void
  onGone: (message: string) => void
}

export function PeriodStatusDialog({ period, onClose, onDone, onGone }: PeriodStatusDialogProps) {
  const { authFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    setBusy(false)
    setRefusal(null)
  }, [period])

  if (!period) return null
  const deactivating = period.active

  const confirm = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      const updated = deactivating ? await deactivateMealPeriod(authFetch, period.id) : await activateMealPeriod(authFetch, period.id)
      onDone(updated)
    } catch (err) {
      if (!(err instanceof MealPeriodError)) {
        setRefusal("Unable to reach the server. Check the connection and try again.")
      } else if (err.code === "MEAL_PERIOD_NOT_FOUND") {
        onGone(refusalMessage(err, period.name))
      } else if (err.code === null && err.fieldErrors.name) {
        setRefusal(`${err.fieldErrors.name} Rename one of them first.`)
      } else {
        setRefusal(refusalMessage(err, period.name))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{deactivating ? `Deactivate ${period.name}?` : `Activate ${period.name}?`}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              {deactivating ? (
                <>
                  <p>
                    {period.name} stops at once: its items leave the menu and can&apos;t be sold, and nothing new can be planned
                    under it. Tills working offline stop at their next update.
                  </p>
                  <p>Past orders and reports keep it. You can activate it again later.</p>
                  <p>It can only be deactivated when nothing is planned under it for today or later.</p>
                </>
              ) : (
                <p>
                  {period.name} is sold from {formatPeriodTimes(period)} again, starting now, and items can be planned under it.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        {refusal && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {refusal}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {refusal ? "Close" : "Cancel"}
          </Button>
          <Button variant={deactivating ? "destructive" : "default"} onClick={() => void confirm()} disabled={busy}>
            {busy ? "Working…" : deactivating ? "Deactivate" : "Activate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
