"use client"

// Change history (GET /admin/settings/history): who, when, setting, old and new value, newest first. Filter by one
// setting, a page at a time (50/100/200). Values are typed like the settings and shown the same way (VAT as a
// percentage); "(default)" marks a value that was the default. Filter and page are kept in the URL.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import {
  HISTORY_DEFAULT_SIZE,
  HISTORY_PAGE_SIZES,
  fetchSettingsHistory,
  formatInstant,
  formatSettingValue,
  settingCopy,
  type HistoryQuery,
  type SettingHistoryPage,
  type SettingValue,
  type SiteSetting,
} from "@/lib/site-settings"

const SELECT_CLASS = "h-9 rounded-md border bg-background px-2 text-sm"

// ?key=…&page=…&size=… (page from 0).
export function historyQueryFromSearch(search: string): HistoryQuery {
  const params = new URLSearchParams(search)
  const page = Number(params.get("page"))
  const size = Number(params.get("size"))
  return {
    key: params.get("key") || null,
    page: Number.isInteger(page) && page > 0 ? page : 0,
    size: (HISTORY_PAGE_SIZES as readonly number[]).includes(size) ? size : HISTORY_DEFAULT_SIZE,
  }
}

function writeQueryToUrl(query: HistoryQuery) {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  params.set("tab", "history")
  if (query.key) params.set("key", query.key)
  else params.delete("key")
  if (query.page > 0) params.set("page", String(query.page))
  else params.delete("page")
  if (query.size !== HISTORY_DEFAULT_SIZE) params.set("size", String(query.size))
  else params.delete("size")
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
}

export function SettingsHistory({ settings }: { settings: SiteSetting[] }) {
  const { authFetch } = useAuth()
  const [query, setQuery] = useState<HistoryQuery>(() =>
    typeof window === "undefined" ? { key: null, page: 0, size: HISTORY_DEFAULT_SIZE } : historyQueryFromSearch(window.location.search),
  )
  const [result, setResult] = useState<SettingHistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await fetchSettingsHistory(authFetch, query))
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

  const change = (patch: Partial<HistoryQuery>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 0 }))

  const settingOf = (key: string) => settings.find((s) => s.key === key)
  const shown = (key: string, value: SettingValue, isDefault: boolean) =>
    `${formatSettingValue(settingOf(key), value)}${isDefault ? " (default)" : ""}`

  const total = result?.totalElements ?? 0
  const pages = Math.max(1, result?.totalPages ?? 1)
  const pageNumber = (result?.page ?? query.page) + 1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Setting</span>
          <select aria-label="Setting" className={SELECT_CLASS} value={query.key ?? ""} onChange={(event) => change({ key: event.target.value || null })}>
            <option value="">All settings</option>
            {settings.map((setting) => (
              <option key={setting.key} value={setting.key}>
                {settingCopy(setting.key).label}
              </option>
            ))}
            {query.key && !settingOf(query.key) && <option value={query.key}>{query.key}</option>}
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
            <TableHead>Setting</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Old value</TableHead>
            <TableHead>New value</TableHead>
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
                {query.key ? "No changes to this setting yet." : "No settings have been changed yet."}
              </TableCell>
            </TableRow>
          ) : (
            result?.content.map((entry) => (
              <TableRow key={entry.id} data-testid="history-row">
                <TableCell className="whitespace-nowrap">{formatInstant(entry.changedAt)}</TableCell>
                <TableCell>{entry.changedByName ?? "—"}</TableCell>
                <TableCell>{settingCopy(entry.key).label}</TableCell>
                <TableCell>{entry.action === "RESET" ? "Reset to default" : "Changed"}</TableCell>
                <TableCell>{shown(entry.key, entry.oldValue, entry.oldIsDefault)}</TableCell>
                <TableCell>{shown(entry.key, entry.newValue, entry.newIsDefault)}</TableCell>
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
