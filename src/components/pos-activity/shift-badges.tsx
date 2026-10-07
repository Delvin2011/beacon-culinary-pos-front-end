import { cn } from "@/lib/utils"
import {
  SHIFT_STATUS_LABELS,
  describeVariance,
  type ShiftDisplayStatus,
} from "@/lib/pos-activity"

const STATUS_STYLES: Record<ShiftDisplayStatus, string> = {
  ON_SHIFT: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  OVERDUE: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
}

const STATUS_DOTS: Record<ShiftDisplayStatus, string> = {
  ON_SHIFT: "bg-emerald-500",
  CLOSED: "bg-slate-400",
  OVERDUE: "bg-amber-500",
}

export function ShiftStatusBadge({ status, className }: { status: ShiftDisplayStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOTS[status])} aria-hidden />
      {SHIFT_STATUS_LABELS[status]}
    </span>
  )
}

export function AdminChip() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded border border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
      Admin
    </span>
  )
}

const VARIANCE_STYLES = {
  short: "text-red-600 dark:text-red-400 font-medium",
  over: "text-amber-700 dark:text-amber-400 font-medium",
  exact: "text-foreground",
}

export function VarianceText({ variance }: { variance: number | null }) {
  if (variance === null) return <span className="text-muted-foreground">—</span>
  const { tone, label } = describeVariance(variance)
  return <span className={cn("whitespace-nowrap", VARIANCE_STYLES[tone])}>{label}</span>
}
