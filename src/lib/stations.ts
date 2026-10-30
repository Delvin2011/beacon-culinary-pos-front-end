// Orders are split by station: the kitchen makes meals, the bar makes hot drinks, and NONE items
// (cold drinks) are handed over at the till. Each station moves its own part through PENDING → IN_PROGRESS → DONE.

import type { Station } from "@/lib/catalog"

export type StationStatus = "PENDING" | "IN_PROGRESS" | "DONE"

// COLLECTED: a cold-drinks-only order, handed over at once.
export type OrderStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "COLLECTED" | "VOIDED" | "REFUNDED"

export interface OtherStation {
  station: Station
  status: StationStatus
}

export interface OrderStation {
  station: Station
  status: StationStatus
  updatedAt?: string | null
  updatedBy?: { id: number; name: string } | null
}

const STATION_LABELS: Record<Station, string> = { KITCHEN: "Kitchen", BAR: "Bar", NONE: "Counter" }

export function stationLabel(station: Station): string {
  return STATION_LABELS[station] ?? station
}

export function stationStatusLabel(status: StationStatus): string {
  if (status === "IN_PROGRESS") return "In progress"
  if (status === "DONE") return "Done"
  return "Pending"
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  COLLECTED: "Collected",
  VOIDED: "Voided",
  REFUNDED: "Refunded",
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status.replaceAll("_", " ").toLowerCase()
}

// Chip colours on the dark station screens.
export function stationChipClass(status: StationStatus): string {
  if (status === "IN_PROGRESS") return "bg-blue-500/15 text-blue-200 ring-blue-400/30"
  if (status === "DONE") return "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30"
  return "bg-amber-500/15 text-amber-200 ring-amber-400/30"
}
