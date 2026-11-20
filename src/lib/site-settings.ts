// T0-4 site settings (docs/2026-11-19-t0-4-site-settings-api-contract.md): the customer's own settings, changed by an
// ADMIN without a redeploy. GET/PUT /admin/settings, POST /admin/settings/{key}/reset and GET /admin/settings/history.
// Sensitive settings need a password sign-in within 30 minutes (403 REAUTH_REQUIRED). Branch on `code` only.
//
// The server sends no labels, units or effects notes: this file owns that copy. Values are held as the text the
// admin typed and converted only when sent, so decimals are never rounded by floating point. VAT is shown as a
// percentage (15.00 %) while the API stays in fractions (0.15); the conversion moves the decimal point on the string.

import { readApiError, type ApiError } from "@/lib/api-error"
import { DeviceErrorCode } from "@/lib/devices"
import { formatJhbDateTime } from "@/lib/pos-activity"
import { formatZarCurrency } from "@/lib/utils"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export type SettingType = "DECIMAL" | "INTEGER" | "BOOLEAN" | "DATE" | "TIME" | "TIME_RANGE"
export type SettingValue = number | boolean | string | null

export interface SettingLimits {
  // Left out for BOOLEAN, DATE, TIME and TIME_RANGE.
  min?: number
  max?: number
  scale?: number
  nullable?: boolean
}

export interface SettingLastChange {
  byName: string
  at: string
  action: "SET" | "RESET" | string
}

export interface SiteSetting {
  key: string
  value: SettingValue
  defaultValue: SettingValue
  // "No saved value". A value saved equal to the default is still not default; only a reset makes this true.
  isDefault: boolean
  type: SettingType | string
  limits: SettingLimits
  group: string
  description: string
  sensitive: boolean
  active: boolean
  // Present only when active is false.
  inactiveReason?: string
  lastChange: SettingLastChange | null
}

export interface SiteSettings {
  offlineEntitled: boolean
  settings: SiteSetting[]
}

export interface SettingHistoryEntry {
  id: number
  key: string
  action: "SET" | "RESET" | string
  oldValue: SettingValue
  oldIsDefault: boolean
  newValue: SettingValue
  newIsDefault: boolean
  changedAt: string
  changedById: number | null
  changedByName: string | null
}

