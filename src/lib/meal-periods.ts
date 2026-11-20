// T0-5b: meal periods admin (contract docs/2026-11-20-t0-5-meal-periods-locations-api-contract.md, part 2).
// Types and calls for /admin/meal-periods, the client copies of the contract's field rules, the warnings shown
// before a save, and the refusal codes in plain words. Period names always come from the API; nothing here names
// a period. Branch on `code` only; `error` is for display.

import { readApiError, detailNumber, detailString, type ApiError } from "@/lib/api-error"
import { TRADING_TIME_ZONE, serverNow } from "@/lib/offline/server-time"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

// ---- Types (contract section 2) ----

export type MealPeriodAccepts = "SET_MEALS" | "LIGHT_MEALS"

// GET /meal-periods: active periods only, in sortOrder.
export interface MealPeriod {
  id: number
  name: string
  // "HH:mm:ss"; null only for the All Day period.
  startTime: string | null
  endTime: string | null
  allDay: boolean
  accepts: MealPeriodAccepts
  plannable: boolean
}

export type MealPeriodAction = "CREATE" | "UPDATE" | "DEACTIVATE" | "ACTIVATE"

// GET /admin/meal-periods: every period, inactive ones too.
export interface AdminMealPeriod extends MealPeriod {
  active: boolean
  sortOrder: number
  lastChange: { action: MealPeriodAction; byName: string; at: string } | null
}

export interface MealPeriodState {
  name: string
  startTime: string | null
  endTime: string | null
  sortOrder: number
  active: boolean
}

export interface MealPeriodHistoryEntry {
  id: number
  periodId: number
  action: MealPeriodAction
  before: MealPeriodState | null
  after: MealPeriodState
  changedAt: string
  changedById: number | null
  changedByName: string
}

