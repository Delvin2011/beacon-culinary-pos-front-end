// Light meal stock: how many units the Kitchen can make from its ingredients, the Review panel and the batch
// Request stock prompt. Contract: LIGHT_MEAL_STOCK.md (backend repo).
//   GET  /admin/meal-catalog/{id}/stock-review → StockReview
//   POST /stock-requests { requestType: "ISSUE", lines } → the request (Main Store → Kitchen)
// Advice only: a meal that is LOW or OUT can still be sold unless someone marks it out today.

import { parseApiError } from "@/lib/catalog"

// null on set meals and planned till options.
export type StockStatus = "OK" | "LOW" | "OUT" | "NOT_TRACKED"

export type Uom = "EACH" | "KG" | "LITRE" | "LOAF" | "ROLL" | "PACK" | "DOZEN" | "BOX" | "PAIR" | string

export interface StockReviewLine {
  ingredientId: number
  name: string
  uom: Uom
  perUnit: number
  // Either can be negative: the ledger runs ahead of reality.
  kitchenAvailable: number
  mainStoreAvailable: number
  unitsPossible: number
  status: StockStatus
}

export interface StockReview {
  mealId: number
  name: string
  // false: no recipe, lines is empty and unitsAvailable / limitingIngredient are null.
  tracked: boolean
  status: StockStatus
  unitsAvailable: number | null
  limitingIngredient: string | null
  lowStockUnits: number
  outToday: boolean
  lines: StockReviewLine[]
}

export const DEFAULT_LOW_STOCK_UNITS = 10
export const MAX_LOW_STOCK_UNITS = 10000
export const MAX_BATCH_UNITS = 1000
export const BATCH_QUICK_PICKS = [10, 20, 50] as const

const UOM_LABELS: Record<string, string> = { EACH: "each", KG: "kg", LITRE: "L" }

export function formatUom(uom: Uom): string {
  return UOM_LABELS[uom] ?? String(uom ?? "").toLowerCase()
}

// Up to four decimals, trailing zeros dropped: 0.0200 → "0.02", 14.0000 → "14". Negatives keep their sign.
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const rounded = roundQuantity(value)
  return String(rounded === 0 ? 0 : rounded)
}

export function formatQuantityWithUom(value: number, uom: Uom): string {
  return `${formatQuantity(value)} ${formatUom(uom)}`
}

// Stock requests take at most 4 decimals (the minimum is 0.0001).
export function roundQuantity(value: number): number {
  return Math.round(value * 10000) / 10000
}

// Units × per unit for every line: the full batch on top of what's in the Kitchen, or with onlyMissing just the
// part the Kitchen can't cover (max 0). Zero rows are dropped when onlyMissing is on.
export function batchQuantities(lines: StockReviewLine[], units: number, onlyMissing: boolean): Array<{ line: StockReviewLine; quantity: number }> {
  return lines
    .map((line) => {
      const full = units * line.perUnit
      return { line, quantity: roundQuantity(onlyMissing ? Math.max(0, full - line.kitchenAvailable) : full) }
    })
    .filter((row) => !onlyMissing || row.quantity > 0)
}

export function parseBatchUnits(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const units = Number(trimmed)
  return units >= 1 && units <= MAX_BATCH_UNITS ? units : null
}

// Low-stock level on the meal form: whole number 0–10000. Blank is allowed (the server keeps or defaults it).
export function parseLowStockUnits(value: string): number | null | "invalid" {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return "invalid"
  const units = Number(trimmed)
  return units <= MAX_LOW_STOCK_UNITS ? units : "invalid"
}

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export async function fetchStockReview(authFetch: AuthFetch, mealId: number): Promise<StockReview> {
  const res = await authFetch(`/admin/meal-catalog/${mealId}/stock-review`)
  const body = (await res.json().catch(() => null)) as unknown
  if (!res.ok || !body || typeof body !== "object") {
    const error = parseApiError(body, "Unable to load the stock review.")
    if (res.status === 404) throw new Error("This meal no longer exists.")
    if (res.status === 403) throw new Error("You don't have permission to review stock.")
    if (error.code === "STOCK_REVIEW_NOT_APPLICABLE") throw new Error("Stock review is only for light meals.")
    throw new Error(error.message)
  }
  const review = body as StockReview
  return { ...review, lines: Array.isArray(review.lines) ? review.lines : [] }
}

// An Issue is always Main Store → Kitchen: no locationId. Stock requests have no note field yet.
export async function submitIssueRequest(
  authFetch: AuthFetch,
  lines: Array<{ ingredientId: number; quantity: number }>,
): Promise<{ id?: number; status?: string }> {
  const res = await authFetch("/stock-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "ISSUE", lines }),
  })
  const body = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    if (res.status === 403) throw new Error("You don't have permission to request stock.")
    throw new Error(parseApiError(body, "Unable to submit the stock request.").message)
  }
  return body && typeof body === "object" ? (body as { id?: number; status?: string }) : {}
}
