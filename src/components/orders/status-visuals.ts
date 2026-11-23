export type DisplayOrderStatus = "PENDING" | "IN_PROGRESS" | "DONE"

export const DONE_RETENTION_MS = 10 * 60 * 1000

// The kitchen display's note about how long done orders stay, from the same value the kitchen uses to drop them
// (T0-8): the text can't drift from the behaviour. A site setting for it is a backend request (see the T0-8 doc).
export function doneRetentionNotice(retentionMs: number = DONE_RETENTION_MS): string {
  const minutes = Math.round(retentionMs / 60_000)
  return `Done orders are kept here for ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
}

export function statusPillClass(status: DisplayOrderStatus): string {
  if (status === "PENDING") return "bg-amber-500/20 text-amber-200 ring-amber-400/30"
  if (status === "IN_PROGRESS") return "bg-blue-500/20 text-blue-200 ring-blue-400/30"
  return "bg-emerald-500/20 text-emerald-200 ring-emerald-400/30"
}

export function columnShellClass(status: DisplayOrderStatus): string {
  if (status === "PENDING") return "border-amber-500/30 bg-amber-500/5"
  if (status === "IN_PROGRESS") return "border-blue-500/30 bg-blue-500/5"
  return "border-emerald-500/30 bg-emerald-500/5"
}
