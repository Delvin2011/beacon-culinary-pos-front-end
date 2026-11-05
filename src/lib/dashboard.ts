// Back-office dashboard. Contract: DASHBOARD.md (backend repo).
//   GET /admin/dashboard/layout          → DashboardLayout (which sections, in which order; no figures)
//   GET /admin/dashboard/sections/{key}  → SectionEnvelope (range-aware sections take ?range=today|7d|month)
// The server decides what appears and computes every figure; the browser lays out and formats only.
// A field that is absent is one the user may not see (show nothing); a field that is null has no value yet.

export const DASHBOARD_TIME_ZONE = "Africa/Johannesburg"

export type DashboardRange = "today" | "7d" | "month"

export const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "month", label: "Month" },
]

export const DEFAULT_RANGE: DashboardRange = "7d"

// Anything else in the URL falls back to 7 days (the server answers 400 to it).
export function parseRange(value: string | null | undefined): DashboardRange {
  return value === "today" || value === "7d" || value === "month" ? value : DEFAULT_RANGE
}

export interface LayoutSection {
  key: string
  title: string
  usesRange: boolean
  refreshSeconds: number
}

export interface DashboardLayout {
  asOf: string
  timezone: string
  sections: LayoutSection[]
}

export interface ReportLink {
  key: string
  params: Record<string, unknown>
}

export interface SectionEnvelope<T = unknown> {
  key: string
  asOf: string
  range: DashboardRange | null
  definitionVersion: number
  data: T
  reportLink: ReportLink | null
}

// ---- Section data ----

export type Severity = "RED" | "AMBER" | "BLUE" | "NEUTRAL"

export interface AttentionItem {
  key: string
  severity: Severity
  tag: string
  title: string
  detail: string
  action: { label: string; path: string } | null
  count?: number | null
  since?: string | null
}

export interface AttentionData {
  items: AttentionItem[]
  moreCount: number
}

export interface StationNow {
  pending: number
  inProgress: number
  open: number
  longestWaitMinutes: number | null
}

export interface NowData {
  kitchen: StationNow
  bar: StationNow | null
  readyToCollect: { count: number; oldestMinutes: number | null }
  // Absent: the user has no cash permission. null: no shift open.
  onTheTill?: { shiftId: number; owner: string; since: string; expectedCash: number } | null
}

export type Tone = "POSITIVE" | "WATCH" | "NEUTRAL"

export interface TodayTile {
  key: string
  label: string
  value: number
  type: "MONEY" | "COUNT"
  secondary: string | null
  delta: number | null
  tone: Tone
}

export interface TodayData {
  day: string
  compareDay: string | null
  compareLabel: string | null
  tiles: TodayTile[]
}

export interface SalesTrendData {
  days: Array<{ day: string; label: string; netSales: number; compare: number | null; isToday: boolean }>
}

export interface SalesMixData {
  basis: "BEFORE_DISCOUNTS" | string
  total: number
  groups: Array<{ key: string; label: string; amount: number; percent: number }>
}

export interface BusyHoursData {
  hours: Array<{ hour: number; today: number; typical: number | null }>
  peak: { hour: number; orders: number } | null
  typicalBasis: string | null
}

export interface HeatmapData {
  from: string
  to: string
  hours: number[]
  rows: Array<{ weekday: string; label: string; tradingDays: number; cells: number[] }>
  max: number
}

export interface TopSellerItem {
  rank: number
  name: string
  tag: "SET_MEAL" | "LIGHT_MEAL" | "BEVERAGE" | "EXTRA" | string
  portions: number
  // Absent for users who can't see money.
  soldValue?: number
}

export type TopSellersSort = "PORTIONS" | "VALUE"

export interface TopSellersData {
  sortBy: TopSellersSort
  type: string
  items: TopSellerItem[]
}

export interface SellThroughData {
  thresholdPercent: number
  afterTime: string
  rows: Array<{
    name: string
    planned: number
    sold: number
    sellThroughPercent: number | null
    soldOutAt: string | null
    slow: boolean
  }>
}

export interface LightMealStockRow {
  mealId: number
  name: string
  status: "OUT" | "LOW" | "OK" | string
  unitsAvailable: number | null
  limitingIngredient: string | null
  lowStockUnits: number
  outToday: boolean
}

export interface LightMealStockData {
  meals: LightMealStockRow[]
  moreCount: number
}

export interface PaymentMixData {
  basis: "MONEY_COLLECTED" | string
  total: number
  methods: Array<{ method: string; amount: number; percent: number }>
}

export interface BasketData {
  averageOrder: number
  series: Array<{ day: string; value: number }>
  itemsPerOrder: number | null
  extrasAttachPercent: number | null
}

export interface WaitingData {
  kitchenMedianMinutes: number | null
  barMedianMinutes: number | null
  collectMedianMinutes: number | null
  longest: { minutes: number; at: string } | null
}

export interface AccountCustomersData {
  accounts: Array<{ accountId: number; name: string; amount: number }>
  total: number
  orders: number
}

