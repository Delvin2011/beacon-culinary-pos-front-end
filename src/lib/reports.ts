import { formatZarCurrency } from "@/lib/utils"
import { jhbIsoDate } from "@/lib/pos-activity"

// Types and helpers for the generic report viewer (GET /admin/reports...).
// The viewer formats what the server sends; it never calculates figures.

export type ReportParamType = "DATE" | "ENUM" | "BOOLEAN" | "USER" | "ID" | "LIMIT" | "INT"

// ENUM and LIMIT options are plain strings; ID options carry a database id and its label.
export type ReportParamOption = string | { value: string; label: string }

export interface ReportParam {
  name: string
  label: string
  type: ReportParamType
  default?: string
  options?: ReportParamOption[]
  required?: boolean
  // Only applies while another parameter has one of these values (Tender's Check # with groupBy CHECK).
  appliesWhen?: { param: string; values: string[] }
}

export function paramApplies(param: ReportParam, values: Record<string, string>): boolean {
  if (!param.appliesWhen) return true
  return param.appliesWhen.values.includes(values[param.appliesWhen.param] ?? "")
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

export type ReportColumnType = "TEXT" | "INT" | "DECIMAL" | "MONEY" | "VARIANCE" | "PERCENT" | "DATE" | "DATETIME" | "STATUS"
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

// ---- R3: statements, actions, paging ----

export type PrintMedium = "A4" | "SLIP80"
export type SectionType = "KEY_VALUE" | "TABLE" | "SIGNATURE_LINES"

export interface KeyValueItem {
  label: string
  type: ReportColumnType | string
  value: CellValue
  emphasis?: "TOTAL"
}

interface BaseSection {
  key: string
  type: SectionType | string
  // A section without a title is the statement's header block.
  title?: string
  // Absent means both media.
  printOn?: PrintMedium[]
}

export interface KeyValueSection extends BaseSection {
  type: "KEY_VALUE"
  items: KeyValueItem[]
}

export interface TableSection extends BaseSection {
  type: "TABLE"
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: ReportRow | null
  // The (at most 3) columns printed on the 80 mm slip.
  slipColumns?: string[]
}

export interface SignatureSection extends BaseSection {
  type: "SIGNATURE_LINES"
  labels: string[]
}

export type ReportSection = KeyValueSection | TableSection | SignatureSection

// An input the viewer collects in the action's confirm step and sends in the JSON body (e.g. a revoke reason).
export interface ReportActionField {
  name?: string
  key?: string
  label: string
  type?: string
  required?: boolean
}

export function actionFieldName(field: ReportActionField): string {
  return field.name ?? field.key ?? field.label
}

export interface ReportAction {
  key: string
  label: string
  method: "POST" | string
  path: string
  confirm?: string
  enabled: boolean
  disabledReasons?: string[]
  fields?: ReportActionField[]
}

export type RowActionOutcome = "RELOAD" | "PRINT_RECEIPT" | "OPEN_REPORT"

export interface RowAction {
  key: string
  label: string
  method?: "POST" | string
  path?: string
  confirm?: string
  onSuccess: RowActionOutcome | string
  report?: string
  params?: Record<string, unknown>
}

export interface ReportPage {
  number: number
  size: number
  totalRows: number
  // false: a limit cut the rows ("Showing N of M"); true: server-side pages.
  paged?: boolean
}

// Close Day refusals and other end-of-day 409s.
export interface EndOfDayBlocker {
  code: string
  message: string
  shiftId?: number
  date?: string
  zNumber?: number
}

export interface EndOfDayError {
  error: string
  code: string
  blockers?: EndOfDayBlocker[]
  zNumber?: number
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
    // Labels of the ID parameters that are set, e.g. { accountId: "Acme Logistics" }. Omitted when empty.
    paramLabels?: Record<string, string>
    notes?: string[]
    // Formats the export offers: ["csv","xlsx"] for tables, ["xlsx"] for statements.
    exportFormats?: Array<"csv" | "xlsx">
    // Statements: the printed title ("X Reading"), its reference ("Z-0001"), and the business line.
    statementTitle?: string
    reference?: string
    // An open shift's Cashier Reading: counted cash and variance are null.
    interim?: boolean
    business?: { name: string }
  }
  // A statement (template STATEMENT) sets columns, rows and totals to null and fills sections.
  columns: ReportColumn[] | null
  rows: ReportRow[] | null
  totals: ReportRow | null
  sections?: ReportSection[]
  actions?: ReportAction[]
  checks: ReportCheck[]
  // Totals always cover every row, whatever the page.
  page: ReportPage | null
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

export function isStatement(envelope: ReportEnvelope): boolean {
  return Array.isArray(envelope.sections) && envelope.sections.length > 0
}

// Looks like an envelope (e.g. Close Day answers with the Z Reading).
export function isEnvelope(body: unknown): body is ReportEnvelope {
  return !!body && typeof body === "object" && "meta" in body && ("sections" in body || "columns" in body)
}

export function onMedium(section: { printOn?: PrintMedium[] }, medium: PrintMedium): boolean {
  return !section.printOn || section.printOn.includes(medium)
}

// _actions rides on the row but is never a column.
export function rowActions(row: ReportRow): RowAction[] {
  const actions = (row as Record<string, unknown>)._actions
  return Array.isArray(actions) ? (actions as RowAction[]) : []
}

export function formatZNumber(zNumber: number): string {
  return `Z-${String(zNumber).padStart(4, "0")}`
}

// Every Close Day blocker that points somewhere links there, so managers can fix them one by one.
export function blockerHref(blocker: EndOfDayBlocker): string | null {
  if ((blocker.code === "SHIFT_NOT_SIGNED_OFF" || blocker.code === "SHIFT_OPEN") && blocker.shiftId !== undefined) {
    return `/reports/cashier-reading?shiftId=${blocker.shiftId}`
  }
  if (blocker.code === "PREVIOUS_DAY_NOT_CLOSED" && blocker.date) return `/reports/x-reading?tradingDay=${blocker.date}`
  if (blocker.code === "DAY_ALREADY_CLOSED" && blocker.zNumber !== undefined) return `/reports/z-reading?zNumber=${blocker.zNumber}`
  return null
}

export function reportHref(key: string, params?: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") query.set(name, String(value))
  }
  const search = query.toString()
  return `/reports/${encodeURIComponent(key)}${search ? `?${search}` : ""}`
}

