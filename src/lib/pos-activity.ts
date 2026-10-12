import { formatZarCurrency } from "@/lib/utils"

// Types and formatting for the POS oversight endpoints (/admin/shifts, /shifts/open).
// Timestamps on these endpoints are ISO-8601 UTC with a trailing "Z".

export type ShiftDisplayStatus = "ON_SHIFT" | "CLOSED" | "OVERDUE"

export interface PersonRef {
  id: number
  name: string
  role?: string
}

export interface AdminShiftRow {
  shiftId: number
  owner: PersonRef
  displayStatus: ShiftDisplayStatus
  openedAt: string
  closedAt: string | null
  openingFloat: number
  closingCash: number | null
  expectedCash: number
  variance: number | null
  orderCount: number
}

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface ShiftActivityHeader extends AdminShiftRow {
  closedBy: PersonRef | null
  varianceReasonCode: string | null
  varianceNote: string | null
  varianceAuthorizedBy: PersonRef | null
}

export interface ExpectedCashBreakdown {
  openingFloat: number
  cashSales: number
  cashRefundsProcessed: number
  expectedCash: number
  source: "LIVE" | "SNAPSHOT" | "RECALCULATED"
  breakdownMismatch: boolean | null
  recomputed?: { cashSales: number; cashRefundsProcessed: number; expectedCash: number }
  storedExpectedCash?: number
}

export interface CountAmount {
  count: number
  amount: number
}

export type PaymentMethodCode = "CASH" | "CARD" | "ACCOUNT"

export interface ShiftActivityTotals {
  orderCount: number
  salesByMethod: Record<PaymentMethodCode, number>
  voids: CountAmount
  refunds: CountAmount
  // Discounts given at sale on orders sold in this shift.
  discounts: CountAmount
  extrasRemoved: CountAmount
  // Old after-payment discounts processed in this shift. Present only when non-zero.
  legacyDiscountsAfterPayment?: CountAmount
}

export interface ShiftActivityOrder {
  orderId: number
  orderNumber: number
  createdAt: string
  rungBy: PersonRef
  status: string
  originalTotal: number
  total: number
  saleDiscount?: number
  payments: { method: PaymentMethodCode; amount: number }[]
  // True for a discount at sale or an old after-payment discount.
  discounted: boolean
  extrasRemoved: boolean
}

export type AdjustmentType = "VOID" | "REFUND" | "DISCOUNT" | "EXTRAS_REMOVED"

export interface ShiftActivityAdjustment {
  adjustmentId: number
  createdAt: string
  orderId: number
  orderNumber: number
  type: AdjustmentType
  amount: number
  refundMethod: "CASH" | "ACCOUNT_BALANCE"
  reasonCode: string
  note: string | null
  requestedBy: PersonRef | null
  authorizedBy: PersonRef | null
  orderSoldInShiftId: number
  crossShift: boolean
}

export interface ShiftActivity {
  shift: ShiftActivityHeader
  expectedCashBreakdown: ExpectedCashBreakdown
  totals: ShiftActivityTotals
  orders: ShiftActivityOrder[]
  adjustments: ShiftActivityAdjustment[]
}

export interface OpenShift {
  shiftId: number
  owner: PersonRef
  ownedByCaller: boolean
  openedAt: string
  openingFloat: number
}

const TIME_ZONE = "Africa/Johannesburg"

const dateTimeFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

// en-CA formats dates as YYYY-MM-DD, which is what the API's from/to params expect.
const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function formatJhbDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date)
}

export function formatJhbTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date)
}

// Today (or today minus `daysAgo`) as a Johannesburg calendar date, YYYY-MM-DD.
export function jhbIsoDate(daysAgo = 0): string {
  return isoDateFormatter.format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000))
}

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatZarCurrency(value)
}

export type VarianceTone = "short" | "over" | "exact"

export function describeVariance(variance: number): { tone: VarianceTone; label: string } {
  const cents = Math.round(variance * 100)
  if (cents < 0) return { tone: "short", label: `−${formatZarCurrency(-variance)} short` }
  if (cents > 0) return { tone: "over", label: `+${formatZarCurrency(variance)} over` }
  return { tone: "exact", label: formatZarCurrency(0) }
}

export const SHIFT_STATUS_LABELS: Record<ShiftDisplayStatus, string> = {
  ON_SHIFT: "On shift",
  CLOSED: "Closed",
  OVERDUE: "Open since yesterday",
}

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  VOID: "Void",
  REFUND: "Refund",
  // A discount at sale is never an adjustment, so any DISCOUNT row is an old after-payment one.
  DISCOUNT: "Discount (legacy)",
  EXTRAS_REMOVED: "Extras removed",
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodCode, string> = {
  CASH: "Cash",
  CARD: "Card",
  ACCOUNT: "Account",
}

export const REFUND_METHOD_LABELS: Record<ShiftActivityAdjustment["refundMethod"], string> = {
  CASH: "Cash",
  ACCOUNT_BALANCE: "Account credit",
}

// Turns enum codes like CASH_COUNTING_ERROR into "Cash counting error".
export function humaniseCode(code: string | null | undefined): string {
  if (!code) return "—"
  const words = code.toLowerCase().split("_").join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// Error bodies are { error, code? }; 403/404 return an empty body.
export async function readApiError(res: Response, fallback: string): Promise<{ message: string; code?: string }> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const message =
    body && typeof body.error === "string" && body.error.trim()
      ? body.error
      : body && typeof body.message === "string" && body.message.trim()
        ? body.message
        : res.status === 403
          ? "You don't have permission to view this."
          : fallback
  const code = body && typeof body.code === "string" ? body.code : undefined
  return { message, code }
}
