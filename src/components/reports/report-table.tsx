"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { VarianceText } from "@/components/pos-activity/shift-badges"
import { cn, formatZarCurrency } from "@/lib/utils"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  formatCalendarDate,
  formatDecimal,
  formatInt,
  formatPercent,
  isNumericColumn,
  statusLabel,
  type CellValue,
  type ReportColumn,
  type ReportRow,
  type StatusTone,
} from "@/lib/reports"

const TONE_STYLES: Record<StatusTone, string> = {
  positive: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  neutral: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  negative: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
}

const Dash = () => <span className="text-muted-foreground">—</span>

function ReportCell({ column, value, isTotal = false }: { column: ReportColumn; value: CellValue; isTotal?: boolean }) {
  if (value === null || value === undefined || value === "") return <Dash />
  // Totals hold labels such as "Total" or "Closing balance" in any column, even DATETIME: print them as they are.
  if (typeof value === "string" && (isTotal || (column.type !== "DATE" && column.type !== "DATETIME" && column.type !== "STATUS"))) {
    return <>{value}</>
  }
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>

  switch (column.type) {
    case "MONEY":
      return <>{typeof value === "number" ? formatZarCurrency(value) : value}</>
    case "INT":
      return <>{typeof value === "number" ? formatInt(value) : value}</>
    case "DECIMAL":
      return <>{typeof value === "number" ? formatDecimal(value) : value}</>
    case "PERCENT":
      return <>{typeof value === "number" ? formatPercent(value) : value}</>
    case "VARIANCE":
      return typeof value === "number" ? <VarianceText variance={value} /> : <>{value}</>
    case "DATE":
      return <span className="whitespace-nowrap">{formatCalendarDate(String(value))}</span>
    case "DATETIME":
      return <span className="whitespace-nowrap">{formatJhbDateTime(String(value))}</span>
    case "STATUS": {
      const text = String(value)
      const tone = column.statusTones?.[text] ?? "neutral"
      return (
        <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE_STYLES[tone])}>
          {statusLabel(text)}
        </span>
      )
    }
    default:
      return <>{String(value)}</>
  }
}

type SortState = { key: string; direction: "asc" | "desc" } | null

// Empty values sort last in both directions.
function compareValues(a: CellValue, b: CellValue, direction: 1 | -1): number {
  const aEmpty = a === null || a === undefined || a === ""
  const bEmpty = b === null || b === undefined || b === ""
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return (a - b) * direction
  return String(a).localeCompare(String(b), undefined, { numeric: true }) * direction
}

interface ReportTableProps {
  title: string
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: ReportRow | null
}

export function ReportTable({ title, columns, rows, totals }: ReportTableProps) {
  const [sort, setSort] = useState<SortState>(null)

  // Parameters can swap the column set (groupBy); a sort on a column from the old set resets to the server's order.
  const columnKeys = columns.map((column) => column.key).join("|")
  useEffect(() => {
    setSort(null)
  }, [columnKeys])

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const direction = sort.direction === "asc" ? 1 : -1
    return [...rows].sort((a, b) => compareValues(a[sort.key], b[sort.key], direction))
  }, [rows, sort])

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" }
      if (current.direction === "asc") return { key, direction: "desc" }
      return null // third press restores the server's order
    })
  }

  return (
    <div className="max-h-[65vh] overflow-auto rounded-md border">
      <table className="w-full caption-bottom text-sm" aria-label={title}>
        <caption className="sr-only">{title}</caption>
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
          <tr>
            {columns.map((column) => {
              const sorted = sort?.key === column.key ? sort.direction : null
              const numeric = isNumericColumn(column.type)
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                  className={cn("h-10 whitespace-nowrap px-2 align-middle font-medium text-muted-foreground", numeric ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      numeric && "flex-row-reverse",
                    )}
                  >
                    {column.label}
                    {sorted === "asc" ? (
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    ) : sorted === "desc" ? (
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
                    )}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-sm text-muted-foreground">
                No data for this period.
              </td>
            </tr>
          ) : (
            sortedRows.map((row, index) => (
              <tr key={index} className="border-b transition-colors hover:bg-muted/50">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-3 py-2 align-middle", isNumericColumn(column.type) && "text-right tabular-nums")}>
                    <ReportCell column={column} value={row[column.key]} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {totals && sortedRows.length > 0 && (
          <tfoot className="sticky bottom-0 z-10 bg-muted font-semibold shadow-[0_-1px_0_hsl(var(--border))]">
            <tr>
              {columns.map((column, index) => {
                const value = totals[column.key]
                const Cell = index === 0 ? "th" : "td"
                return (
                  <Cell
                    key={column.key}
                    scope={index === 0 ? "row" : undefined}
                    className={cn("px-3 py-2 text-left align-middle", isNumericColumn(column.type) && "text-right tabular-nums")}
                  >
                    {value === undefined ? null : <ReportCell column={column} value={value} isTotal />}
                  </Cell>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
