// O4 contract section 8: reviewing what offline sales raised. ADMIN only. Branch on status and `code` only.

import { readApiError } from "@/lib/api-error"
import type { ReceiptOrder } from "@/lib/receipt"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export const NOTE_MAX_LENGTH = 500
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export type ExceptionStatus = "OPEN" | "RESOLVED"
export type ExceptionSeverity = "REVIEW" | "INFO"

export interface SaleExceptionOrderRef {
  id: number
  receiptNumber: string | null
  collectionNumber: string | null
  soldAt: string | null
  total: number | null
  cashierName: string | null
}

export interface SaleExceptionItem {
  id: number
  code: string
  severity: string
  status: string
  tradingDay: string | null
  tillCode: string | null
  deviceId: string | null
  order: SaleExceptionOrderRef | null
  detail: Record<string, unknown>
  createdAt: string | null
}

// The full order of 8.2 (OrderDto, with O4's fields).
export type SaleExceptionOrder = ReceiptOrder & {
  id: number
  orderNumber?: number | null
  status?: string | null
  bookedTradingDay?: string | null
}

export interface SaleExceptionDetail extends Omit<SaleExceptionItem, "order"> {
  order: SaleExceptionOrder | null
  resolution: string | null
  resolutionNote: string | null
  resolvedBy: { id: number; name: string } | null
  resolvedAt: string | null
}

export interface SaleExceptionPage {
  items: SaleExceptionItem[]
  page: number
  size: number
  totalItems: number
}

export interface ExceptionFilters {
  status: ExceptionStatus
  severity: ExceptionSeverity
  code: string | null
  tradingDay: string | null
  deviceId: string | null
  page: number
  size: number
}

export const DEFAULT_FILTERS: ExceptionFilters = {
  status: "OPEN",
  severity: "REVIEW",
  code: null,
  tradingDay: null,
  deviceId: null,
  page: 0,
  size: DEFAULT_PAGE_SIZE,
}

// What each code means, for managers (contract section 6).
export const EXCEPTION_CODES: Record<string, { label: string; description: string }> = {
  ACCOUNT_APPROVAL_PENDING: { label: "Account charge to approve", description: "An account was charged offline without a manager's approval." },
  ACCOUNT_OVER_CAP: { label: "Account over the offline limit", description: "This account's offline charges under the grant passed the limit." },
  ACCOUNT_INACTIVE: { label: "Inactive or unknown account", description: "The account charged is inactive, or unknown." },
  PAYMENT_MISMATCH: { label: "Payments don't match", description: "Payments don't add up to the total, or cash or change doesn't match." },
  TOTALS_MISMATCH: { label: "Totals don't match", description: "The lines don't add up to the total." },
  PRICE_MISMATCH: { label: "Price differs", description: "The till charged a different price from the server's. The till's price stands." },
  UNKNOWN_ITEM: { label: "Unknown item", description: "An item or extra isn't on the server's menu; recorded by name and price." },
  OVERSOLD: { label: "Oversold", description: "More was sold than the portions or buffer left; recorded at 0." },
  VAT_MISMATCH: { label: "VAT differs", description: "The printed VAT or rate differs from the server's." },
  CARD_REFERENCE_MISSING: { label: "Card slip reference missing", description: "A card payment has no slip reference." },
  LATE_AFTER_Z: { label: "Sold before a Z", description: "The sale's day already had a Z; it was booked to the next open day." },
  LATE_AFTER_SHIFT_CLOSE: { label: "Arrived after the shift closed", description: "Its cash shows as late offline cash." },
  OUTSIDE_GRANT: { label: "Outside the offline permission", description: "Sold before the grant was issued, after it expired, or after it was revoked." },
  DEVICE_REVOKED: { label: "From a revoked till", description: "Sent by a revoked or expired browser or till." },
  GRANT_MISMATCH: { label: "Shift or cashier differs", description: "The sale named a different shift or cashier from its grant; the grant's were used." },
  DUPLICATE_DIFFERS: { label: "Resend differs", description: "A sale sent again differs from the one recorded." },
  OFFLINE_NUMBER_CLASH: { label: "Number used twice", description: "Another sale already has this till, day and offline number." },
  CLOCK_SKEW: { label: "Till clock off", description: "The till's clock was more than 5 minutes out." },
  FUTURE_SALE: { label: "Sold in the future", description: "The sale time is after the server received it." },
  PERIOD_CLOSED: { label: "Period closed", description: "A line's meal period wasn't open when it was sold." },
  ITEM_UNAVAILABLE: { label: "Item not available", description: "An item wasn't ready, was out, or belongs to another day." },
  UNLOCKED_OFFLINE: { label: "Unlocked offline", description: "The till was unlocked offline before the sale." },
  STOCK_AFTER_COUNT: { label: "Stock counted after", description: "An ingredient was counted in a stock take after this sale." },
}

