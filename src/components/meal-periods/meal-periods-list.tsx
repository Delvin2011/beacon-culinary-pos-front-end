"use client"

// The meal periods (GET /admin/meal-periods), inactive ones greyed, in sort order. Add, Edit, Deactivate and
// Activate. The All Day period (allDay: true) is marked, has no times and can't be deactivated.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  ACTION_LABELS,
  FORBIDDEN_MESSAGE,
  MealPeriodError,
  formatPeriodTimes,
  listAdminMealPeriods,
  type AdminMealPeriod,
} from "@/lib/meal-periods"
import { cn } from "@/lib/utils"
import { MealPeriodFormDialog } from "./meal-period-form-dialog"
import { PeriodStatusDialog } from "./period-status-dialog"

// Lists are ordered by sortOrder, then id (contract section 2).
function sorted(list: AdminMealPeriod[]): AdminMealPeriod[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

export function MealPeriodsList({ onLoaded }: { onLoaded?: (periods: AdminMealPeriod[]) => void }) {
  const { authFetch } = useAuth()
  const [periods, setPeriods] = useState<AdminMealPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMealPeriod | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminMealPeriod | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setPeriods(sorted(await listAdminMealPeriods(authFetch)))
    } catch (err) {
      setLoadError(err instanceof MealPeriodError && err.forbidden ? FORBIDDEN_MESSAGE : "Unable to load the meal periods.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    onLoaded?.(periods)
  }, [periods, onLoaded])

  const replace = (period: AdminMealPeriod) => {
    setPeriods((current) =>
      sorted(current.some((p) => p.id === period.id) ? current.map((p) => (p.id === period.id ? period : p)) : [...current, period]),
    )
  }

  const gone = (message: string) => {
    setFormOpen(false)
    setStatusTarget(null)
    setNotice(message)
    void load()
  }

  const openForm = (period: AdminMealPeriod | null) => {
    setNotice(null)
    setEditing(period)
    setFormOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div
          role="note"
          className="max-w-2xl rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          Changes apply immediately: a period&apos;s times decide when its items are on the menu and can be sold. Tills
          working offline pick them up at their next update.
        </div>
        <Button onClick={() => openForm(null)} disabled={loading || loadError !== null}>
          Add period
        </Button>
      </div>

      {notice && (
        <div role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {notice}
        </div>
      )}

      {loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Times</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Sort order</TableHead>
                <TableHead className="hidden lg:table-cell">Last change</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && periods.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    Loading meal periods…
                  </TableCell>
                </TableRow>
              ) : periods.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No meal periods yet.
                  </TableCell>
                </TableRow>
              ) : (
                periods.map((period) => (
                  <TableRow
                    key={period.id}
                    data-testid={`meal-period-${period.id}`}
                    data-inactive={period.active ? undefined : "true"}
                    className={cn(!period.active && "bg-muted/40 text-muted-foreground")}
                  >
                    <TableCell className="font-medium">
                      <span>{period.name}</span>
                      {period.allDay && (
                        <span
                          className="ml-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          title="Always open. Light meals are sold under it. It can be renamed, but not given times or deactivated."
                        >
                          All-day period
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatPeriodTimes(period)}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                          period.active ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-muted",
                        )}
                      >
                        {period.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{period.sortOrder}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {period.lastChange
                        ? `${ACTION_LABELS[period.lastChange.action]} by ${period.lastChange.byName}, ${formatJhbDateTime(period.lastChange.at)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      <Button variant="outline" size="sm" onClick={() => openForm(period)} aria-label={`Edit ${period.name}`}>
                        Edit
                      </Button>
                      {!period.allDay && (
                        <Button
                          variant={period.active ? "outline" : "default"}
                          size="sm"
                          onClick={() => {
                            setNotice(null)
                            setStatusTarget(period)
                          }}
                          aria-label={`${period.active ? "Deactivate" : "Activate"} ${period.name}`}
                        >
                          {period.active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <MealPeriodFormDialog
        open={formOpen}
        editing={editing}
        periods={periods}
        onClose={() => setFormOpen(false)}
        onSaved={(period, created) => {
          setFormOpen(false)
          replace(period)
          toast({ title: created ? `${period.name} added` : `${period.name} saved` })
        }}
        onGone={gone}
      />
      <PeriodStatusDialog
        period={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={(period) => {
          setStatusTarget(null)
          replace(period)
          toast({ title: period.active ? `${period.name} activated` : `${period.name} deactivated` })
        }}
        onGone={gone}
      />
    </div>
  )
}
