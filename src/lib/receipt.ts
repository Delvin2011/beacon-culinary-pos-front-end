// What a printed receipt or kitchen ticket needs from an order (O2b contract 1, 3–7). The server's OrderDto fits it
// as is: the 201, the O1 replay, GET /orders/{id} and the admin reprint. O4 builds one locally for an offline sale
// (offline-receipt.ts): it has the till's receipt and collection numbers and the local VAT, but no orderNumber.
// Never build any of them here.

import type { OrderComplimentary } from "@/lib/complimentary"

export interface ReceiptExtra {
  id?: number | string
  componentName: string
  quantity: number
  lineTotal: number
  // Removed after the sale. Still printed: the receipt is a copy of the sale and its lines add up to the total.
  adjusted?: boolean
}

export interface ReceiptLine {
  id?: number | string
  name: string
  quantity: number
  lineTotal: number
  station?: string | null
  extras?: ReceiptExtra[]
}

// amountTendered / changeDue (CASH), cardReference (CARD) and accountId (ACCOUNT) are left out when they don't apply.
export interface ReceiptPayment {
  id?: number | string
  method: string
  amount: number
  amountTendered?: number
  changeDue?: number
  cardReference?: string
  accountId?: number
}

export interface ReceiptReprint {
  copyNumber: number
  reprintedBy: { id: number; name: string }
  reprintedAt: string
}

export interface ReceiptOrder {
  id?: number
  orderNumber?: number | null
  receiptNumber?: string | null
  // UTC without a zone suffix.
  createdAt?: string | null
  orderKind?: string | null
  tillCode?: string | null
  tillName?: string | null
  cashierName?: string | null
  total?: number
  // The total to print: `total` drops after a void or refund.
  originalTotal?: number | null
  preDiscountTotal?: number | null
  saleDiscount?: number | null
  // null on orders from before O2b.
  vatRate?: number | null
  vatIncludedAmount?: number | null
  lines?: ReceiptLine[]
  payments?: ReceiptPayment[]
  complimentary?: OrderComplimentary | null
  // Admin reprints only (POST /admin/orders/{id}/reprint-receipt).
  reprint?: ReceiptReprint | null
  // O4: the till's collection number ("T1-7"), on an offline sale and on an online sale that took a slip's numbers
  // through sync (DUPLICATE). Printed as the large number instead of orderNumber.
  collectionNumber?: string | null
  // O4: when an offline sale was made (UTC, with Z); null for online sales (createdAt is the time).
  soldAt?: string | null
  // O4: a sale made offline (the server's recordedOffline, or a local one).
  recordedOffline?: boolean
  // O4 (H): an online sale stuck in "Checking the sale…", printed as an offline sale.
  wasPendingOnline?: boolean
}

// O4: the time to print: an offline sale's soldAt, else createdAt.
export function receiptTime(order: ReceiptOrder): string | null {
  return order.soldAt ?? order.createdAt ?? null
}

// O4: the large number: the collection number when there is one (what the customer holds), else orderNumber.
export function largeNumber(order: ReceiptOrder): { label: "Collection" | "Order"; value: string } | null {
  if (order.collectionNumber) return { label: "Collection", value: order.collectionNumber }
  return typeof order.orderNumber === "number" ? { label: "Order", value: String(order.orderNumber) } : null
}

// "COPY n" on an admin reprint, "COPY" on a local reprint from the completion screen, nothing on the original.
export type ReceiptCopy = { kind: "NUMBERED"; copyNumber: number } | { kind: "LOCAL" } | null

export function receiptCopy(order: ReceiptOrder, localReprint = false): ReceiptCopy {
  if (order.reprint) return { kind: "NUMBERED", copyNumber: order.reprint.copyNumber }
  return localReprint ? { kind: "LOCAL" } : null
}

export function isReceiptOrder(body: unknown): body is ReceiptOrder {
  return !!body && typeof body === "object" && Array.isArray((body as ReceiptOrder).lines)
}

// The wording of the VAT line, in one place: the accountant may change it.
export const VAT_LINE_TEMPLATE = "Incl. VAT {rate}%: R {amount}"

// 0.15 → "15", 0.155 → "15.5": no trailing zeros.
export function formatVatRate(rate: number): string {
  return String(Number((rate * 100).toFixed(4)))
}

// Receipt amounts: "1 180.50", "-10.00". Plain digits for the 72 mm columns, a dot as on the handoff's slip.
export function formatReceiptAmount(value: number | null | undefined): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0
  const fixed = Math.abs(safe).toFixed(2)
  const [whole, cents] = fixed.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${safe < 0 && Number(fixed) !== 0 ? "-" : ""}${grouped}.${cents}`
}

// The VAT line, only when the settings show it and the order has the server's VAT values.
export function vatLine(order: ReceiptOrder, showVatLine: boolean): string | null {
  if (!showVatLine) return null
  if (typeof order.vatIncludedAmount !== "number" || typeof order.vatRate !== "number") return null
  return VAT_LINE_TEMPLATE.replace("{rate}", formatVatRate(order.vatRate)).replace("{amount}", formatReceiptAmount(order.vatIncludedAmount))
}

export function receiptTotal(order: ReceiptOrder): number {
  if (order.orderKind === "COMPLIMENTARY") return 0
  return order.originalTotal ?? order.total ?? 0
}

// "T1 · Till 1 (front)"; null on the unregistered till (tillCode null).
export function receiptTillLabel(order: ReceiptOrder): string | null {
  if (!order.tillCode) return null
  return order.tillName ? `${order.tillCode} · ${order.tillName}` : order.tillCode
}

const ZONE_SUFFIX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

// createdAt is UTC without a zone suffix ("2026-11-18T10:31:07.123"); read it as UTC, not as browser time.
export function parseUtcTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(ZONE_SUFFIX.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const receiptDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Johannesburg",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

// "18/11/2026 12:31" in Johannesburg time; null when there is no usable time.
export function formatReceiptDateTime(value: string | null | undefined): string | null {
  const date = parseUtcTimestamp(value)
  return date ? receiptDateTimeFormatter.format(date).replace(",", "") : null
}

export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Cash"
    case "CARD":
      return "Card"
    case "ACCOUNT":
      return "Account"
    default:
      return method.charAt(0) + method.slice(1).toLowerCase().replaceAll("_", " ")
  }
}

export function kitchenLines(order: ReceiptOrder): ReceiptLine[] {
  return (order.lines ?? []).filter((line) => line.station === "KITCHEN")
}

export function hasKitchenLines(order: ReceiptOrder): boolean {
  return kitchenLines(order).length > 0
}

export function accountIdsOf(order: ReceiptOrder): number[] {
  return (order.payments ?? []).flatMap((payment) => (typeof payment.accountId === "number" ? [payment.accountId] : []))
}

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

// Account names by id, from GET /accounts (inactive accounts included: a reprint may name one). Never throws; a
// failure gives {} and the receipt says just "Account".
export async function fetchAccountNames(authFetch: AuthFetch): Promise<Record<number, string>> {
  try {
    const res = await authFetch("/accounts")
    if (!res.ok) return {}
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) return {}
    const names: Record<number, string> = {}
    for (const account of body as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof account.id === "number" && typeof account.name === "string") names[account.id] = account.name
    }
    return names
  } catch {
    return {}
  }
}