export const ACCOUNT_APPROVAL_CODE = "ACCOUNT_APPROVAL_PENDING"

export function exceptionLabel(code: string): string {
  return EXCEPTION_CODES[code]?.label ?? code
}

// ---- Reading ----

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === "string" ? value : null)
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

function parseOrderRef(raw: unknown): SaleExceptionOrderRef | null {
  if (!isObject(raw) || num(raw.id) === null) return null
  return {
    id: num(raw.id)!,
    receiptNumber: str(raw.receiptNumber),
    collectionNumber: str(raw.collectionNumber),
    soldAt: str(raw.soldAt),
    total: num(raw.total),
    cashierName: str(raw.cashierName),
  }
}

function parseItem(raw: unknown): SaleExceptionItem | null {
  if (!isObject(raw) || num(raw.id) === null || typeof raw.code !== "string") return null
  return {
    id: num(raw.id)!,
    code: raw.code,
    severity: str(raw.severity) ?? "",
    status: str(raw.status) ?? "",
    tradingDay: str(raw.tradingDay),
    tillCode: str(raw.tillCode),
    deviceId: str(raw.deviceId),
    order: parseOrderRef(raw.order),
    detail: isObject(raw.detail) ? raw.detail : {},
    createdAt: str(raw.createdAt),
  }
}

export function parseDetail(raw: unknown): SaleExceptionDetail | null {
  const item = parseItem(raw)
  if (!item || !isObject(raw)) return null
  const resolvedBy = isObject(raw.resolvedBy) && num(raw.resolvedBy.id) !== null ? { id: num(raw.resolvedBy.id)!, name: str(raw.resolvedBy.name) ?? "" } : null
  return {
    ...item,
    order: isObject(raw.order) && num(raw.order.id) !== null ? (raw.order as unknown as SaleExceptionOrder) : null,
    resolution: str(raw.resolution),
    resolutionNote: str(raw.resolutionNote),
    resolvedBy,
    resolvedAt: str(raw.resolvedAt),
  }
}

export function exceptionsQuery(filters: Partial<ExceptionFilters>): string {
  const params = new URLSearchParams()
  if (filters.status) params.set("status", filters.status)
  if (filters.severity) params.set("severity", filters.severity)
  if (filters.code) params.set("code", filters.code)
  if (filters.tradingDay) params.set("tradingDay", filters.tradingDay)
  if (filters.deviceId) params.set("deviceId", filters.deviceId)
  if (filters.page !== undefined) params.set("page", String(filters.page))
  if (filters.size !== undefined) params.set("size", String(Math.min(Math.max(filters.size, 1), MAX_PAGE_SIZE)))
  const query = params.toString()
  return `/admin/sale-exceptions${query ? `?${query}` : ""}`
}

// ---- Errors (by status and code only) ----

export class SaleExceptionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    // 400 {"note": "..."}: the note field's message.
    readonly noteError: string | null = null,
  ) {
    super(message)
  }
}

export const ERROR_MESSAGES = {
  USE_APPROVE_ACCOUNT: "This is an account charge to approve: use Approve account charge instead.",
  NOT_AN_ACCOUNT_APPROVAL: "Only an account charge awaiting approval can be approved.",
  EXCEPTION_ALREADY_RESOLVED: "This exception has already been resolved.",
  NOT_FOUND: "This exception doesn't exist any more.",
  FORBIDDEN: "Only an admin can review sale exceptions.",
  SIGNED_OUT: "Your sign-in has ended. Sign in again.",
}

