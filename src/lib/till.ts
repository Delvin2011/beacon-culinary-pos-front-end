// Tills, per-till shifts and POS sessions (O2). Contract: docs/2026-11-17-o2-tills-shifts-api-contract.md (POS_BE).
// Branch on error `code` only; the server's `error` text is never used to decide anything.

import { apiFetch } from "@/lib/api-fetch"

export const TillErrorCode = {
  SESSION_ENDED: "SESSION_ENDED",
  TILL_LOCKED: "TILL_LOCKED",
  SHIFT_OPEN_ON_OTHER_TILL: "SHIFT_OPEN_ON_OTHER_TILL",
  SHIFT_ALREADY_OPEN: "SHIFT_ALREADY_OPEN",
  SHIFT_ALREADY_CLOSED: "SHIFT_ALREADY_CLOSED",
  SHIFT_UNCOUNTED: "SHIFT_UNCOUNTED",
  SHIFT_NOT_UNCOUNTED: "SHIFT_NOT_UNCOUNTED",
  TILL_IN_USE: "TILL_IN_USE",
  TILL_LIMIT_REACHED: "TILL_LIMIT_REACHED",
  TILL_CODE_IN_USE: "TILL_CODE_IN_USE",
} as const

// The till of a browser that isn't registered (the NULL till), wherever no till code exists.
export const UNREGISTERED_TILL = "Unregistered till"

// "T1 · Till 1 (front)", or "Unregistered till".
export function tillLabel(tillCode: string | null | undefined, tillName?: string | null): string {
  if (!tillCode) return UNREGISTERED_TILL
  return tillName ? `${tillCode} · ${tillName}` : tillCode
}

// ---- Session ended (contract 4.2) ----

export type SessionEndReason = "LOGOUT" | "LOCK" | "REPLACED" | "IDLE" | "ADMIN" | "SHIFT_FORCE_CLOSED" | "EXPIRED"

const SESSION_ENDED_MESSAGES: Record<SessionEndReason, string> = {
  REPLACED: "You were signed out because a newer sign-in replaced this one.",
  LOCK: "This till was locked.",
  IDLE: "You were signed out after a period without activity.",
  SHIFT_FORCE_CLOSED: "A manager closed your shift.",
  ADMIN: "A manager ended this session.",
  LOGOUT: "You signed out.",
  EXPIRED: "Your session has expired. Please sign in again.",
}

export function sessionEndedMessage(reason: string | null | undefined): string {
  return (reason && SESSION_ENDED_MESSAGES[reason as SessionEndReason]) || SESSION_ENDED_MESSAGES.EXPIRED
}

// T1-8: a credential refused because it belongs to another customer (another address). Ends the session as
// SESSION_ENDED does, with no reason ("Your session has expired…").
export const TENANT_MISMATCH = "TENANT_MISMATCH"

// A 401 SESSION_ENDED (or TENANT_MISMATCH), read from a copy of the response: its reason, or null when it is any
// other response.
export async function readSessionEnded(res: Response): Promise<{ reason: string | null } | null> {
  if (res.status !== 401) return null
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown; details?: { reason?: unknown } } | null
  if (body?.code === TENANT_MISMATCH) return { reason: null }
  if (body?.code !== TillErrorCode.SESSION_ENDED) return null
  return { reason: typeof body.details?.reason === "string" ? body.details.reason : null }
}

// ---- Sign-in refusals (contract 5) ----

export function tillLockedMessage(ownerName: string | null, tillCode: string | null): string {
  const who = ownerName ?? "another cashier"
  return `In use by ${who}${tillCode ? ` (${tillCode})` : ""}. Only they or a manager can sign in.`
}

export function shiftOpenOnOtherTillMessage(tillCode: string | null, tillName: string | null): string {
  return `You have an open shift on ${tillCode ?? tillName ?? UNREGISTERED_TILL}. Close it there first, or ask a manager.`
}

export function shiftAlreadyOpenMessage(ownerName: string | null, tillCode: string | null): string {
  return `${tillCode ?? "This till"} already has an open shift${ownerName ? ` (${ownerName})` : ""}.`
}

// ---- GET /pos/till-status (contract 7.1) ----

export interface TillStatusShift {
  shiftId: number
  ownerId: number
  ownerName: string
  openedAt: string
  // true: the owner has no POS session here; false: signed in here now.
  locked: boolean
}

export interface TillStatus {
  registered: boolean
  tillCode: string | null
  tillName: string | null
  shift: TillStatusShift | null
  idleLockMinutes: number
  requireRegistered: boolean
  // O3 (contract 10.1). The master switch for offline; false from a pre-O3 server.
  offlineEnabled: boolean
  maxOfflineHours: number
  warnOfflineHours: number
}

export const DEFAULT_IDLE_LOCK_MINUTES = 5
export const DEFAULT_MAX_OFFLINE_HOURS = 6
export const DEFAULT_WARN_OFFLINE_HOURS = 5

const positiveOr = (value: unknown, fallback: number) => (typeof value === "number" && value > 0 ? value : fallback)

// Public: credentials send the deviceToken cookie. Throws on no answer or a non-2xx.
export async function fetchTillStatus(): Promise<TillStatus> {
  const res = await apiFetch("/pos/till-status", { credentials: "include", cache: "no-store" })
  if (!res.ok) throw new Error(`till-status ${res.status}`)
  const body = (await res.json()) as Partial<TillStatus>
  return {
    registered: body.registered === true,
    tillCode: typeof body.tillCode === "string" ? body.tillCode : null,
    tillName: typeof body.tillName === "string" ? body.tillName : null,
    shift: body.shift && typeof body.shift.shiftId === "number" ? body.shift : null,
    idleLockMinutes: positiveOr(body.idleLockMinutes, DEFAULT_IDLE_LOCK_MINUTES),
    requireRegistered: body.requireRegistered === true,
    offlineEnabled: body.offlineEnabled === true,
    maxOfflineHours: positiveOr(body.maxOfflineHours, DEFAULT_MAX_OFFLINE_HOURS),
    warnOfflineHours: positiveOr(body.warnOfflineHours, DEFAULT_WARN_OFFLINE_HOURS),
  }
}

// "07:58", in the till's local time.
export function formatLocalTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
