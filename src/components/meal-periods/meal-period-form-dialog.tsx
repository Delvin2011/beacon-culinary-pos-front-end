"use client"

// Add or edit a meal period (POST / PUT /admin/meal-periods). The contract's field rules are checked first; the
// server's 400 messages go under their fields and a PERIOD_OVERLAP under both times. Before a time change or a
// rename is sent, the dialog shows what it will do (selling changes at once; past reports show the new name) and
// asks once more. The All Day period has no times: only its name and sort order can be changed.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import {
  MealPeriodError,
  SORT_ORDER_MAX,
  bodyFromForm,
  checkForm,
  createMealPeriod,
  formFromPeriod,
  refusalMessage,
  saveWarnings,
  siteTimeNow,
  updateMealPeriod,
  type AdminMealPeriod,
  type MealPeriodForm,
  type SaveWarnings,
} from "@/lib/meal-periods"
import { cn } from "@/lib/utils"

const FORM_FIELDS = ["name", "startTime", "endTime", "sortOrder"] as const

export interface MealPeriodFormDialogProps {
  open: boolean
  // null: adding a new period.
  editing: AdminMealPeriod | null
  periods: AdminMealPeriod[]
  onClose: () => void
  onSaved: (period: AdminMealPeriod, created: boolean) => void
  // The period no longer exists (404): the list should reload.
  onGone: (message: string) => void
}

export function MealPeriodFormDialog({ open, editing, periods, onClose, onSaved, onGone }: MealPeriodFormDialogProps) {
  const { authFetch } = useAuth()
  const [form, setForm] = useState<MealPeriodForm>(() => formFromPeriod(editing))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [topErrors, setTopErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<SaveWarnings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(formFromPeriod(editing))
    setErrors({})
    setTopErrors([])
    setWarnings(null)
    setSaving(false)
  }, [open, editing])

  const allDay = editing?.allDay === true
  const set = (field: keyof MealPeriodForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setWarnings(null)
  }

  const send = async () => {
    setSaving(true)
    setTopErrors([])
    try {
      const body = bodyFromForm(form, editing)
      const saved = editing ? await updateMealPeriod(authFetch, editing.id, body) : await createMealPeriod(authFetch, body)
      onSaved(saved, editing === null)
    } catch (err) {
      setWarnings(null)
      if (!(err instanceof MealPeriodError)) {
        setTopErrors(["Unable to save the meal period. Check the connection and try again."])
        return
      }
      const periodName = editing?.name ?? (form.name.trim() || "This period")
      if (err.code === "MEAL_PERIOD_NOT_FOUND") {
        onGone(refusalMessage(err, periodName))
        return
      }
      if (err.code === "PERIOD_OVERLAP") {
        const message = refusalMessage(err, periodName)
        setErrors({ startTime: message, endTime: message })
        return
      }
      if (err.code === null && Object.keys(err.fieldErrors).length > 0) {
        const onForm: Record<string, string> = {}
        const elsewhere: string[] = []
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          if ((FORM_FIELDS as readonly string[]).includes(field) && !(allDay && (field === "startTime" || field === "endTime"))) onForm[field] = message
          else elsewhere.push(message)
        }
        setErrors(onForm)
        setTopErrors(elsewhere)
        return
      }
      setTopErrors([refusalMessage(err, periodName)])
    } finally {
      setSaving(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const found = checkForm(form, { editing, periods })
    setErrors(found)
    setTopErrors([])
    if (Object.keys(found).length > 0) return
    if (!warnings) {
      const next = saveWarnings(editing, form, siteTimeNow())
      if (next.times || next.rename) {
        setWarnings(next)
        return
      }
    }
    void send()
  }

  const field = (name: keyof MealPeriodForm, label: string, input: React.ReactNode, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`meal-period-${name}`}>{label}</Label>
      {input}
      {hint && !errors[name] && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors[name] && (
        <p id={`meal-period-${name}-error`} className="text-sm text-destructive">
          {errors[name]}
        </p>
      )}
    </div>
  )

  const inputProps = (name: keyof MealPeriodForm) => ({
    id: `meal-period-${name}`,
    value: form[name],
    onChange: set(name),
    disabled: saving,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `meal-period-${name}-error` : undefined,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a meal period"}</DialogTitle>
            <DialogDescription>
              {allDay
                ? "This period is always open, and light meals are sold under it. Only its name and sort order can be changed."
                : "Set meals are planned and sold under a meal period between its start and end time, inclusive. Periods can touch but not overlap; overnight periods aren't supported."}
            </DialogDescription>
          </DialogHeader>

          {topErrors.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {topErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}

          {field("name", "Name", <Input {...inputProps("name")} maxLength={60} autoComplete="off" />)}
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              {field("startTime", "Start", <Input {...inputProps("startTime")} type="time" step={60} />)}
              {field("endTime", "End", <Input {...inputProps("endTime")} type="time" step={60} />, "Sold up to and including this minute.")}
            </div>
          )}
          {field(
            "sortOrder",
            "Sort order",
            <Input {...inputProps("sortOrder")} inputMode="numeric" placeholder={editing ? undefined : "Last"} />,
            `0–${SORT_ORDER_MAX}. Lower comes first on the tills and in planning.${editing ? "" : " Leave empty to put it last."}`,
          )}

          {warnings && (
            <div
              role="alert"
              data-testid="meal-period-warnings"
              className={cn(
                "space-y-2 rounded-md border px-3 py-2 text-sm",
                warnings.sellingNow ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
              )}
            >
              {warnings.times && <p>{warnings.times}</p>}
              {warnings.rename && <p>{warnings.rename}</p>}
              <p className="font-medium">Save anyway?</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant={warnings?.sellingNow ? "destructive" : "default"} disabled={saving}>
              {saving ? "Saving…" : warnings ? "Save anyway" : editing ? "Save" : "Add period"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
