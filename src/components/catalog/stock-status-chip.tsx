import type { StockStatus } from "@/lib/light-meal-stock"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<StockStatus, string> = {
  OK: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  LOW: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  OUT: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  NOT_TRACKED: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
}

export function stockStatusLabel(status: StockStatus, unitsAvailable: number | null | undefined): string {
  if (status === "OUT") return "No stock"
  if (status === "NOT_TRACKED") return "No recipe"
  return `${unitsAvailable ?? 0} available`
}

interface StockStatusChipProps {
  status: StockStatus | null | undefined
  unitsAvailable?: number | null
  size?: "sm" | "lg"
  // Overrides the label, e.g. the panel's large "OK" / "Low" chip.
  label?: string
  className?: string
}

// A light meal's stock: OK green "14 available", LOW amber, OUT red "No stock", NOT_TRACKED grey "No recipe".
export function StockStatusChip({ status, unitsAvailable, size = "sm", label, className }: StockStatusChipProps) {
  if (!status) return null
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border font-medium",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        STATUS_STYLES[status] ?? STATUS_STYLES.NOT_TRACKED,
        className,
      )}
    >
      {label ?? stockStatusLabel(status, unitsAvailable)}
    </span>
  )
}
