"use client"

// O4 contract section 7: what order views show for a sale made offline: "Offline sale", the collection number, the
// time it was sold (soldAt, in Johannesburg time) and, for a late sale, the day it was booked to. An online sale
// that took a slip's numbers (DUPLICATE) shows its collection number only. Nothing for any other order.

import { formatReceiptDateTime } from "@/lib/receipt"

export interface OfflineOrderFields {
  recordedOffline?: boolean | null
  soldAt?: string | null
  collectionNumber?: string | null
  bookedTradingDay?: string | null
}

// "2026-11-19" → "19/11/2026".
export function formatTradingDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : day
}

export function offlineOrderMarkTexts(order: OfflineOrderFields): string[] {
  const marks: string[] = []
  if (order.recordedOffline) marks.push("Offline sale")
  if (order.collectionNumber) marks.push(`Collection ${order.collectionNumber}`)
  const soldAt = order.recordedOffline ? formatReceiptDateTime(order.soldAt) : null
  if (soldAt) marks.push(`Sold ${soldAt}`)
  if (order.bookedTradingDay) marks.push(`Booked to ${formatTradingDay(order.bookedTradingDay)}`)
  return marks
}

export function OfflineOrderMarks({ order, className = "" }: { order: OfflineOrderFields; className?: string }) {
  const marks = offlineOrderMarkTexts(order)
  if (marks.length === 0) return null
  return (
    <span data-testid="offline-order-marks" className={`inline-flex flex-wrap gap-1 ${className}`}>
      {marks.map((mark) => (
        <span key={mark} className="rounded-full border border-sky-400/50 px-2 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
          {mark}
        </span>
      ))}
    </span>
  )
}