// ---- Parameters ----

// Option values are strings, but meta.params echoes ids as numbers: always compare with String().
export function paramOptions(param: ReportParam): { value: string; label: string }[] {
  return (param.options ?? []).map((option) =>
    typeof option === "string"
      ? { value: option, label: humaniseEnum(option) }
      : { value: String(option.value), label: option.label },
  )
}

// "Account" -> "an account", "Meal period" -> "a meal period".
export function withArticle(label: string): string {
  const lower = label.toLowerCase()
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`
}

// "Select an account": the same message the server returns for a missing required parameter.
export function selectPrompt(param: ReportParam): string {
  return `Select ${withArticle(param.label)}`
}

// A required ID only counts as set when it is one of the catalogue options (a copied link may name a deleted account).
export function isParamSet(param: ReportParam, value: string): boolean {
  if (value === "") return false
  if (param.type !== "ID" || !param.options) return true
  return paramOptions(param).some((option) => option.value === value)
}

// ---- Dates (Johannesburg trading days, yyyy-MM-dd) ----

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Resolves catalogue defaults such as "today" and "today-6".
export function resolveParamDefault(param: ReportParam): string | undefined {
  if (param.default === undefined || param.default === null) return param.type === "LIMIT" ? "ALL" : undefined
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
const decimalFormatter = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

// JSON 3.00 arrives as 3, so DECIMAL always shows 2 places.
export function formatDecimal(value: number): string {
  return decimalFormatter.format(value)
}

// Status codes ("CHARGE", "EXTRAS_REMOVED") read as text; anything already readable is left alone.
export function statusLabel(value: string): string {
  return /^[A-Z0-9_]+$/.test(value) ? humaniseEnum(value) : value
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`
}

export function formatCheckValue(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "—"
  return unit === "MONEY" ? formatZarCurrency(value) : formatInt(value)
}

export function isNumericColumn(type: string): boolean {
  return type === "INT" || type === "DECIMAL" || type === "MONEY" || type === "VARIANCE" || type === "PERCENT"
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
