"use client"

import { ReportCell } from "@/components/reports/report-table"
import { cn } from "@/lib/utils"
import {
  isNumericColumn,
  onMedium,
  type KeyValueSection,
  type PrintMedium,
  type ReportColumn,
  type ReportEnvelope,
  type ReportSection,
  type SignatureSection,
  type TableSection,
} from "@/lib/reports"

// "SCREEN" shows every section; A4 prints every section; SLIP80 prints only slip sections and slipColumns.
export type StatementMedium = "SCREEN" | PrintMedium

const MAX_SLIP_COLUMNS = 3

function KeyValueList({ section, medium }: { section: KeyValueSection; medium: StatementMedium }) {
  return (
    <dl className={medium === "SLIP80" ? "space-y-0.5" : "space-y-1"}>
      {section.items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={cn("flex justify-between gap-4", item.emphasis === "TOTAL" && "mt-1 border-t border-foreground/30 pt-1 font-bold")}
        >
          <dt className={item.emphasis === "TOTAL" ? "" : "text-muted-foreground print:text-inherit"}>{item.label}</dt>
          <dd className="text-right tabular-nums">
            <ReportCell column={{ key: item.label, label: item.label, type: item.type }} value={item.value} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function StatementTable({ section, medium }: { section: TableSection; medium: StatementMedium }) {
  let columns: ReportColumn[] = section.columns
  if (medium === "SLIP80") {
    const slip = section.slipColumns ?? []
    columns = (slip.length > 0 ? section.columns.filter((column) => slip.includes(column.key)) : section.columns).slice(0, MAX_SLIP_COLUMNS)
  }
  const cellClass = (column: ReportColumn) =>
    cn(medium === "SLIP80" ? "px-0.5 py-0.5" : "px-2 py-1.5", "align-top", isNumericColumn(column.type) ? "text-right tabular-nums" : "text-left")

  return (
    <div className={medium === "SCREEN" ? "overflow-x-auto rounded-md border" : ""}>
      <table className="w-full border-collapse" aria-label={section.title}>
        <thead>
          <tr className="border-b border-foreground/30">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn(cellClass(column), "font-semibold", medium === "SCREEN" && "text-muted-foreground")}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={cn(cellClass(columns[0] ?? { key: "", label: "", type: "TEXT" }), "text-muted-foreground")}>
                None.
              </td>
            </tr>
          ) : (
            section.rows.map((row, index) => (
              <tr key={index} className="border-b border-foreground/10 last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    <ReportCell column={column} value={row[column.key]} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {section.totals && section.rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-foreground/30 font-semibold">
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {section.totals?.[column.key] === undefined ? null : <ReportCell column={column} value={section.totals[column.key]} isTotal />}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function SignatureLines({ section, medium }: { section: SignatureSection; medium: StatementMedium }) {
  return (
    <div className={medium === "SLIP80" ? "space-y-5 pt-2" : "grid gap-8 pt-4 sm:grid-cols-2"}>
      {section.labels.map((label) => (
        <div key={label} className="flex items-end gap-2">
          <span className="shrink-0">{label}:</span>
          <span className="h-6 flex-1 border-b border-current" aria-label={`${label} signature`} />
        </div>
      ))}
    </div>
  )
}

function SectionBody({ section, medium }: { section: ReportSection; medium: StatementMedium }) {
  switch (section.type) {
    case "KEY_VALUE":
      return <KeyValueList section={section as KeyValueSection} medium={medium} />
    case "TABLE":
      return <StatementTable section={section as TableSection} medium={medium} />
    case "SIGNATURE_LINES":
      return <SignatureLines section={section as SignatureSection} medium={medium} />
    default:
      return null
  }
}

// Renders a STATEMENT envelope (X, Z and Cashier Readings) from its sections, for screen, A4 or the 80 mm slip.
export function ReportStatement({ envelope, medium = "SCREEN" }: { envelope: ReportEnvelope; medium?: StatementMedium }) {
  const { meta } = envelope
  const all = envelope.sections ?? []
  const sections = medium === "SCREEN" ? all : all.filter((section) => onMedium(section, medium))
  const header = sections.filter((section) => !section.title)
  const body = sections.filter((section) => section.title)

  return (
    <article
      className={cn(
        medium === "SLIP80"
          ? "w-[72mm] font-mono text-[11px] leading-snug"
          : medium === "A4"
            ? "text-[12px] leading-relaxed"
            : "rounded-lg border bg-card p-4 text-sm sm:p-6",
      )}
    >
      <header className={cn("space-y-2", medium === "SLIP80" ? "text-center" : "border-b border-foreground/20 pb-3")}>
        {meta.business?.name && <p className="text-xs uppercase tracking-wide">{meta.business.name}</p>}
        <h2 className={cn("font-bold", medium === "SLIP80" ? "text-sm" : "text-xl")}>
          {meta.statementTitle ?? meta.title}
          {meta.reference && <span className="ml-2 font-semibold">{meta.reference}</span>}
        </h2>
        {meta.interim && (
          <p className="rounded border-2 border-amber-500 bg-amber-50 px-2 py-1 text-center font-bold uppercase tracking-widest text-amber-900 print:border-black print:bg-transparent print:text-black">
            Interim · shift still open
          </p>
        )}
        {header.map((section) => (
          <div key={section.key} className={medium === "SLIP80" ? "text-left" : ""}>
            <SectionBody section={section} medium={medium} />
          </div>
        ))}
      </header>

      <div className={medium === "SLIP80" ? "mt-2 space-y-3" : "mt-4 space-y-5"}>
        {body.map((section) => (
          <section key={section.key} aria-labelledby={`statement-${section.key}`} className="space-y-1.5">
            <h3
              id={`statement-${section.key}`}
              className={cn("font-semibold", medium === "SLIP80" ? "border-b border-dashed border-current uppercase" : "text-xs uppercase tracking-wide text-muted-foreground print:text-inherit")}
            >
              {section.title}
            </h3>
            <SectionBody section={section} medium={medium} />
          </section>
        ))}
      </div>
    </article>
  )
}
