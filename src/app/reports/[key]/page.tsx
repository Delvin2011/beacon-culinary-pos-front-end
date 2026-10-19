"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, Download, Printer, RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { usePrint } from "@/hooks/use-print"
import { useReportCatalogue } from "@/hooks/use-report-catalogue"
import { ReportsShell } from "@/components/reports/reports-shell"
import { ReportTable } from "@/components/reports/report-table"
import { ReportChecks } from "@/components/reports/report-checks"
import { ReportStatement } from "@/components/reports/report-statement"
import { BlockerList, ReportActions, sendAction } from "@/components/reports/report-actions"
import { ReportPaging } from "@/components/reports/report-paging"
import { ReceiptReprintDialog, isReceiptPayload, type ReceiptPayload } from "@/components/reports/receipt-reprint"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatJhbDateTime } from "@/lib/pos-activity"
import { toShiftOwnerOptions, type UserOption } from "@/lib/users"
import {
  DATE_PRESET_LABELS,
  categoryLabel,
  detectPreset,
  filenameFromDisposition,
  formatCalendarDate,
  formatInt,
  humaniseEnum,
  isParamSet,
  isStatement,
  paramApplies,
  reportHref,
  paramOptions,
  parseFieldErrors,
  presetRange,
  resolveParamDefault,
  selectPrompt,
  withArticle,
  type DatePreset,
  type EndOfDayBlocker,
  type PrintMedium,
  type ReportDefinition,
  type ReportEnvelope,
  type ReportParam,
  type ReportRow,
  type RowAction,
} from "@/lib/reports"

// Radix Select can't use "" as an item value, so optional selects use this for "All".
const ANY = "__any"
// Field-error keys that belong next to the export buttons rather than a filter.
const EXPORT_ERROR_KEYS = ["export", "format"]
// Server-side paging parameters (page is 0-based). Not catalogue parameters; kept in the URL like filters.
const PAGING_KEYS = ["page", "size"] as const

type ParamValues = Record<string, string>

export default function ReportViewerPage({ params }: { params: { key: string } }) {
  return (
    <Suspense fallback={null}>
      <ReportViewerRoute reportKey={decodeURIComponent(params.key)} />
    </Suspense>
  )
}

function ReportViewerRoute({ reportKey }: { reportKey: string }) {
  const { reports, loading, error, reload } = useReportCatalogue()
  const definition = reports.find((report) => report.key === reportKey)

  return (
    <ReportsShell current={definition?.title ?? "Report"}>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : !definition ? (
        <div className="rounded-md border p-6 text-center">
          <p className="text-sm text-muted-foreground">This report doesn&apos;t exist or isn&apos;t available to you.</p>
          <Button size="sm" variant="outline" className="mt-3" asChild>
            <Link href="/reports">Back to Reports</Link>
          </Button>
        </div>
      ) : (
        <ReportViewer definition={definition} />
      )}
    </ReportsShell>
  )
}

function buildQuery(values: ParamValues): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value !== "") query.set(name, value)
  }
  return query.toString()
}

