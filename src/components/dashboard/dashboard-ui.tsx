"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import type { SectionState } from "@/hooks/use-dashboard-section"
import type { LayoutSection, ReportLink } from "@/lib/dashboard"
import { reportHref } from "@/lib/reports"
import { cn } from "@/lib/utils"

// Design tokens (light theme, matches the rest of the back office).
export const DASH = {
  ground: "#F5F6F8",
  card: "#FFFFFF",
  border: "#E3E6EB",
  rule: "#EEF0F4",
  ink: "#172033",
  muted: "#5B6475",
  accent: "#2455D6",
  accentLight: "#A9BEF2",
  amber: "#C77700",
  red: "#B42318",
  teal: "#0B6B5D",
  grid: "#E3E6EB",
} as const

export type ChipTone = "red" | "amber" | "teal" | "neutral" | "blue"

const CHIP_CLASSES: Record<ChipTone, string> = {
  red: "bg-[#FDE8E6] text-[#B42318]",
  amber: "bg-[#FFF1DB] text-[#8A4B00]",
  teal: "bg-[#DDF4EE] text-[#0B6B5D]",
  neutral: "bg-[#EEF0F4] text-[#3B4457]",
  blue: "bg-[#E8EEFC] text-[#1B3FA8]",
}

export function Chip({ tone, children, className }: { tone: ChipTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold", CHIP_CLASSES[tone], className)}>
      {children}
    </span>
  )
}

// Flex sizing per section so the cards pair up as in the design and re-flow when a section is missing.
const SECTION_FLEX: Record<string, string> = {
  attention: "flex-[2_1_520px]",
  now: "flex-[1_1_320px]",
  today: "basis-full",
  "sales-trend": "flex-[2_1_520px]",
  "sales-mix": "flex-[1_1_320px]",
  "busy-hours": "flex-[1_1_440px]",
  heatmap: "flex-[1_1_440px]",
  "top-sellers": "flex-[1_1_440px]",
  "sell-through": "flex-[1_1_440px]",
  "light-meal-stock": "basis-full",
  "payment-mix": "flex-[1_1_250px]",
  basket: "flex-[1_1_250px]",
  waiting: "flex-[1_1_250px]",
  "account-customers": "flex-[1_1_250px]",
}

export function sectionFlex(key: string): string {
  return SECTION_FLEX[key] ?? "flex-[1_1_320px]"
}

export const cardClass = "min-w-0 rounded-xl border border-[#E3E6EB] bg-white p-5 text-[#172033]"

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-[#5B6475]">{children}</p>
}

export function ReportLinkButton({ link, label }: { link: ReportLink | null | undefined; label: string }) {
  if (!link) return null
  return (
    <Link
      href={reportHref(link.key, link.params)}
      className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-[#1B3FA8] hover:text-[#142F7E] hover:underline"
    >
      {label}
    </Link>
  )
}

export function UpdatingNote({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span role="status" className="text-xs font-medium text-[#5B6475]">
      Updating…
    </span>
  )
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FDE8E6] px-3 py-1 text-[13px] text-[#B42318]">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-[44px] items-center rounded-md px-3 font-semibold text-[#B42318] underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </div>
  )
}

interface SectionCardProps<T> {
  section: LayoutSection
  state: SectionState<T>
  // Under the title, e.g. "Before discounts".
  subtitle?: ReactNode
  // Right of the title (toggles, links).
  headerExtra?: ReactNode
  // Next to the title (count chip).
  titleAdornment?: ReactNode
  skeletonHeight?: string
  children: (envelope: NonNullable<SectionState<T>["envelope"]>) => ReactNode
  className?: string
}

// The frame every section shares: title from the layout (verbatim), a skeleton on the first load, the last good
// numbers kept on refresh with "Updating…", and Retry when the section fails.
export function SectionCard<T>({
  section,
  state,
  subtitle,
  headerExtra,
  titleAdornment,
  skeletonHeight = "h-40",
  children,
  className,
}: SectionCardProps<T>) {
  const { envelope, loading, updating, error, retry } = state
  const headingId = `dash-${section.key}-title`

  return (
    <section aria-labelledby={headingId} aria-busy={loading || updating} className={cn(cardClass, sectionFlex(section.key), className)}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id={headingId} className="text-base font-bold">
              {section.title}
            </h2>
            {envelope && titleAdornment}
            <UpdatingNote show={updating} />
          </div>
          {subtitle && envelope && <div className="mt-0.5 text-[13px] text-[#5B6475]">{subtitle}</div>}
        </div>
        {envelope && headerExtra}
      </div>

      {loading ? (
        <div className="space-y-3" aria-label={`Loading ${section.title}`}>
          <Skeleton className="h-4 w-2/3 bg-[#EEF0F4]" />
          <Skeleton className={cn("w-full bg-[#EEF0F4]", skeletonHeight)} />
        </div>
      ) : envelope ? (
        children(envelope)
      ) : null}

      {error && !loading && <SectionError message={error} onRetry={retry} />}
    </section>
  )
}

// Horizontal bar (top sellers, account customers): width scaled to the largest value given.
export function ScaledBar({ value, max, color = DASH.accent }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div aria-hidden="true" className="h-2 rounded bg-[#EEF0F4]">
      <div className="h-2 rounded" style={{ width: `${width}%`, background: color }} />
    </div>
  )
}