export interface SettingHistoryPage {
  content: SettingHistoryEntry[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export const HISTORY_PAGE_SIZES = [50, 100, 200] as const
export const HISTORY_DEFAULT_SIZE = 50

// ---------------------------------------------------------------------------------------------------------------
// Copy: group headings, labels, units and the effects of a change (contract section 5).

export interface GroupCopy {
  heading: string
  description: string
}

// In the contract's order. A group the server adds later is shown after these, headed by its code.
export const GROUP_ORDER = ["VAT", "END_OF_DAY", "DASHBOARD", "BOARD", "TILLS", "SESSIONS", "OFFLINE"] as const

export const GROUP_COPY: Record<string, GroupCopy> = {
  VAT: { heading: "Sales and VAT", description: "The VAT rate charged on new sales and stock receipts." },
  END_OF_DAY: { heading: "End of day", description: "Where Z readings and the end-of-day process start." },
  DASHBOARD: { heading: "Dashboard", description: "The thresholds and trading hours the dashboard uses for its warnings." },
  BOARD: { heading: "Public board", description: "How long ready orders stay on the public order board." },
  TILLS: { heading: "Tills", description: "Which browsers may be used as tills." },
  SESSIONS: { heading: "Sessions", description: "When an idle till locks, and when its session ends." },
  OFFLINE: { heading: "Offline", description: "How long tills may sell without a connection, and account sales while offline." },
}

// How a value is shown and typed. "fraction-percent": the API holds a fraction (0.15), the screen a percentage (15.00 %).
export type SettingUnit = "fraction-percent" | "percent" | "rand" | "minutes" | "hours" | "none"

export interface SettingCopy {
  label: string
  unit: SettingUnit
  // What changes, and when (contract section 5).
  effect?: string
  // What an empty value means, for a nullable setting.
  emptyMeaning?: string
  // Shown instead of the server's 400 message for this key (it would be in the API's terms, not the screen's).
  clientMessage?: string
}

const OFFLINE_GRANT_EFFECT = "Applies from each till's next offline grant. A till that is already offline keeps the values it was given."
const DASHBOARD_EFFECT = "Applies at the dashboard's next refresh."

export const SETTING_COPY: Record<string, SettingCopy> = {
  "vat.standard-rate": {
    label: "VAT rate",
    unit: "fraction-percent",
    effect:
      "Applies to new sales and new stock receipt lines only; existing ones keep their rate. Offline tills pick it up at their next refresh.",
    clientMessage: "Enter a percentage between 0 and 99.99, with at most 2 decimals.",
  },
  "reports.close-day.first-trading-day": {
    label: "First trading day",
    unit: "none",
    effect: "Applies from the next Close Day, sign-off or report. Z readings already taken don't change.",
    emptyMeaning: "Empty: every day is in the end-of-day process.",
  },
  "dashboard.variance.threshold": { label: "Cash variance warning", unit: "rand", effect: DASHBOARD_EFFECT },
  "dashboard.voidRefund.watchPercent": { label: "Voids and refunds warning", unit: "percent", effect: DASHBOARD_EFFECT },
  "dashboard.slowMeal.thresholdPercent": { label: "Slow-selling meal threshold", unit: "percent", effect: DASHBOARD_EFFECT },
  "dashboard.slowMeal.afterTime": { label: "Check slow meals after", unit: "none", effect: DASHBOARD_EFFECT },
  "dashboard.openingHours": { label: "Trading hours", unit: "none", effect: DASHBOARD_EFFECT },
  "board.done-display-minutes": {
    label: "Keep ready orders on the board for",
    unit: "minutes",
    effect: "Applies at the board's next refresh. Orders already on a board keep the time they were given.",
  },
  "pos.tills.require-registered": {
    label: "Only registered tills may sell",
    unit: "none",
    effect:
      "Applies at the next cashier sign-in, shift open or sale. A cashier already signed in on an unregistered browser is stopped at their next sale.",
  },
  "pos.session.idle-lock-minutes": {
    label: "Lock an idle till after",
    unit: "minutes",
    effect: "Tills pick it up the next time they check their status.",
  },
  "pos.session.idle-expiry-minutes": {
    label: "End an idle session after",
    unit: "minutes",
    effect: "Applies at once. Lowering it can end sessions that have already been idle for longer.",
  },
  "pos.offline.max-offline-hours": { label: "Longest time a till may sell offline", unit: "hours", effect: OFFLINE_GRANT_EFFECT },
  "pos.offline.warn-offline-hours": { label: "Warn the cashier after", unit: "hours", effect: OFFLINE_GRANT_EFFECT },
  "pos.offline.accounts-enabled": { label: "Account sales while offline", unit: "none", effect: OFFLINE_GRANT_EFFECT },
  "pos.offline.account-cap": { label: "Offline account limit", unit: "rand", effect: OFFLINE_GRANT_EFFECT },
}

export function settingCopy(key: string): SettingCopy {
  return SETTING_COPY[key] ?? { label: key, unit: "none" }
}

export function groupCopy(group: string): GroupCopy {
  return GROUP_COPY[group] ?? { heading: group, description: "" }
}

export const INACTIVE_REASON_TEXT: Record<string, string> = {
  OFFLINE_NOT_ENTITLED: "Offline selling isn't switched on for this site. You can still change these; they apply when it is.",
}

export function inactiveReasonText(reason: string | undefined): string {
  return (reason && INACTIVE_REASON_TEXT[reason]) || "Not in use on this site at the moment. You can still change it."
}

// Settings in group order (the server's order within a group), unknown groups last.
export function groupSettings(settings: SiteSetting[]): Array<{ group: string; settings: SiteSetting[] }> {
  const groups: Array<{ group: string; settings: SiteSetting[] }> = []
  for (const setting of settings) {
    let entry = groups.find((g) => g.group === setting.group)
    if (!entry) {
      entry = { group: setting.group, settings: [] }
      groups.push(entry)
    }
    entry.settings.push(setting)
  }
  const rank = (group: string) => {
    const index = (GROUP_ORDER as readonly string[]).indexOf(group)
    return index === -1 ? GROUP_ORDER.length : index
  }
  // Array.prototype.sort is stable: unknown groups keep the server's order.
  return groups.sort((a, b) => rank(a.group) - rank(b.group))
}

// ---------------------------------------------------------------------------------------------------------------
// Decimal text helpers. Never via floating point arithmetic.

// A plain decimal string for a number ("0.155", "150"), never exponent notation.
function plainDecimal(value: number): string {
  const text = String(value)
  if (!/e/i.test(text)) return text
  return value.toFixed(20).replace(/\.?0+$/, "")
}

// Moves the decimal point `places` to the right (negative: to the left). "0.155", 2 -> "15.5"; "15.5", -2 -> "0.155".
export function shiftDecimal(text: string, places: number): string {
  const negative = text.startsWith("-")
  const unsigned = negative ? text.slice(1) : text
  const [whole, fraction = ""] = unsigned.split(".")
  let digits = whole + fraction
  let point = whole.length + places
  if (point < 0) {
    digits = "0".repeat(-point) + digits
    point = 0
  }
  if (point > digits.length) digits = digits + "0".repeat(point - digits.length)
  let intPart = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0"
  const fracPart = digits.slice(point).replace(/0+$/, "")
  if (intPart === "") intPart = "0"
  const result = fracPart ? `${intPart}.${fracPart}` : intPart
  return negative && /[1-9]/.test(result) ? `-${result}` : result
}

// "15.5" with 2 decimals -> "15.50".
function padDecimals(text: string, decimals: number): string {
  if (decimals <= 0) return text
  const [whole, fraction = ""] = text.split(".")
  return `${whole}.${fraction.padEnd(decimals, "0")}`
}

function decimalPlaces(text: string): number {
  const index = text.indexOf(".")
  return index === -1 ? 0 : text.length - index - 1
}

// The number of decimals the screen shows and accepts for a DECIMAL setting.
export function displayScale(setting: Pick<SiteSetting, "key" | "limits">): number {
  const scale = setting.limits?.scale ?? 2
  return settingCopy(setting.key).unit === "fraction-percent" ? Math.max(0, scale - 2) : scale
}

// The API value as the screen shows it, as text ("0.15" -> "15" for a percentage).
function toDisplayDecimal(key: string, value: number): string {
  const text = plainDecimal(value)
  return settingCopy(key).unit === "fraction-percent" ? shiftDecimal(text, 2) : text
}

// ---------------------------------------------------------------------------------------------------------------
// Values <-> input text.

// The text an input starts with for a value.
export function toInputText(setting: Pick<SiteSetting, "key" | "type" | "limits">, value: SettingValue): string {
  if (value === null || value === undefined) return ""
  switch (setting.type) {
    case "DECIMAL":
      return typeof value === "number" ? padDecimals(toDisplayDecimal(setting.key, value), displayScale(setting)) : String(value)
    case "INTEGER":
      return String(value)
    case "BOOLEAN":
      return value === true ? "true" : "false"
    default:
      return String(value)
  }
}

export type ParseResult = { ok: true; value: SettingValue } | { ok: false; error: string }

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [y, m, d] = text.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

// The limits as the screen shows them (0.9999 -> "99.99" for a percentage).
function rangeText(setting: Pick<SiteSetting, "key" | "limits">): { min: string | null; max: string | null } {
  const shown = (bound: number | undefined) => (typeof bound === "number" ? toDisplayDecimal(setting.key, bound) : null)
  return { min: shown(setting.limits?.min), max: shown(setting.limits?.max) }
}

function limitMessage(setting: Pick<SiteSetting, "key" | "type" | "limits">, decimals: number): string {
  const copy = settingCopy(setting.key)
  if (copy.clientMessage) return copy.clientMessage
  const { min, max } = rangeText(setting)
  const what = setting.type === "INTEGER" ? "a whole number" : copy.unit === "percent" ? "a percentage" : copy.unit === "rand" ? "an amount" : "a number"
  const between = min !== null && max !== null ? ` between ${min} and ${max}` : min !== null ? ` of at least ${min}` : max !== null ? ` of at most ${max}` : ""
  const places = setting.type === "DECIMAL" ? (decimals === 0 ? ", with no decimals" : `, with at most ${decimals} decimal${decimals === 1 ? "" : "s"}`) : ""
  return `Enter ${what}${between}${places}.`
}

// Checks the text against the setting's type and limits and gives the API value. Cross-field rules are left to the
// server, apart from the opening hours' start before end, which is a single key.
export function parseInputText(setting: Pick<SiteSetting, "key" | "type" | "limits">, raw: string): ParseResult {
  const text = raw.trim()
  const nullable = setting.limits?.nullable === true

  if (text === "" && setting.type !== "BOOLEAN") {
    return nullable ? { ok: true, value: null } : { ok: false, error: setting.type === "DATE" ? "Choose a date." : "Enter a value." }
  }

  switch (setting.type) {
    case "DECIMAL": {
      const decimals = displayScale(setting)
      const normalised = text.replace(",", ".")
      if (!/^-?\d+(\.\d+)?$/.test(normalised) || decimalPlaces(normalised) > decimals) return { ok: false, error: limitMessage(setting, decimals) }
      const shown = Number(normalised)
      const { min, max } = rangeText(setting)
      if ((min !== null && shown < Number(min)) || (max !== null && shown > Number(max))) return { ok: false, error: limitMessage(setting, decimals) }
      const apiText = settingCopy(setting.key).unit === "fraction-percent" ? shiftDecimal(normalised, -2) : normalised
      return { ok: true, value: Number(apiText) }
    }
    case "INTEGER": {
      if (!/^-?\d+$/.test(text)) return { ok: false, error: limitMessage(setting, 0) }
      const value = Number(text)
      const { min, max } = setting.limits ?? {}
      if ((typeof min === "number" && value < min) || (typeof max === "number" && value > max)) return { ok: false, error: limitMessage(setting, 0) }
      return { ok: true, value }
    }
    case "BOOLEAN":
      return text === "true" ? { ok: true, value: true } : text === "false" ? { ok: true, value: false } : { ok: false, error: "Choose on or off." }
    case "DATE":
      return isCalendarDate(text) ? { ok: true, value: text } : { ok: false, error: "Enter a date as YYYY-MM-DD." }
    case "TIME":
      return TIME_PATTERN.test(text) ? { ok: true, value: text } : { ok: false, error: "Enter a time as HH:mm, e.g. 12:30." }
    case "TIME_RANGE": {
      const [start, end, extra] = text.split("-")
      if (extra !== undefined || !TIME_PATTERN.test(start ?? "") || !TIME_PATTERN.test(end ?? "")) {
        return { ok: false, error: "Enter a start and an end time." }
      }
      if (start >= end) return { ok: false, error: "The start must be before the end." }
      return { ok: true, value: `${start}-${end}` }
    }
    default:
      return { ok: true, value: text }
  }
}

export function sameValue(a: SettingValue, b: SettingValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b
  return a === b
}

// ---------------------------------------------------------------------------------------------------------------
// Showing values (current, default, history).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "2026-10-12" -> "12 Oct 2026". A calendar date: no time zone.
export function formatCalendarDate(text: string): string {
  if (!isCalendarDate(text)) return text
  const [y, m, d] = text.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function formatSettingValue(setting: Pick<SiteSetting, "key" | "type" | "limits"> | undefined, value: SettingValue): string {
  if (!setting) return value === null || value === undefined ? "Empty" : String(value)
  if (value === null || value === undefined) return "Empty"
  const unit = settingCopy(setting.key).unit
  switch (setting.type) {
    case "DECIMAL": {
      if (typeof value !== "number") return String(value)
      if (unit === "rand") return formatZarCurrency(value)
      const text = toInputText(setting, value)
      return unit === "percent" || unit === "fraction-percent" ? `${text} %` : text
    }
    case "INTEGER": {
      if (unit === "minutes") return `${value} minute${value === 1 ? "" : "s"}`
      if (unit === "hours") return `${value} hour${value === 1 ? "" : "s"}`
      return String(value)
    }
    case "BOOLEAN":
      return value === true ? "On" : "Off"
    case "DATE":
      return typeof value === "string" ? formatCalendarDate(value) : String(value)
    case "TIME_RANGE":
      return typeof value === "string" ? value.replace("-", "–") : String(value)
    default:
      return String(value)
  }
}

// A UTC instant in the site's zone (SAST).
export function formatInstant(value: string | null | undefined): string {
  return formatJhbDateTime(value)
}

// ---------------------------------------------------------------------------------------------------------------
// Edits: the text typed per key, only for keys the admin changed.

export type SettingEdits = Record<string, string>

export interface EditCheck {
  // The PUT body: keys whose value would change.
  changes: Record<string, SettingValue>
  // Keys whose text isn't valid yet, with the message to show.
  invalid: Record<string, string>
}

export function checkEdits(settings: SiteSetting[], edits: SettingEdits): EditCheck {
  const changes: Record<string, SettingValue> = {}
  const invalid: Record<string, string> = {}
  for (const [key, text] of Object.entries(edits)) {
    const setting = settings.find((s) => s.key === key)
    if (!setting) continue
    const parsed = parseInputText(setting, text)
    if (!parsed.ok) invalid[key] = parsed.error
    else if (!sameValue(parsed.value, setting.value)) changes[key] = parsed.value
  }
  return { changes, invalid }
}

// Keeps only the edits that still differ from the server's value (after a reload or a save).
export function pruneEdits(settings: SiteSetting[], edits: SettingEdits): SettingEdits {
  const kept: SettingEdits = {}
  for (const [key, text] of Object.entries(edits)) {
    const setting = settings.find((s) => s.key === key)
    if (!setting) continue
    const parsed = parseInputText(setting, text)
    if (!parsed.ok || !sameValue(parsed.value, setting.value)) kept[key] = text
  }
  return kept
}

// ---------------------------------------------------------------------------------------------------------------
// The draft kept through the password re-sign-in (sessionStorage). Setting keys, typed text and what was loaded:
// never a password or token.

const SITE_SETTINGS_DRAFT_KEY = "pos.siteSettingsDraft"

export interface DraftBaseline {
  value: SettingValue
  lastChangeAt: string | null
}

export interface SiteSettingsDraft {
  edits: SettingEdits
  // The reset asked for when the re-sign-in was needed; confirmed again on return.
  pendingReset: string | null
  // The value and last change of each edited (or reset) key as first loaded, to spot a save made meanwhile.
  baseline: Record<string, DraftBaseline>
  // details.keys of the REAUTH_REQUIRED.
  reauthKeys: string[]
}

export function buildBaseline(settings: SiteSetting[], keys: string[], previous: Record<string, DraftBaseline> = {}): Record<string, DraftBaseline> {
  const baseline: Record<string, DraftBaseline> = {}
  for (const key of keys) {
    if (previous[key]) {
      baseline[key] = previous[key]
      continue
    }
    const setting = settings.find((s) => s.key === key)
    if (setting) baseline[key] = { value: setting.value, lastChangeAt: setting.lastChange?.at ?? null }
  }
  return baseline
}

export function saveSiteSettingsDraft(draft: SiteSettingsDraft): void {
  try {
    sessionStorage.setItem(SITE_SETTINGS_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // The edits are lost after the sign-in; the admin types them again.
  }
}

export function loadSiteSettingsDraft(): SiteSettingsDraft | null {
  try {
    const raw = sessionStorage.getItem(SITE_SETTINGS_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SiteSettingsDraft> | null
    if (!parsed || typeof parsed !== "object" || !parsed.edits || typeof parsed.edits !== "object") return null
    const edits: SettingEdits = {}
    for (const [key, text] of Object.entries(parsed.edits)) if (typeof text === "string") edits[key] = text
    return {
      edits,
      pendingReset: typeof parsed.pendingReset === "string" ? parsed.pendingReset : null,
      baseline: parsed.baseline && typeof parsed.baseline === "object" ? parsed.baseline : {},
      reauthKeys: Array.isArray(parsed.reauthKeys) ? parsed.reauthKeys.filter((k): k is string => typeof k === "string") : [],
    }
  } catch {
    return null
  }
}

export function clearSiteSettingsDraft(): void {
  try {
    sessionStorage.removeItem(SITE_SETTINGS_DRAFT_KEY)
  } catch {
    // Nothing to clear.
  }
}

// Keys in the draft whose value or last change differs from what was loaded before the sign-in: someone saved
// meanwhile, and saving now would replace their change.
export function staleKeys(draft: SiteSettingsDraft, settings: SiteSetting[]): string[] {
  const keys = new Set([...Object.keys(draft.edits), ...(draft.pendingReset ? [draft.pendingReset] : [])])
  return Array.from(keys).filter((key) => {
    const before = draft.baseline[key]
    const setting = settings.find((s) => s.key === key)
    if (!before || !setting) return false
    return !sameValue(before.value, setting.value) || before.lastChangeAt !== (setting.lastChange?.at ?? null)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// API.

export const SiteSettingsErrorCode = {
  REAUTH_REQUIRED: DeviceErrorCode.REAUTH_REQUIRED,
  UNKNOWN_SETTING: "UNKNOWN_SETTING",
} as const

const MESSAGES: Record<string, string> = {
  [SiteSettingsErrorCode.UNKNOWN_SETTING]: "This setting no longer exists. The list has been reloaded.",
}

// A failed call. `message` is safe to show. `fieldErrors` is the 400 field map, keyed by setting key (or "body").
export class SiteSettingsError extends Error {
  readonly status: number
  readonly code: string | null
  readonly fieldErrors: Record<string, string>
  // REAUTH_REQUIRED: the sensitive settings that would change.
  readonly reauthKeys: string[]

  constructor(apiError: ApiError, fallback: string) {
    super(
      (apiError.code && MESSAGES[apiError.code]) ||
        (apiError.status === 403 && !apiError.code ? "You don't have permission to change site settings." : null) ||
        (apiError.status === 400 && Object.keys(apiError.fieldErrors).length > 0 ? "Nothing was saved. Check the highlighted settings." : null) ||
        apiError.error ||
        fallback,
    )
    this.status = apiError.status
    this.code = apiError.code
    this.fieldErrors = apiError.fieldErrors
    const keys = apiError.details?.keys
    this.reauthKeys = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : []
  }

  get needsReauth(): boolean {
    return this.code === SiteSettingsErrorCode.REAUTH_REQUIRED
  }
}

async function call<T>(authFetch: AuthFetch, path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response
  try {
    res = await authFetch(path, init)
  } catch {
    throw new SiteSettingsError({ status: 0, code: null, error: null, details: null, fieldErrors: {} }, "Can't reach the server. Check the connection and try again.")
  }
  if (!res.ok) throw new SiteSettingsError(await readApiError(res), fallback)
  return (await res.json()) as T
}

function normaliseSettings(body: SiteSettings): SiteSettings {
  return {
    offlineEntitled: body?.offlineEntitled === true,
    settings: Array.isArray(body?.settings) ? body.settings.map((s) => ({ ...s, limits: s.limits ?? {} })) : [],
  }
}

export async function fetchSiteSettings(authFetch: AuthFetch): Promise<SiteSettings> {
  return normaliseSettings(await call<SiteSettings>(authFetch, "/admin/settings", undefined, "Unable to load the site settings."))
}

// Only the keys sent change; all or nothing.
export async function saveSiteSettings(authFetch: AuthFetch, changes: Record<string, SettingValue>): Promise<SiteSettings> {
  const init: RequestInit = { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }
  return normaliseSettings(await call<SiteSettings>(authFetch, "/admin/settings", init, "Unable to save the site settings."))
}

export function resetSettingPath(key: string): string {
  return `/admin/settings/${encodeURIComponent(key)}/reset`
}

export async function resetSiteSetting(authFetch: AuthFetch, key: string): Promise<SiteSettings> {
  return normaliseSettings(await call<SiteSettings>(authFetch, resetSettingPath(key), { method: "POST" }, "Unable to reset the setting."))
}

export interface HistoryQuery {
  key: string | null
  page: number
  size: number
}

export function historyPath(query: HistoryQuery): string {
  const params = new URLSearchParams()
  if (query.key) params.set("key", query.key)
  params.set("page", String(Math.max(0, query.page)))
  params.set("size", String(query.size))
  return `/admin/settings/history?${params.toString()}`
}

export async function fetchSettingsHistory(authFetch: AuthFetch, query: HistoryQuery): Promise<SettingHistoryPage> {
  const body = await call<Partial<SettingHistoryPage>>(authFetch, historyPath(query), undefined, "Unable to load the change history.")
  return {
    content: Array.isArray(body?.content) ? body.content : [],
    page: typeof body?.page === "number" ? body.page : query.page,
    size: typeof body?.size === "number" ? body.size : query.size,
    totalElements: typeof body?.totalElements === "number" ? body.totalElements : 0,
    totalPages: typeof body?.totalPages === "number" ? body.totalPages : 0,
  }
}

// The 400 message to show under a field: the screen's own wording where the server's is in API terms (VAT).
export function fieldMessage(key: string, serverMessage: string): string {
  return settingCopy(key).clientMessage ?? serverMessage
}