function ReportViewer({ definition }: { definition: ReportDefinition }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { authFetch } = useAuth()
  const { print, portal } = usePrint()

  const fromParam = definition.params.find((param) => param.name === "from" && param.type === "DATE")
  const toParam = definition.params.find((param) => param.name === "to" && param.type === "DATE")
  const hasRange = !!fromParam && !!toParam
  const otherParams = definition.params.filter((param) => !hasRange || (param !== fromParam && param !== toParam))

  // Applied values: the URL, with catalogue defaults for anything it leaves out.
  const searchString = searchParams.toString()
  const applied = useMemo<ParamValues>(() => {
    const url = new URLSearchParams(searchString)
    const values: ParamValues = {}
    for (const param of definition.params) {
      values[param.name] = url.get(param.name) ?? resolveParamDefault(param) ?? ""
    }
    return values
  }, [definition.params, searchString])
  const paging = useMemo<ParamValues>(() => {
    const url = new URLSearchParams(searchString)
    const values: ParamValues = {}
    for (const key of PAGING_KEYS) values[key] = url.get(key) ?? ""
    return values
  }, [searchString])
  const appliedQuery = buildQuery({ ...applied, ...paging })

  const [draft, setDraft] = useState<ParamValues>(applied)
  const [preset, setPreset] = useState<DatePreset>(() => detectPreset(applied.from ?? "", applied.to ?? ""))
  useEffect(() => {
    setDraft(applied)
    setPreset(detectPreset(applied.from ?? "", applied.to ?? ""))
  }, [applied])

  const [envelope, setEnvelope] = useState<ReportEnvelope | null>(null)
  const [running, setRunning] = useState(true)
  const [runError, setRunError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  // An envelope an action answered with (Close Day returns the Z Reading), shown in place of the report.
  const [actionResult, setActionResult] = useState<ReportEnvelope | null>(null)
  const [pendingRowAction, setPendingRowAction] = useState<{ row: ReportRow; action: RowAction } | null>(null)
  const [rowActionError, setRowActionError] = useState<{ label: string; message: string; blockers: EndOfDayBlocker[] } | null>(null)
  const [reprint, setReprint] = useState<ReceiptPayload | null>(null)

  // Required parameters (e.g. the statement's account): nothing runs until they are set.
  const requiredParams = definition.params.filter((param) => param.required)
  const missingRequired = requiredParams.find((param) => (applied[param.name] ?? "") === "")
  const draftComplete = requiredParams.every((param) => isParamSet(param, draft[param.name] ?? ""))

  const runReport = useCallback(async () => {
    if (missingRequired) {
      setEnvelope(null)
      setRunError(null)
      setFieldErrors({})
      setRunning(false)
      return
    }
    setRunning(true)
    setRunError(null)
    setFieldErrors({})
    setActionResult(null)
    try {
      const res = await authFetch(`/admin/reports/${encodeURIComponent(definition.key)}?${appliedQuery}`)
      if (res.status === 400) {
        const errors = parseFieldErrors(await res.json().catch(() => null))
        setFieldErrors(errors)
        setEnvelope(null)
        if (Object.keys(errors).length === 0) setRunError("The report parameters are invalid.")
        return
      }
      if (res.status === 403) throw new Error("You don't have permission to run this report.")
      if (res.status === 404) throw new Error("This report no longer exists.")
      if (!res.ok) throw new Error("Unable to run the report.")
      setEnvelope((await res.json()) as ReportEnvelope)
    } catch (err) {
      setEnvelope(null)
      setRunError(err instanceof Error ? err.message : "Unable to run the report.")
    } finally {
      setRunning(false)
    }
  }, [appliedQuery, authFetch, definition.key, missingRequired])

  useEffect(() => {
    void runReport()
  }, [runReport])

  const hasUserParam = definition.params.some((param) => param.type === "USER")
  useEffect(() => {
    if (!hasUserParam) return
    authFetch("/admin/staff")
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : []))
      .then((body) => setUsers(toShiftOwnerOptions(body)))
      .catch(() => setUsers([]))
  }, [authFetch, hasUserParam])

  const setValue = (name: string, value: string) => setDraft((current) => ({ ...current, [name]: value }))

  const choosePreset = (value: DatePreset) => {
    setPreset(value)
    if (value !== "custom") {
      const range = presetRange(value)
      setDraft((current) => ({ ...current, from: range.from, to: range.to }))
    }
  }

  const navigate = (values: ParamValues) => {
    const query = buildQuery(values)
    if (query === searchString) {
      void runReport()
      return
    }
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // New filters start again at the first page, keeping the chosen page size.
  // A parameter that doesn't apply to the other choices (appliesWhen) is left out.
  const apply = () => {
    const values: ParamValues = { ...draft }
    for (const param of definition.params) if (!paramApplies(param, draft)) values[param.name] = ""
    navigate({ ...values, page: "", size: paging.size })
  }

  const changePage = (page: number, size: number) =>
    navigate({ ...applied, page: page > 0 ? String(page) : "", size: String(size) })

  const executeRowAction = async (action: RowAction) => {
    setRowActionError(null)
    if (!action.path) return
    const outcome = await sendAction(authFetch, action.method ?? "POST", action.path)
    if (!outcome.ok) {
      setRowActionError({ label: action.label, message: outcome.message, blockers: outcome.blockers })
      return
    }
    if (action.onSuccess === "PRINT_RECEIPT" && isReceiptPayload(outcome.body)) {
      // A reprint never changes the order, so the report isn't reloaded for it.
      setReprint(outcome.body)
      return
    }
    await runReport()
  }

  const handleRowAction = async (row: ReportRow, action: RowAction) => {
    if (action.onSuccess === "OPEN_REPORT") {
      // Navigation only: no request.
      if (action.report) router.push(reportHref(action.report, action.params))
      return
    }
    if (action.confirm) {
      setPendingRowAction({ row, action })
      return
    }
    await executeRowAction(action)
  }

  const exportReport = async (format: "csv" | "xlsx") => {
    if (!envelope) return
    setExporting(format)
    setExportError(null)
    try {
      // Export what's on screen: the parameters the server says it applied.
      const values: ParamValues = {}
      for (const [name, value] of Object.entries(envelope.meta.params)) {
        // Exports always include every row, so paging is left out.
        if (value !== null && value !== undefined && !(PAGING_KEYS as readonly string[]).includes(name)) values[name] = String(value)
      }
      const query = buildQuery({ ...values, format })
      const res = await authFetch(`/admin/reports/${encodeURIComponent(definition.key)}/export?${query}`)
      if (!res.ok) {
        const errors = parseFieldErrors(await res.json().catch(() => null))
        throw new Error(Object.values(errors).join(" ") || "The export failed. Try again.")
      }
      const blob = await res.blob()
      const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), `${definition.key}.${format}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "The export failed. Try again.")
    } finally {
      setExporting(null)
    }
  }

  const knownFields = new Set([...definition.params.map((param) => param.name), ...EXPORT_ERROR_KEYS, ...PAGING_KEYS])
  const pagingError = PAGING_KEYS.map((key) => fieldErrors[key]).filter(Boolean).join(" ")
  const otherErrors = Object.entries(fieldErrors).filter(([field]) => !knownFields.has(field))
  const rangeErrors = [fieldErrors.from, fieldErrors.to].filter(Boolean)
  const exportFieldError = EXPORT_ERROR_KEYS.map((key) => fieldErrors[key]).filter(Boolean).join(" ")

  const describeValue = (param: ReportParam, value: string | number | boolean | null | undefined): string => {
    if (value === null || value === undefined || value === "") return "All"
    const text = String(value)
    switch (param.type) {
      case "DATE":
        return formatCalendarDate(text)
      case "BOOLEAN":
        return text === "true" ? "Yes" : "No"
      case "USER":
        return users.find((user) => String(user.id) === text)?.name ?? `User #${text}`
      case "ID":
        return meta?.paramLabels?.[param.name] ?? paramOptions(param).find((option) => option.value === text)?.label ?? text
      case "LIMIT":
        return text === "ALL" ? "All" : text
      default:
        return humaniseEnum(text)
    }
  }

  const meta = envelope?.meta
  const paramLabels = Object.values(meta?.paramLabels ?? {})
  const emptyStateParam = missingRequired ?? requiredParams.find((param) => fieldErrors[param.name])
  // What's on screen: the report, or the envelope an action answered with (the Z after Close Day).
  const shown = actionResult ?? envelope
  const statement = shown ? isStatement(shown) : false
  const exportFormats = meta?.exportFormats ?? ["csv", "xlsx"]

  const printStatement = (medium: PrintMedium) => {
    if (shown) print(medium, <ReportStatement envelope={shown} medium={medium} />)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">
            {definition.title}
            {paramLabels.length > 0 && <span className="font-normal text-muted-foreground"> · {paramLabels.join(" · ")}</span>}
          </h1>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{categoryLabel(definition.category)}</span>
          {meta?.amountsInclVat && <span className="text-xs text-muted-foreground">Amounts include VAT</span>}
        </div>
        <p className="text-sm text-muted-foreground">{definition.description}</p>
      </div>

      {envelope && !actionResult && (envelope.actions?.length ?? 0) > 0 && (
        <ReportActions actions={envelope.actions ?? []} onDone={(result) => (result ? setActionResult(result) : void runReport())} />
      )}

      {meta && (meta.notes?.length ?? 0) > 0 && (
        <details className="group rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            About this report
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {meta.notes?.map((note) => <li key={note}>{note}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Definition version {meta.definitionVersion}</p>
        </details>
      )}

      <form
        className="flex flex-wrap items-end gap-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        {hasRange && fromParam && toParam && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="report-preset">Date range</Label>
                <Select value={preset} onValueChange={(value) => choosePreset(value as DatePreset)}>
                  <SelectTrigger id="report-preset" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {DATE_PRESET_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {preset === "custom" && (
                <>
                  {[fromParam, toParam].map((param) => (
                    <div key={param.name} className="space-y-1">
                      <Label htmlFor={`report-${param.name}`}>{param.label}</Label>
                      <Input
                        id={`report-${param.name}`}
                        type="date"
                        value={draft[param.name] ?? ""}
                        onChange={(event) => setValue(param.name, event.target.value)}
                        aria-invalid={!!fieldErrors[param.name]}
                        className="w-[160px]"
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
            {rangeErrors.length > 0 && (
              <p role="alert" className="text-xs text-destructive">
                {rangeErrors.join(" ")}
              </p>
            )}
          </div>
        )}

        {otherParams.filter((param) => paramApplies(param, draft)).map((param) => (
          <ParamControl
            key={param.name}
            param={param}
            value={draft[param.name] ?? ""}
            onChange={(value) => setValue(param.name, value)}
            error={fieldErrors[param.name]}
            users={users}
          />
        ))}

        <Button type="submit" size="sm" disabled={running || !draftComplete}>
          {running ? "Running…" : "Apply"}
        </Button>
      </form>

      {otherErrors.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {otherErrors.map(([, message]) => message).join(" ")}
        </p>
      )}

      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {definition.params
              .filter((param) => param.name in meta.params)
              .map((param) => `${param.label}: ${describeValue(param, meta.params[param.name])}`)
              .join(" · ")}
            {" · "}Generated {formatJhbDateTime(meta.generatedAt)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {statement && (
              <>
                <Button size="sm" variant="outline" onClick={() => printStatement("A4")}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  Print A4
                </Button>
                <Button size="sm" variant="outline" onClick={() => printStatement("SLIP80")}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  Print slip
                </Button>
              </>
            )}
            {!actionResult && exportFormats.includes("csv") && (
              <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportReport("csv")}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {exporting === "csv" ? "Exporting…" : "Export CSV"}
              </Button>
            )}
            {!actionResult && exportFormats.includes("xlsx") && (
              <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportReport("xlsx")}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
              </Button>
            )}
          </div>
        </div>
      )}

      {(exportError || exportFieldError) && (
        <p role="alert" className="text-right text-sm text-destructive">
          {exportError ?? exportFieldError}
        </p>
      )}

      {emptyStateParam && !envelope ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          Choose {withArticle(emptyStateParam.label)} to see this report.
        </div>
      ) : runError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{runError}</p>
          <Button size="sm" variant="outline" onClick={() => void runReport()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : running && !envelope ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading report">
          <Skeleton className="h-10" />
          <Skeleton className="h-64" />
        </div>
      ) : shown ? (
        <div className={running ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"} aria-busy={running}>
          {actionResult && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <p className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Done. Showing {actionResult.meta.statementTitle ?? actionResult.meta.title}
                {actionResult.meta.reference ? ` ${actionResult.meta.reference}` : ""}. Print it now if you need it.
              </p>
              <div className="flex gap-2">
                {actionResult.meta.key !== definition.key && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={reportHref(actionResult.meta.key, actionResult.meta.params)}>Open as report</Link>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void runReport()}>
                  Back to {definition.title}
                </Button>
              </div>
            </div>
          )}
          <ReportChecks meta={shown.meta} checks={shown.checks ?? []} />
          {rowActionError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">
                {rowActionError.label}: {rowActionError.message}
              </p>
              {rowActionError.blockers.length > 0 && <BlockerList blockers={rowActionError.blockers} />}
            </div>
          )}
          {statement ? (
            <ReportStatement envelope={shown} />
          ) : (
            <>
              {shown.page?.paged ? (
                <ReportPaging page={shown.page} rowCount={shown.rows?.length ?? 0} onChange={changePage} disabled={running} error={pagingError} />
              ) : (
                shown.page && (
                  <p className="text-xs text-muted-foreground">
                    Showing {formatInt(shown.rows?.length ?? 0)} of {formatInt(shown.page.totalRows)} rows
                  </p>
                )
              )}
              <ReportTable
                title={definition.title}
                columns={shown.columns ?? []}
                rows={shown.rows ?? []}
                totals={shown.totals}
                sortable={!shown.page?.paged}
                onRowAction={handleRowAction}
              />
            </>
          )}
        </div>
      ) : pagingError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{pagingError}</p>
          <Button size="sm" variant="outline" onClick={() => changePage(0, Number(paging.size) || 50)}>
            Go to the first page
          </Button>
        </div>
      ) : null}

      <Dialog open={pendingRowAction !== null} onOpenChange={(open) => !open && setPendingRowAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingRowAction?.action.label}?</DialogTitle>
            <DialogDescription className="text-foreground">{pendingRowAction?.action.confirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingRowAction(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const pending = pendingRowAction
                setPendingRowAction(null)
                if (pending) void executeRowAction(pending.action)
              }}
            >
              {pendingRowAction?.action.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptReprintDialog receipt={reprint} onClose={() => setReprint(null)} />
      {portal}
    </div>
  )
}

