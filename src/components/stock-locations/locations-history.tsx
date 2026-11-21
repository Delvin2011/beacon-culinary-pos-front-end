"use client"

// Changes (GET /admin/locations/history, contract 4.8): when, who, which location and what changed (created,
// renamed or reordered, deactivated, activated, assigned to a job). Newest first; filter by one location, a page at
// a time (50/100/200). Filter and page are kept in the URL (?tab=history&locationId=…&page=…&size=…).

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  HISTORY_PAGE_SIZES,
  describeHistoryEntry,
  fetchLocationHistory,
  historyActionLabel,
  type AdminLocation,
  type LocationHistoryEntry,
  type LocationHistoryPage,
  type LocationHistoryQuery,
} from "@/lib/locations"

const DEFAULT_SIZE = 50
const SELECT_CLASS = "h-9 rounded-md border bg-background px-2 text-sm"

export function historyQueryFromSearch(search: string): LocationHistoryQuery {
  const params = new URLSearchParams(search)
  const locationId = Number(params.get("locationId"))
  const page = Number(params.get("page"))
  const size = Number(params.get("size"))
  return {
    locationId: params.get("locationId") && Number.isInteger(locationId) && locationId > 0 ? locationId : null,
    page: Number.isInteger(page) && page > 0 ? page : 0,
    size: (HISTORY_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SIZE,
  }
}

function writeQueryToUrl(query: LocationHistoryQuery) {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  params.set("tab", "history")
  if (query.locationId !== null) params.set("locationId", String(query.locationId))
  else params.delete("locationId")
  if (query.page > 0) params.set("page", String(query.page))
  else params.delete("page")
  if (query.size !== DEFAULT_SIZE) params.set("size", String(query.size))
  else params.delete("size")
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
}

export function LocationsHistory({ locations }: { locations: AdminLocation[] }) {
  const { authFetch } = useAuth()
  const [query, setQuery] = useState<LocationHistoryQuery>(() =>
    typeof window === "undefined" ? { locationId: null, page: 0, size: DEFAULT_SIZE } : historyQueryFromSearch(window.location.search),
  )
  const [result, setResult] = useState<LocationHistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await fetchLocationHistory(authFetch, query))
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

  const change = (patch: Partial<LocationHistoryQuery>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 0 }))

  const nameOf = (id: number) => locations.find((l) => l.id === id)?.name ?? null
  // The location's current name; the name in the entry if it isn't on the list.
  const locationName = (entry: LocationHistoryEntry) => nameOf(entry.locationId) ?? entry.after?.name ?? entry.before?.name ?? `Location #${entry.locationId}`

  const total = result?.totalElements ?? 0
  const pages = Math.max(1, result?.totalPages ?? 1)
  const pageNumber = (result?.page ?? query.page) + 1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Location</span>
          <select
            aria-label="Location"
            className={SELECT_CLASS}
            value={query.locationId ?? ""}
            onChange={(event) => change({ locationId: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.active ? "" : " (inactive)"}
              </option>
            ))}
            {query.locationId !== null && !locations.some((l) => l.id === query.locationId) && (
              <option value={query.locationId}>Location #{query.locationId}</option>
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

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>What changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !result ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Loading the change history…
                </TableCell>
              </TableRow>
            ) : result && result.content.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {query.locationId !== null ? "No changes to this location yet." : "No stock locations have been changed yet."}
                </TableCell>
              </TableRow>
            ) : (
              result?.content.map((entry) => (
                <TableRow key={entry.id} data-testid="history-row" className="align-top">
                  <TableCell className="whitespace-nowrap">{formatJhbDateTime(entry.changedAt)}</TableCell>
                  <TableCell>{entry.changedByName || "—"}</TableCell>
                  <TableCell>{locationName(entry)}</TableCell>
                  <TableCell>{historyActionLabel(entry.action)}</TableCell>
                  <TableCell>
                    <ul className="space-y-0.5">
                      {describeHistoryEntry(entry, nameOf).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