export interface MealPeriodHistoryPage {
  content: MealPeriodHistoryEntry[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

// ---- Errors ----

export class MealPeriodError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: Record<string, unknown> | null
  readonly fieldErrors: Record<string, string>
  readonly serverMessage: string | null

  constructor(apiError: ApiError, fallback: string) {
    super(apiError.error ?? fallback)
    this.status = apiError.status
    this.code = apiError.code
    this.details = apiError.details
    this.fieldErrors = apiError.fieldErrors
    this.serverMessage = apiError.error
  }

  // 403 with an empty body: signed in, but not an ADMIN.
  get forbidden(): boolean {
    return this.status === 403 && this.code === null
  }
}

async function call<T>(authFetch: AuthFetch, path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await authFetch(path, init)
  if (!res.ok) throw new MealPeriodError(await readApiError(res), fallback)
  return (await res.json()) as T
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

// ---- Calls (contract section 3) ----

export function listAdminMealPeriods(authFetch: AuthFetch): Promise<AdminMealPeriod[]> {
  return call(authFetch, "/admin/meal-periods", undefined, "Unable to load the meal periods.")
}

export interface MealPeriodBody {
  name: string
  startTime?: string | null
  endTime?: string | null
  sortOrder?: number
}

export function createMealPeriod(authFetch: AuthFetch, body: MealPeriodBody): Promise<AdminMealPeriod> {
  return call(authFetch, "/admin/meal-periods", jsonBody("POST", body), "Unable to add the meal period.")
}

export function updateMealPeriod(authFetch: AuthFetch, id: number, body: MealPeriodBody): Promise<AdminMealPeriod> {
  return call(authFetch, `/admin/meal-periods/${id}`, jsonBody("PUT", body), "Unable to save the meal period.")
}

export function deactivateMealPeriod(authFetch: AuthFetch, id: number): Promise<AdminMealPeriod> {
  return call(authFetch, `/admin/meal-periods/${id}/deactivate`, { method: "POST" }, "Unable to deactivate the meal period.")
}

export function activateMealPeriod(authFetch: AuthFetch, id: number): Promise<AdminMealPeriod> {
  return call(authFetch, `/admin/meal-periods/${id}/activate`, { method: "POST" }, "Unable to activate the meal period.")
}

export const HISTORY_PAGE_SIZES = [50, 100, 200] as const

export interface MealPeriodHistoryQuery {
  periodId: number | null
  page: number
  size: number
}

export function historyPath({ periodId, page, size }: MealPeriodHistoryQuery): string {
  const params = new URLSearchParams()
  if (periodId !== null) params.set("periodId", String(periodId))
  params.set("page", String(page))
  params.set("size", String(size))
  return `/admin/meal-periods/history?${params.toString()}`
}

export function fetchMealPeriodHistory(authFetch: AuthFetch, query: MealPeriodHistoryQuery): Promise<MealPeriodHistoryPage> {
  return call(authFetch, historyPath(query), undefined, "Unable to load the change history.")
}

// ---- Times ----

// "07:00:00" -> "07:00"; null -> "".
export function toHHmm(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : ""
}

// "07:00:00"–"10:00:00" -> "07:00–10:00"; a period without times reads "Always open".
export function formatPeriodTimes(period: { startTime: string | null; endTime: string | null }): string {
  if (!period.startTime || !period.endTime) return "Always open"
  return `${toHHmm(period.startTime)}–${toHHmm(period.endTime)}`
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::(\d\d))?$/

// The site's time of day ("HH:mm:ss") at `ms`, by the site time zone.
export function siteTimeAt(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TRADING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  return `${part("hour")}:${part("minute")}:${part("second")}`
}

// The site's time of day now, by the server's clock.
export function siteTimeNow(): string {
  return siteTimeAt(serverNow())
}

// Open from start to end inclusive (contract section 1). "HH:mm:ss" strings compare in time order.
export function isOpenAt(period: { startTime: string | null; endTime: string | null }, timeHHmmss: string): boolean {
  if (!period.startTime || !period.endTime) return true
  return timeHHmmss >= normaliseTime(period.startTime) && timeHHmmss <= normaliseTime(period.endTime)
}

// "07:00" or "07:00:00" -> "07:00:00".
function normaliseTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

// ---- The form and its client checks (contract section 4) ----

export interface MealPeriodForm {
  name: string
  startTime: string // "HH:mm", "" for All Day
  endTime: string
  sortOrder: string // "" = not set
}

export const NAME_MAX = 50
export const SORT_ORDER_MIN = 0
export const SORT_ORDER_MAX = 9999

export function formFromPeriod(period: AdminMealPeriod | null): MealPeriodForm {
  if (!period) return { name: "", startTime: "", endTime: "", sortOrder: "" }
  return {
    name: period.name,
    startTime: toHHmm(period.startTime),
    endTime: toHHmm(period.endTime),
    sortOrder: String(period.sortOrder),
  }
}

export function overlapMessage(other: { name: string; startTime: string | null; endTime: string | null }): string {
  return `Overlaps ${other.name} (${formatPeriodTimes(other)}).`
}

// Two timed periods overlap unless one ends at or before the other starts (touching ends are allowed).
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd
}

export interface FormCheckContext {
  // The period being edited; null when adding.
  editing: AdminMealPeriod | null
  // Every period on screen (GET /admin/meal-periods).
  periods: AdminMealPeriod[]
}

// The contract's field rules, checked before sending. Messages match the server's (section 4.1). The overlap and
// name rules only apply among active periods, so an inactive period is checked when it is activated, not here.
export function checkForm(form: MealPeriodForm, { editing, periods }: FormCheckContext): Record<string, string> {
  const errors: Record<string, string> = {}
  const allDay = editing?.allDay === true
  const active = editing ? editing.active : true
  const name = form.name.trim()

  if (!name) errors.name = "Required."
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters.`
  else if (active) {
    const clash = periods.find((p) => p.active && p.id !== editing?.id && p.name.trim().toLowerCase() === name.toLowerCase())
    if (clash) errors.name = `Another active period is already called ${clash.name}.`
  }

  if (!allDay) {
    for (const field of ["startTime", "endTime"] as const) {
      const value = form[field].trim()
      if (!value) errors[field] = "Required."
      else if (!TIME_RE.test(value)) errors[field] = "Use HH:mm."
      else if ((TIME_RE.exec(value)?.[3] ?? "00") !== "00") errors[field] = "Seconds must be 00."
    }
    if (!errors.startTime && !errors.endTime) {
      const start = normaliseTime(form.startTime.trim())
      const end = normaliseTime(form.endTime.trim())
      if (end <= start) errors.endTime = "Overnight periods are not supported; the end must be after the start."
      else if (active) {
        const other = periods.find(
          (p) => p.active && !p.allDay && p.id !== editing?.id && p.startTime && p.endTime && overlaps(start, end, p.startTime, p.endTime),
        )
        if (other) {
          errors.startTime = overlapMessage(other)
          errors.endTime = overlapMessage(other)
        }
      }
    }
  }

  const sort = form.sortOrder.trim()
  if (sort) {
    const n = Number(sort)
    if (!/^\d+$/.test(sort) || !Number.isInteger(n) || n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) {
      errors.sortOrder = `Must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}.`
    }
  }
  return errors
}

// The request body. All Day never sends times. An empty sort order is left out: last on create, unchanged on edit.
export function bodyFromForm(form: MealPeriodForm, editing: AdminMealPeriod | null): MealPeriodBody {
  const body: MealPeriodBody = { name: form.name.trim() }
  if (!editing?.allDay) {
    body.startTime = form.startTime.trim()
    body.endTime = form.endTime.trim()
  }
  if (form.sortOrder.trim()) body.sortOrder = Number(form.sortOrder.trim())
  return body
}

// ---- Warnings before a save (contract sections 3.4, 6 and 7) ----

export interface SaveWarnings {
  // The period's times change; set for every time change, stronger while the period is being sold.
  times: string | null
  // True when the period is open right now and its items would stop selling earlier than before, or at once.
  sellingNow: boolean
  rename: string | null
}

export function saveWarnings(editing: AdminMealPeriod | null, form: MealPeriodForm, nowHHmmss: string): SaveWarnings {
  const result: SaveWarnings = { times: null, sellingNow: false, rename: null }
  if (!editing) return result

  const newName = form.name.trim()
  if (newName && newName !== editing.name) {
    result.rename = `Past reports and the dashboard will show the new name: sales made under ${editing.name} will be listed as ${newName}.`
  }

  if (editing.allDay || !editing.startTime || !editing.endTime) return result
  const newStart = form.startTime.trim()
  const newEnd = form.endTime.trim()
  if (newStart === toHHmm(editing.startTime) && newEnd === toHHmm(editing.endTime)) return result

  const openNow = editing.active && isOpenAt(editing, nowHHmmss)
  if (!openNow) {
    result.times = `Time changes take effect immediately: ${editing.name} will be sold from ${newStart} to ${newEnd}, starting now.`
    return result
  }

  result.sellingNow = true
  const stillOpen = isOpenAt({ startTime: newStart, endTime: newEnd }, nowHHmmss)
  const stops = stillOpen ? `at ${newEnd}` : "as soon as you save"
  result.times = `${editing.name} is being sold now. Changing its times takes effect immediately: items will stop selling ${stops}.`
  return result
}

// ---- Refusals in plain words (contract error codes) ----

// "2026-11-21" -> "21 Nov 2026" (a calendar date; no time zone shift).
export function formatCalendarDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? ""
  const [y, m, d] = value.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// 400 MEAL_PERIOD_INACTIVE on the planning screens: the period was deactivated since the page loaded.
export function inactivePeriodMessage(periodName: string): string {
  return `${periodName} has been deactivated, so nothing can be planned under it. Choose another period.`
}

// 400 MEAL_PERIOD_UNKNOWN: the name sent is no longer an active period, usually because it was renamed.
export function unknownPeriodMessage(periodName: string): string {
  return `${periodName} has been renamed or deactivated. The meal periods have been reloaded; try again.`
}

export const FORBIDDEN_MESSAGE = "You don't have permission to manage meal periods. Only an admin can."

// The message for a refusal, by code. `periodName` is the period acted on, from the list on screen.
export function refusalMessage(error: MealPeriodError, periodName: string): string {
  if (error.forbidden) return FORBIDDEN_MESSAGE
  switch (error.code) {
    case "PERIOD_OVERLAP": {
      const name = detailString(error.details, "name")
      if (!name) return error.message
      return `${overlapMessage({ name, startTime: detailString(error.details, "startTime"), endTime: detailString(error.details, "endTime") })} Active periods can touch but not overlap.`
    }
    case "PERIOD_IN_USE": {
      const options = detailNumber(error.details, "options") ?? 0
      const extras = detailNumber(error.details, "extras") ?? 0
      const from = formatCalendarDate(detailString(error.details, "fromDate"))
      return (
        `${periodName} can't be deactivated: it has ${count(options, "meal option", "meal options")} and ` +
        `${count(extras, "extra", "extras")} planned from ${from}. Move them to another period or remove them on ` +
        `Daily planning first.`
      )
    }
    case "ALL_DAY_PROTECTED":
      return `${periodName} is always open: it can't be given times or deactivated, because light meals depend on it.`
    case "MEAL_PERIOD_NOT_FOUND":
      return "This meal period no longer exists. The list has been reloaded."
    case "MEAL_PERIOD_INACTIVE":
      return inactivePeriodMessage(periodName)
    case "MEAL_PERIOD_UNKNOWN":
      return unknownPeriodMessage(periodName)
    default:
      return error.message
  }
}

