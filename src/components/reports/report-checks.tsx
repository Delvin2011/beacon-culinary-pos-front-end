"use client"

import { useId, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCheckValue, overallCheckStatus, type ReportCheck, type ReportEnvelope } from "@/lib/reports"

const OVERALL = {
  PASS: {
    label: "Reconciles ✓",
    icon: CheckCircle2,
    style: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  },
  WARN: {
    label: "Reconciles, with notes",
    icon: AlertTriangle,
    style: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  },
  FAIL: {
    label: "Does not reconcile",
    icon: XCircle,
    style: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  },
} as const

const STATUS_TEXT_STYLES: Record<string, string> = {
  PASS: "text-emerald-700 dark:text-emerald-400",
  WARN: "text-amber-700 dark:text-amber-400",
  FAIL: "text-red-700 dark:text-red-400",
}

function checksAsText(meta: ReportEnvelope["meta"], checks: ReportCheck[]): string {
  const params = Object.entries(meta.params)
    .map(([name, value]) => `${name}=${value ?? ""}`)
    .join("&")
  const lines = [
    `Report: ${meta.key} (definition v${meta.definitionVersion})`,
    `Parameters: ${params}`,
    `Generated: ${meta.generatedAt}`,
    "",
    ...checks.map((check) =>
      [
        `[${check.status}] ${check.label} (${check.key})`,
        `  expected=${check.expected ?? "null"} actual=${check.actual ?? "null"} difference=${check.difference ?? "null"} unit=${check.unit}`,
        check.detail ? `  ${check.detail}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
  return lines.join("\n")
}

export function ReportChecks({ meta, checks }: { meta: ReportEnvelope["meta"]; checks: ReportCheck[] }) {
  const overall = overallCheckStatus(checks)
  const [expanded, setExpanded] = useState(overall === "FAIL")
  const [copied, setCopied] = useState(false)
  const panelId = useId()

  if (!overall) return null
  const { label, icon: Icon, style } = OVERALL[overall]

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(checksAsText(meta, checks))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", style)}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </span>
          <span className="text-muted-foreground">
            {checks.length} reconciliation check{checks.length === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden />
      </button>

      {expanded && (
        <div id={panelId} className="space-y-2 border-t p-3">
          {overall === "FAIL" && (
            <p className="text-sm text-red-700 dark:text-red-400">
              A failing check means the figures don&apos;t agree with each other. Copy the details below and report it.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Reconciliation checks">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Check</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Expected</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Actual</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.key} className="border-b last:border-0 align-top">
                    <td className="py-1.5 pr-3">
                      {check.label}
                      {check.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{check.detail}</span>}
                    </td>
                    <td className={cn("py-1.5 pr-3 font-semibold", STATUS_TEXT_STYLES[check.status])}>{check.status}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCheckValue(check.expected, check.unit)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCheckValue(check.actual, check.unit)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCheckValue(check.difference, check.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void copyDetails()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy details"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
