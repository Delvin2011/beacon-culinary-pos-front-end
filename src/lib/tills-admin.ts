// Manager views of tills and shifts (O2 contract 7.4 and 10): the Tills list, force close, late count and
// "confirm no count". Force close, late count and confirm-no-count need a password sign-in within 30 minutes
// (403 REAUTH_REQUIRED otherwise). Branch on `code` only.

import { readApiError, type ApiError } from "@/lib/api-error"
import { DeviceErrorCode } from "@/lib/devices"
import { TillErrorCode } from "@/lib/till"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export type CashCount = "COUNTED" | "UNCOUNTED" | "COUNTED_LATE" | "NO_COUNT_CONFIRMED"

export const CASH_COUNT_LABELS: Record<CashCount, string> = {
  COUNTED: "Counted",
  UNCOUNTED: "Not counted",
  COUNTED_LATE: "Counted after close",
  NO_COUNT_CONFIRMED: "Not counted (confirmed)",
}

export interface AdminTillShift {
  shiftId: number
  ownerId: number
  ownerName: string
  openedAt: string
  // null for the unregistered till, which has no lock rule.
  locked: boolean | null
}

// O3 (offline contract 10.2): the till's latest status report.
export type TillOfflineState = "NEVER_REPORTED" | "OK" | "PENDING" | "UNKNOWN"

export interface AdminTillOffline {
  state: TillOfflineState
  pendingCount: number | null
  lastReportAt: string | null
  clockSkewMs: number | null
  offlineSince: string | null
  appVersion: string | null
  // O4: this till's open REVIEW sale exceptions (absent from a pre-O4 server).
  openExceptions?: number | null
}

export interface AdminTillRow {
  deviceId: string | null
  tillCode: string | null
  tillName: string
  registered: boolean
  shift: AdminTillShift | null
  // O3: null for the unregistered till, and absent from a pre-O3 server.
  offline?: AdminTillOffline | null
}

// A clock difference larger than this is shown as a warning (on the Tills view and the devices page).
export const CLOCK_SKEW_WARN_MS = 2 * 60_000

export type VarianceReasonCode = "CASH_COUNTING_ERROR" | "THEFT_SUSPECTED" | "UNRECORDED_TRANSACTION" | "OTHER"

// The same labels as the till's close-out.
export const VARIANCE_REASON_OPTIONS: Array<{ value: VarianceReasonCode; label: string }> = [
  { value: "CASH_COUNTING_ERROR", label: "Cash counting error" },
  { value: "THEFT_SUSPECTED", label: "Shortage" },
  { value: "UNRECORDED_TRANSACTION", label: "Unrecorded transaction" },
  { value: "OTHER", label: "Other" },
]

export const SHIFT_REASON_MAX = 255

const MESSAGES: Record<string, string> = {
  [TillErrorCode.SHIFT_ALREADY_CLOSED]: "This shift is already closed.",
  [TillErrorCode.SHIFT_NOT_UNCOUNTED]: "This shift already has a cash count.",
  [TillErrorCode.SHIFT_UNCOUNTED]: "This shift was closed without a cash count. Record the count or confirm there is no count.",
  ALREADY_SIGNED_OFF: "This shift is already signed off, so a count can't be recorded.",
  DAY_CLOSED: "This shift's trading day is closed (Z taken), so a count can't be recorded.",
}

// A failed call. `message` is safe to show; `fieldErrors` holds a 400 field map (e.g. varianceReasonCode).
export class ShiftAdminError extends Error {
  readonly status: number
  readonly code: string | null
  readonly fieldErrors: Record<string, string>

  constructor(apiError: ApiError, fallback: string) {
    super(
      (apiError.code && MESSAGES[apiError.code]) ||
        (apiError.status === 404 ? "This shift no longer exists." : null) ||
        (apiError.status === 403 && !apiError.code ? "You don't have permission to do this." : null) ||
        apiError.error ||
        fallback,
    )
    this.status = apiError.status
    this.code = apiError.code
    this.fieldErrors = apiError.fieldErrors
  }

