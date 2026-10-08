"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { ReportsShell } from "@/components/reports/reports-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useReportCatalogue } from "@/hooks/use-report-catalogue"
import { categoryLabel, compareCategories, templateLabel, type ReportDefinition } from "@/lib/reports"

export default function ReportsHubPage() {
  return (
    <ReportsShell>
      <ReportsHub />
    </ReportsShell>
  )
}

function ReportsHub() {
  const { reports, loading, error, reload } = useReportCatalogue()

  // Only categories that have reports for this caller; the server already orders reports within them.
  const groups = useMemo(() => {
    const byCategory = new Map<string, ReportDefinition[]>()
    for (const report of reports) {
      const list = byCategory.get(report.category) ?? []
      list.push(report)
      byCategory.set(report.category, list)
    }
    return Array.from(byCategory.entries()).sort(([a], [b]) => compareCategories(a, b))
  }, [reports])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Choose a report to run. All amounts include VAT.</p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No reports available.</p>
      ) : (
        groups.map(([category, list]) => (
          <section key={category} aria-labelledby={`category-${category}`} className="space-y-3">
            <h2 id={`category-${category}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {categoryLabel(category)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((report) => (
                <Link
                  key={report.key}
                  href={`/reports/${encodeURIComponent(report.key)}`}
                  className="group flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{report.title}</span>
                      <span className="rounded border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {templateLabel(report.template)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{report.description}</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
