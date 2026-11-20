"use client"

// Change history (GET /admin/meal-periods/history): when, who, which period, what was done, and the fields that
// changed, before and after. Newest first; filter by one period, a page at a time (50/100/200). Filter and page are
// kept in the URL (?tab=history&periodId=…&page=…&size=…).

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  ACTION_LABELS,
  HISTORY_FIELD_LABELS,
  HISTORY_PAGE_SIZES,
  fetchMealPeriodHistory,
  historyChanges,
  type AdminMealPeriod,
  type MealPeriodHistoryEntry,
  type MealPeriodHistoryPage,
  type MealPeriodHistoryQuery,
} from "@/lib/meal-periods"

const DEFAULT_SIZE = 50
const SELECT_CLASS = "h-9 rounded-md border bg-background px-2 text-sm"

export function historyQueryFromSearch(search: string): MealPeriodHistoryQuery {
  const params = new URLSearchParams(search)
  const periodId = Number(params.get("periodId"))
  const page = Number(params.get("page"))
  const size = Number(params.get("size"))
  return {
    periodId: params.get("periodId") && Number.isInteger(periodId) && periodId > 0 ? periodId : null,
    page: Number.isInteger(page) && page > 0 ? page : 0,
    size: (HISTORY_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SIZE,
  }
}

function writeQueryToUrl(query: MealPeriodHistoryQuery) {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  params.set("tab", "history")
  if (query.periodId !== null) params.set("periodId", String(query.periodId))
  else params.delete("periodId")
  if (query.page > 0) params.set("page", String(query.page))
  else params.delete("page")
  if (query.size !== DEFAULT_SIZE) params.set("size", String(query.size))
  else params.delete("size")
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
}

function ChangeList({ entry, side }: { entry: MealPeriodHistoryEntry; side: "before" | "after" }) {
  const changes = historyChanges(entry)
  if (side === "before" && entry.before === null) return <span className="text-muted-foreground">—</span>
  if (changes.length === 0) return <span className="text-muted-foreground">No change</span>
  return (
    <ul className="space-y-0.5">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="text-muted-foreground">{HISTORY_FIELD_LABELS[change.field]}:</span> {side === "before" ? change.before : change.after}
        </li>
      ))}
    </ul>
  )
}

export function MealPeriodsHistory({ periods }: { periods: AdminMealPeriod[] }) {
  const { authFetch } = useAuth()
  const [query, setQuery] = useState<MealPeriodHistoryQuery>(() =>
    typeof window === "undefined" ? { periodId: null, page: 0, size: DEFAULT_SIZE } : historyQueryFromSearch(window.location.search),
  )
  const [result, setResult] = useState<MealPeriodHistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await fetchMealPeriodHistory(authFetch, query))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the change history.")
    } finally {
      setLoading(false)
    }
  }, [authFetch, query])

  useEffect(() => {
    void load()
    writeQueryToUrl(query)
  }, [load, query])

  const change = (patch: Partial<MealPeriodHistoryQuery>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 0 }))

  // The period's current name; the name in the entry if the period isn't on the list.
  const periodName = (entry: MealPeriodHistoryEntry) => periods.find((p) => p.id === entry.periodId)?.name ?? entry.after.name

  const total = result?.totalElements ?? 0
  const pages = Math.max(1, result?.totalPages ?? 1)
  const pageNumber = (result?.page ?? query.page) + 1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Period</span>
          <select
            aria-label="Period"
            className={SELECT_CLASS}
            value={query.periodId ?? ""}
            onChange={(event) => change({ periodId: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">All periods</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
                {period.active ? "" : " (inactive)"}
              </option>
            ))}
            {query.periodId !== null && !periods.some((p) => p.id === query.periodId) && (
              <option value={query.periodId}>Period {query.periodId}</option>
            )}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !result ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Loading the change history…
              </TableCell>
            </TableRow>
          ) : result && result.content.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                {query.periodId !== null ? "No changes to this period yet." : "No meal periods have been changed yet."}
              </TableCell>
            </TableRow>
          ) : (
            result?.content.map((entry) => (
              <TableRow key={entry.id} data-testid="history-row" className="align-top">
                <TableCell className="whitespace-nowrap">{formatJhbDateTime(entry.changedAt)}</TableCell>
                <TableCell>{entry.changedByName || "—"}</TableCell>
                <TableCell>{periodName(entry)}</TableCell>
                <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                <TableCell>
                  <ChangeList entry={entry} side="before" />
                </TableCell>
                <TableCell>
                  <ChangeList entry={entry} side="after" />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {total} change{total === 1 ? "" : "s"} · page {pageNumber} of {pages}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Rows per page
            <select aria-label="Rows per page" className={SELECT_CLASS} value={query.size} onChange={(event) => change({ size: Number(event.target.value) })}>
              {HISTORY_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" disabled={loading || query.page <= 0} onClick={() => change({ page: query.page - 1 })}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={loading || pageNumber >= pages} onClick={() => change({ page: query.page + 1 })}>
            Next
          </Button>
        </div>
      </nav>
    </div>
  )
}