function ParamControl({
  param,
  value,
  onChange,
  error,
  users,
}: {
  param: ReportParam
  value: string
  onChange: (value: string) => void
  error?: string
  users: UserOption[]
}) {
  const id = `report-${param.name}`
  // LIMIT always has a value ("ALL" by default), so it never gets the extra "All" item.
  const optional = !param.required && param.type !== "LIMIT" && (param.default === undefined || param.default === null)

  let control: React.ReactNode
  switch (param.type) {
    case "BOOLEAN":
      return (
        <div className="space-y-1">
          <div className="flex h-9 items-center gap-2">
            <Checkbox
              id={id}
              checked={value === "true"}
              onCheckedChange={(checked) => onChange(checked === true ? "true" : "false")}
              aria-invalid={!!error}
            />
            <Label htmlFor={id}>{param.label}</Label>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
      )
    case "DATE":
      control = (
        <Input id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={!!error} className="w-[160px]" />
      )
      break
    case "USER":
    case "ENUM":
    case "ID":
    case "LIMIT": {
      const options =
        param.type === "USER" ? users.map((user) => ({ value: String(user.id), label: user.name })) : paramOptions(param)
      const known = value === "" || options.some((option) => option.value === value)
      // A URL limit outside the offered list (e.g. ?limit=2) stays selected as an extra choice.
      if (!known && param.type === "LIMIT") options.push({ value, label: value })
      // An ID that is no longer an option (deleted account) shows as unselected; the server's 400 explains why.
      const shown = known || param.type === "LIMIT" ? value : ""
      control = (
        <Select value={shown === "" ? (optional ? ANY : "") : shown} onValueChange={(next) => onChange(next === ANY ? "" : next)}>
          <SelectTrigger id={id} className={param.type === "ID" ? "w-[220px]" : "w-[180px]"} aria-invalid={!!error}>
            <SelectValue placeholder={param.required ? selectPrompt(param) : "All"} />
          </SelectTrigger>
          <SelectContent>
            {optional && <SelectItem value={ANY}>All</SelectItem>}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    }
    case "INT":
      // Optional whole number; empty means "not set" and is left out of the URL.
      control = (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          aria-invalid={!!error}
          className="w-[120px]"
          placeholder="Any"
        />
      )
      break
    default:
      control = <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={!!error} className="w-[180px]" />
  }

  const missing = param.required && !isParamSet(param, value)

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {param.label}
        {param.required && <span className="ml-1 text-xs font-normal text-muted-foreground">(required)</span>}
      </Label>
      {control}
      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : (
        missing && <p className="text-xs text-muted-foreground">{selectPrompt(param)}</p>
      )}
    </div>
  )
}