// ---- Formatting (the browser formats; it never calculates) ----

// Space thousands: 4820 → "4 820".
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}

// R 4 820,00 · -R 60,00
export function formatRand(value: number | null | undefined): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0
  const [whole, cents] = Math.abs(safe).toFixed(2).split(".")
  const sign = safe < 0 && Number(`${whole}.${cents}`) !== 0 ? "-" : ""
  return `${sign}R ${groupThousands(whole)},${cents}`
}

// Axis labels: R 0 · R 2k · R 1,5k
export function formatRandShort(value: number): string {
  if (Math.abs(value) >= 1000) return `R ${formatDecimal(value / 1000, 1)}k`
  return `R ${groupThousands(String(Math.round(value)))}`
}

// Whole numbers with space thousands: 1240 → "1 240".
export function formatCount(value: number | null | undefined): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0
  return `${safe < 0 ? "-" : ""}${groupThousands(String(Math.abs(safe)))}`
}

// Up to `digits` decimals, comma separator, trailing zeros dropped: 62.5 → "62,5", 100 → "100".
export function formatDecimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0"
  const fixed = Math.abs(value).toFixed(digits)
  const [whole, fraction = ""] = fixed.split(".")
  const trimmed = fraction.replace(/0+$/, "")
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : ""
  return `${sign}${groupThousands(whole)}${trimmed ? `,${trimmed}` : ""}`
}

// The percentage as given, with a comma: 62.5 → "62,5%".
export function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${formatDecimal(value, 1)}%` : "–"
}

// Whole-percent delta with a sign (a true minus): "+6%", "−3%", "0%".
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${formatCount(delta)}%`
  if (delta < 0) return `−${formatCount(Math.abs(delta))}%`
  return "0%"
}

// Minutes arrive with one decimal; shown rounded to whole minutes.
export function formatMinutes(value: number): string {
  return `${formatCount(value)} min`
}

// 6 → "06:00"
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`
}

const jhbTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: DASHBOARD_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const jhbHour = new Intl.DateTimeFormat("en-GB", { timeZone: DASHBOARD_TIME_ZONE, hour: "2-digit", hourCycle: "h23" })

const jhbLongDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: DASHBOARD_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// "14:35" in Johannesburg.
export function formatJhbClock(value: string | Date): string {
  const date = toDate(value)
  return date ? jhbTime.format(date) : ""
}

// The hour (0–23) in Johannesburg, e.g. for "14:00 is still running".
export function jhbHourOf(value: string | Date): number | null {
  const date = toDate(value)
  if (!date) return null
  const hour = Number(jhbHour.formatToParts(date).find((part) => part.type === "hour")?.value)
  return Number.isFinite(hour) ? hour : null
}

// "Thursday 5 November 2026" in Johannesburg.
export function formatJhbLongDate(value: string | Date): string {
  const date = toDate(value)
  if (!date) return ""
  const parts = Object.fromEntries(jhbLongDate.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`
}

// "2026-10-07" → "7 Oct" (a calendar date, no time zone shift).
export function formatShortDay(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay)
  if (!match) return isoDay
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]}`
}

// ---- Fixed vocabularies ----

export const TOP_SELLER_TAGS: Record<string, string> = {
  SET_MEAL: "Set meal",
  LIGHT_MEAL: "Light meal",
  BEVERAGE: "Beverage",
  EXTRA: "Extra",
}

const PAYMENT_METHOD_LABELS: Record<string, string> = { CASH: "Cash", CARD: "Card", ACCOUNT: "Account" }

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method.toUpperCase()] ?? method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()
}

// ---- Action paths ----

// The backend names a logical destination; this maps it to the route in this app. Unknown paths pass through.
// Tell the backend team if one should change (it's a one-line change there).
const ACTION_ROUTES: Record<string, string> = {
  "/pos-activity": "/pos-activity",
  // Shift sign-off and Close Day live on the X Reading (its Close Day blockers link to each shift).
  "/end-of-day": "/reports/x-reading",
  "/stock/requests": "/inventory/stock-requests",
  "/catalogue/light-meals": "/catalog?tab=meals&group=LIGHT_MEALS",
  "/reports/cash-up-variance": "/reports/cash-up-variance",
  "/daily-planning": "/daily-planning",
}

export function actionHref(path: string): string {
  const [pathname, query] = path.split("?", 2)
  const mapped = ACTION_ROUTES[pathname.replace(/\/+$/, "") || "/"]
  if (!mapped) return path
  if (!query) return mapped
  return `${mapped}${mapped.includes("?") ? "&" : "?"}${query}`
}

// ---- Requests ----

export function layoutPath(): string {
  return "/admin/dashboard/layout"
}

export function sectionPath(key: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(name, value)
  }
  const search = query.toString()
  return `/admin/dashboard/sections/${encodeURIComponent(key)}${search ? `?${search}` : ""}`
}

// The later of two ISO instants (either may be missing).
export function laterInstant(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(b).getTime() > new Date(a).getTime() ? b : a
}