// ---- History (contract section 3.6) ----

export const ACTION_LABELS: Record<MealPeriodAction, string> = {
  CREATE: "Added",
  UPDATE: "Changed",
  DEACTIVATE: "Deactivated",
  ACTIVATE: "Activated",
}

export type HistoryField = "name" | "times" | "sortOrder" | "active"

export const HISTORY_FIELD_LABELS: Record<HistoryField, string> = {
  name: "Name",
  times: "Times",
  sortOrder: "Sort order",
  active: "Status",
}

export interface HistoryChange {
  field: HistoryField
  before: string | null
  after: string
}

function stateText(state: MealPeriodState, field: HistoryField): string {
  switch (field) {
    case "name":
      return state.name
    case "times":
      return formatPeriodTimes(state)
    case "sortOrder":
      return String(state.sortOrder)
    case "active":
      return state.active ? "Active" : "Inactive"
  }
}

// What an entry changed. CREATE lists every field with no "before".
export function historyChanges(entry: MealPeriodHistoryEntry): HistoryChange[] {
  const fields: HistoryField[] = ["name", "times", "sortOrder", "active"]
  if (!entry.before) return fields.map((field) => ({ field, before: null, after: stateText(entry.after, field) }))
  const before = entry.before
  return fields
    .filter((field) => stateText(before, field) !== stateText(entry.after, field))
    .map((field) => ({ field, before: stateText(before, field), after: stateText(entry.after, field) }))
}
