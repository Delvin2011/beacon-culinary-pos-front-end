import { formatZarCurrency } from "@/lib/utils"
import { jhbIsoDate } from "@/lib/pos-activity"

// Types and helpers for the generic report viewer (GET /admin/reports...).
// The viewer formats what the server sends; it never calculates figures.

export type ReportParamType = "DATE" | "ENUM" | "BOOLEAN" | "USER"

export interface ReportParam {
  name: string
  label: string
  type: ReportParamType
  default?: string
  options?: string[]
}

export interface ReportDefinition {
  key: string
  title: string
  category: string
  description: string
  template: "TABLE" | "STATEMENT" | string
  definitionVersion: number
  params: ReportParam[]
}

export type ReportColumnType = "TEXT" | "INT" | "MONEY" | "VARIANCE" | "PERCENT" | "DATE" | "DATETIME" | "STATUS"
export type StatusTone = "positive" | "neutral" | "warning" | "negative"

export interface ReportColumn {
  key: string
  label: string
  type: ReportColumnType | string
  total?: "SUM" | "DERIVED" | "LABEL" | "NONE" | string
  statusTones?: Record<string, StatusTone>
}

export type CellValue = string | number | boolean | null | undefined
export type ReportRow = Record<string, CellValue>

export type CheckStatus = "PASS" | "WARN" | "FAIL"

export interface ReportCheck {
  key: string
  label: string
  status: CheckStatus | string
  unit: "MONEY" | "COUNT" | string
  expected: number | null
  actual: number | null
  difference: number | null
  detail?: string | null
}

export interface ReportEnvelope {
  meta: {
    key: string
    title: string
    category: string
    definitionVersion: number
    generatedAt: string
    timezone: string
    currency: string
    amountsInclVat: boolean
    params: Record<string, string | number | boolean | null>
    notes?: string[]
  }
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: ReportRow | null
  checks: ReportCheck[]
  page: unknown
}

const CATEGORY_LABELS: Record<string, string> = {
  DAILY_STATEMENTS: "Daily Statements",
  SALES: "Sales",
  PAYMENTS_ACCOUNTS: "Payments & Accounts",
  CONTROLS_STAFF: "Controls & Staff",
  KITCHEN_PLANNING: "Kitchen & Planning",
  STOCK_INVENTORY: "Stock & Inventory",
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humaniseEnum(category)
}

// Known categories in their documented order, then any new ones alphabetically.
export function compareCategories(a: string, b: string): number {
  const ia = CATEGORY_ORDER.indexOf(a)
  const ib = CATEGORY_ORDER.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
  return a.localeCompare(b)
}

export function templateLabel(template: string): string {
  return humaniseEnum(template)
}

// "PAYMENTS_ACCOUNTS" -> "Payments accounts", "DAY" -> "Day".
export function humaniseEnum(value: string): string {
  const words = value.toLowerCase().split("_").join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ---- Dates (Johannesburg trading days, yyyy-MM-dd) ----

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Resolves catalogue defaults such as "today" and "today-6".
export function resolveParamDefault(param: ReportParam): string | undefined {
  if (param.default === undefined || param.default === null) return undefined
  if (param.type === "DATE") {
    const match = /^today(?:([+-])(\d+))?$/.exec(param.default.trim())
    if (match) {
      const offset = match[2] ? Number(match[2]) * (match[1] === "-" ? -1 : 1) : 0
      return addDays(jhbIsoDate(), offset)
    }
  }
  return param.default
}

export type DatePreset = "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "custom"

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  custom: "Custom",
}

export function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const today = jhbIsoDate()
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "yesterday": {
      const yesterday = addDays(today, -1)
      return { from: yesterday, to: yesterday }
    }
    case "last7":
      return { from: addDays(today, -6), to: today }
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case "lastMonth": {
      const lastDay = addDays(`${today.slice(0, 7)}-01`, -1)
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay }
    }
  }
}

export function detectPreset(from: string, to: string): DatePreset {
  for (const preset of ["today", "yesterday", "last7", "thisMonth", "lastMonth"] as const) {
    const range = presetRange(preset)
    if (range.from === from && range.to === to) return preset
  }
  return "custom"
}

// ---- Cell formatting ----

const intFormatter = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 })
const percentFormatter = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 })
// DATE values are already Johannesburg calendar days, so format them without shifting zones.
const calendarDateFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
})

export function formatCalendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return calendarDateFormatter.format(new Date(`${value}T00:00:00Z`))
}

export function formatInt(value: number): string {
  return intFormatter.format(value)
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`
}

export function formatCheckValue(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "—"
  return unit === "MONEY" ? formatZarCurrency(value) : formatInt(value)
}

export function isNumericColumn(type: string): boolean {
  return type === "INT" || type === "MONEY" || type === "VARIANCE" || type === "PERCENT"
}

// ---- Checks ----

export function overallCheckStatus(checks: ReportCheck[]): CheckStatus | null {
  if (checks.length === 0) return null
  if (checks.some((check) => check.status === "FAIL")) return "FAIL"
  if (checks.some((check) => check.status === "WARN")) return "WARN"
  return "PASS"
}

// ---- Errors ----

// A 400 body is a map of parameter name -> message. Anything else becomes a general message.
export function parseFieldErrors(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  const errors: Record<string, string> = {}
  for (const [field, message] of Object.entries(body as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) errors[field] = message
  }
  return errors
}

export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) return decodeURIComponent(encoded[1])
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : fallback
}