  get needsReauth(): boolean {
    return this.code === DeviceErrorCode.REAUTH_REQUIRED
  }
}

async function call<T>(authFetch: AuthFetch, path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await authFetch(path, init)
  if (!res.ok) throw new ShiftAdminError(await readApiError(res), fallback)
  return (await res.json().catch(() => null)) as T
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

export function listAdminTills(authFetch: AuthFetch): Promise<AdminTillRow[]> {
  return call(authFetch, "/admin/tills", undefined, "Unable to load the tills.")
}

// Expected cash for a shift, computed live while it is open (GET /admin/shifts/{id}/activity).
export async function fetchExpectedCash(authFetch: AuthFetch, shiftId: number): Promise<number> {
  const activity = await call<{ expectedCashBreakdown?: { expectedCash?: number } }>(
    authFetch,
    `/admin/shifts/${shiftId}/activity`,
    undefined,
    "Unable to load the expected cash.",
  )
  const expected = activity?.expectedCashBreakdown?.expectedCash
  if (typeof expected !== "number") throw new Error("Unable to load the expected cash.")
  return expected
}

export interface ForceCloseInput {
  reason: string
  // Omitted when the drawer can't be counted now.
  countedCash?: number
  varianceReasonCode?: VarianceReasonCode
}

export function forceCloseShift(authFetch: AuthFetch, shiftId: number, input: ForceCloseInput): Promise<unknown> {
  const body: Record<string, unknown> = { reason: input.reason.trim() }
  if (input.countedCash !== undefined) {
    body.countedCash = input.countedCash
    if (input.varianceReasonCode) body.varianceReasonCode = input.varianceReasonCode
  }
  return call(authFetch, `/admin/shifts/${shiftId}/force-close`, post(body), "Unable to force close the shift.")
}

export interface LateCountInput {
  countedCash: number
  varianceReasonCode?: VarianceReasonCode
  note?: string
}

export function recordLateCount(authFetch: AuthFetch, shiftId: number, input: LateCountInput): Promise<unknown> {
  const body: Record<string, unknown> = { countedCash: input.countedCash }
  if (input.varianceReasonCode) body.varianceReasonCode = input.varianceReasonCode
  if (input.note?.trim()) body.note = input.note.trim()
  return call(authFetch, `/admin/shifts/${shiftId}/count`, post(body), "Unable to record the count.")
}

// Sign-off of an uncounted shift with no count to come (contract 10.3). The note is the reason.
export function confirmNoCount(authFetch: AuthFetch, shiftId: number, note: string): Promise<unknown> {
  return call(
    authFetch,
    `/admin/shifts/${shiftId}/signoff`,
    post({ note: note.trim(), confirmNoCount: true }),
    "Unable to sign off the shift.",
  )
}

// Counted minus expected, in cents, so float noise isn't a variance.
export function varianceCents(counted: number, expected: number): number {
  return Math.round(counted * 100) - Math.round(expected * 100)
}

// ---- Force-close draft, kept across the password re-sign-in (never a password or token) ----

const FORCE_CLOSE_DRAFT_KEY = "pos.forceCloseDraft"

export interface ForceCloseDraft {
  shiftId: number
  // So the reopened dialog can say whose shift it is.
  ownerName: string
  till: string
  countedCash: string
  cannotCount: boolean
  reason: string
  varianceReasonCode: VarianceReasonCode | null
}

export function saveForceCloseDraft(draft: ForceCloseDraft): void {
  try {
    sessionStorage.setItem(FORCE_CLOSE_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // The form just starts empty after the sign-in.
  }
}

export function loadForceCloseDraft(): ForceCloseDraft | null {
  try {
    const raw = sessionStorage.getItem(FORCE_CLOSE_DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as ForceCloseDraft
    return typeof draft?.shiftId === "number" ? draft : null
  } catch {
    return null
  }
}

export function clearForceCloseDraft(): void {
  try {
    sessionStorage.removeItem(FORCE_CLOSE_DRAFT_KEY)
  } catch {
    // Nothing to clear.
  }
}