async function toError(res: Response, fallback: string): Promise<SaleExceptionError> {
  const api = await readApiError(res)
  if (res.status === 409 && api.code === "USE_APPROVE_ACCOUNT") return new SaleExceptionError(ERROR_MESSAGES.USE_APPROVE_ACCOUNT, 409, api.code)
  if (res.status === 409 && api.code === "NOT_AN_ACCOUNT_APPROVAL") return new SaleExceptionError(ERROR_MESSAGES.NOT_AN_ACCOUNT_APPROVAL, 409, api.code)
  if (res.status === 409 && api.code === "EXCEPTION_ALREADY_RESOLVED")
    return new SaleExceptionError(ERROR_MESSAGES.EXCEPTION_ALREADY_RESOLVED, 409, api.code)
  if (res.status === 400 && api.fieldErrors.note) return new SaleExceptionError(api.fieldErrors.note, 400, null, api.fieldErrors.note)
  if (res.status === 404) return new SaleExceptionError(ERROR_MESSAGES.NOT_FOUND, 404, api.code)
  if (res.status === 403) return new SaleExceptionError(ERROR_MESSAGES.FORBIDDEN, 403, api.code)
  if (res.status === 401) return new SaleExceptionError(ERROR_MESSAGES.SIGNED_OUT, 401, api.code)
  return new SaleExceptionError(api.error ?? fallback, res.status, api.code)
}

// ---- Calls ----

export async function fetchSaleExceptions(authFetch: AuthFetch, filters: ExceptionFilters): Promise<SaleExceptionPage> {
  const res = await authFetch(exceptionsQuery(filters))
  if (!res.ok) throw await toError(res, "Unable to load the sale exceptions.")
  const body = (await res.json().catch(() => null)) as unknown
  if (!isObject(body) || !Array.isArray(body.items)) throw new SaleExceptionError("Unable to load the sale exceptions.", res.status, null)
  return {
    items: body.items.map(parseItem).filter((item): item is SaleExceptionItem => item !== null),
    page: num(body.page) ?? filters.page,
    size: num(body.size) ?? filters.size,
    totalItems: num(body.totalItems) ?? 0,
  }
}

export async function fetchSaleException(authFetch: AuthFetch, id: number): Promise<SaleExceptionDetail> {
  const res = await authFetch(`/admin/sale-exceptions/${id}`)
  if (!res.ok) throw await toError(res, "Unable to load this exception.")
  const detail = parseDetail(await res.json().catch(() => null))
  if (!detail) throw new SaleExceptionError("Unable to load this exception.", res.status, null)
  return detail
}

async function post(authFetch: AuthFetch, path: string, body: unknown, fallback: string): Promise<SaleExceptionDetail> {
  const res = await authFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) throw await toError(res, fallback)
  const detail = parseDetail(await res.json().catch(() => null))
  if (!detail) throw new SaleExceptionError(fallback, res.status, null)
  return detail
}

// 8.3: the note is required, at most 500 characters (checked here too, so the cashier's typing is answered at once).
export function noteProblem(note: string, required: boolean): string | null {
  const trimmed = note.trim()
  if (required && !trimmed) return "Enter a note."
  if (trimmed.length > NOTE_MAX_LENGTH) return `A note can be at most ${NOTE_MAX_LENGTH} characters.`
  return null
}

export function resolveSaleException(authFetch: AuthFetch, id: number, note: string): Promise<SaleExceptionDetail> {
  return post(authFetch, `/admin/sale-exceptions/${id}/resolve`, { note: note.trim() }, "Unable to resolve this exception.")
}

// 8.4: the only way to close ACCOUNT_APPROVAL_PENDING; records the manager as the approver. The note is optional.
export function approveAccountCharge(authFetch: AuthFetch, id: number, note: string): Promise<SaleExceptionDetail> {
  const trimmed = note.trim()
  return post(authFetch, `/admin/sale-exceptions/${id}/approve-account`, trimmed ? { note: trimmed } : {}, "Unable to approve this account charge.")
}

// The badge: open REVIEW exceptions (the list's defaults), read from totalItems. Null when it can't be read.
export async function fetchOpenExceptionCount(authFetch: AuthFetch): Promise<number | null> {
  try {
    const res = await authFetch(exceptionsQuery({ status: "OPEN", severity: "REVIEW", size: 1 }))
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as unknown
    return isObject(body) ? num(body.totalItems) : null
  } catch {
    return null
  }
}
