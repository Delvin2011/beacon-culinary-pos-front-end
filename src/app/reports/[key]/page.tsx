"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useReportCatalogue } from "@/hooks/use-report-catalogue"
import { ReportsShell } from "@/components/reports/reports-shell"
import { ReportTable } from "@/components/reports/report-table"
import { ReportChecks } from "@/components/reports/report-checks"
import { Button } from "@/components/ui/button"
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
  humaniseEnum,
  parseFieldErrors,
  presetRange,
  resolveParamDefault,
  type DatePreset,
  type ReportDefinition,
  type ReportEnvelope,
  type ReportParam,
} from "@/lib/reports"

// Radix Select can't use "" as an item value, so optional selects use this for "All".
const ANY = "__any"
// Field-error keys that belong next to the export buttons rather than a filter.
const EXPORT_ERROR_KEYS = ["export", "format"]

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
  const appliedQuery = buildQuery(applied)

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

  const runReport = useCallback(async () => {
    setRunning(true)
    setRunError(null)
    setFieldErrors({})
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
  }, [appliedQuery, authFetch, definition.key])

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

  const apply = () => {
    const query = buildQuery(draft)
    if (query === searchString) {
      void runReport()
      return
    }
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const exportReport = async (format: "csv" | "xlsx") => {
    if (!envelope) return
    setExporting(format)
    setExportError(null)
    try {
      // Export what's on screen: the parameters the server says it applied.
      const values: ParamValues = {}
      for (const [name, value] of Object.entries(envelope.meta.params)) {
        if (value !== null && value !== undefined) values[name] = String(value)
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

  const knownFields = new Set([...definition.params.map((param) => param.name), ...EXPORT_ERROR_KEYS])
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
      default:
        return humaniseEnum(text)
    }
  }

  const meta = envelope?.meta

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{definition.title}</h1>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{categoryLabel(definition.category)}</span>
          {meta?.amountsInclVat && <span className="text-xs text-muted-foreground">Amounts include VAT</span>}
        </div>
        <p className="text-sm text-muted-foreground">{definition.description}</p>
      </div>

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

        {otherParams.map((param) => (
          <ParamControl
            key={param.name}
            param={param}
            value={draft[param.name] ?? ""}
            onChange={(value) => setValue(param.name, value)}
            error={fieldErrors[param.name]}
            users={users}
          />
        ))}

        <Button type="submit" size="sm" disabled={running}>
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
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportReport("csv")}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void exportReport("xlsx")}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </Button>
          </div>
        </div>
      )}

      {(exportError || exportFieldError) && (
        <p role="alert" className="text-right text-sm text-destructive">
          {exportError ?? exportFieldError}
        </p>
      )}

      {runError ? (
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
      ) : envelope ? (
        <div className={running ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"} aria-busy={running}>
          <ReportChecks meta={envelope.meta} checks={envelope.checks ?? []} />
          <ReportTable title={definition.title} columns={envelope.columns} rows={envelope.rows} totals={envelope.totals} />
        </div>
      ) : null}
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
  const optional = param.default === undefined || param.default === null

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
    case "ENUM": {
      const options =
        param.type === "USER"
          ? users.map((user) => ({ value: String(user.id), label: user.name }))
          : (param.options ?? []).map((option) => ({ value: option, label: humaniseEnum(option) }))
      control = (
        <Select value={value === "" ? ANY : value} onValueChange={(next) => onChange(next === ANY ? "" : next)}>
          <SelectTrigger id={id} className="w-[180px]" aria-invalid={!!error}>
            <SelectValue placeholder="All" />
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
    default:
      control = <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={!!error} className="w-[180px]" />
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{param.label}</Label>
      {control}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
