// T0-5d: stock locations (contract docs/2026-11-21-t0-5c-locations-api-contract.md). Types and calls for
// GET /locations and /admin/locations…, the refusal codes in plain words, and the plan for moving a row.
// Location names always come from the API; nothing here names a location. Find the primary by `kind`, never by
// name or id. Branch on `code` and `details.reasons` only; `error` is for display.

import { readApiError, detailNumber, detailString, type ApiError } from "@/lib/api-error"
import { formatQuantityWithUom } from "@/lib/light-meal-stock"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

// ---- Types (contract sections 3 and 4) ----

export type LocationKind = "PRIMARY" | "SECONDARY"

// GET /locations: active locations in display order; `includeInactive=true` adds deactivated ones.
export interface Location {
  id: number
  name: string
  kind: LocationKind
  sortOrder: number
  // Not in the contract's picker example; present only if the server sends it. Treat a missing value as active.
  active?: boolean
}

export type AssignmentRole = "PRODUCTION" | "STATION_KITCHEN" | "STATION_BAR" | "STATION_NONE"

export const ASSIGNMENT_ROLES: readonly AssignmentRole[] = ["PRODUCTION", "STATION_KITCHEN", "STATION_BAR", "STATION_NONE"]

export interface StockSummary {
  ingredientsWithStock: number
  ingredientsNegative: number
}

// GET /admin/locations: every location, inactive ones too, in display order.
export interface AdminLocation {
  id: number
  name: string
  kind: LocationKind
  active: boolean
  sortOrder: number
  stockSummary: StockSummary
  assignedTo: AssignmentRole[]
  createdAt: string | null
  createdByName: string | null
  updatedAt: string | null
  updatedByName: string | null
}

export type SalesStation = "KITCHEN" | "BAR" | "NONE"

export const SALES_STATIONS: readonly SalesStation[] = ["KITCHEN", "BAR", "NONE"]

export interface LocationRef {
  id: number
  name: string
}

// GET /admin/locations/assignments. `primary` is for display; it isn't an assignment.
export interface LocationAssignments {
  primary: LocationRef
  production: LocationRef
  stations: Record<SalesStation, LocationRef>
}

// PUT /admin/locations/assignments: each part optional; what is sent is replaced.
export interface AssignmentsBody {
  productionLocationId?: number
  stations?: Partial<Record<SalesStation, number>>
}

export type LocationAction = "CREATE" | "UPDATE" | "DEACTIVATE" | "ACTIVATE" | "ASSIGN"

export interface LocationState {
  name: string
  sortOrder: number
  active: boolean
}

export interface LocationHistoryEntry {
  id: number
  locationId: number
  action: LocationAction
  role: AssignmentRole | null
  previousLocationId: number | null
  before: LocationState | null
  after: LocationState | null
  changedAt: string
  changedBy: number | null
  changedByName: string | null
}

export interface LocationHistoryPage {
  content: LocationHistoryEntry[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

// ---- Picker helpers ----

export function primaryOf<T extends { kind: LocationKind }>(locations: readonly T[]): T | null {
  return locations.find((location) => location.kind === "PRIMARY") ?? null
}

// Active secondaries, in the order given (the API's display order).
export function activeSecondaries<T extends { kind: LocationKind; active?: boolean }>(locations: readonly T[]): T[] {
  return locations.filter((location) => location.kind === "SECONDARY" && location.active !== false)
}

export function locationsPath(includeInactive = false): string {
  return includeInactive ? "/locations?includeInactive=true" : "/locations"
}

// The ISSUE requesting location to preselect: the only active secondary, otherwise none (the user must choose).
export function defaultIssueLocationId(locations: readonly Location[]): number | null {
  const secondaries = activeSecondaries(locations)
  return secondaries.length === 1 ? secondaries[0].id : null
}

// ---- Errors ----

export class LocationError extends Error {
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
  if (!res.ok) throw new LocationError(await readApiError(res), fallback)
  return (await res.json()) as T
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

// ---- Calls (contract section 4) ----

export function listAdminLocations(authFetch: AuthFetch): Promise<AdminLocation[]> {
  return call(authFetch, "/admin/locations", undefined, "Unable to load the stock locations.")
}

export interface LocationBody {
  name: string
  sortOrder?: number
}

export function createLocation(authFetch: AuthFetch, body: LocationBody): Promise<AdminLocation> {
  return call(authFetch, "/admin/locations", jsonBody("POST", body), "Unable to add the location.")
}

export function updateLocation(authFetch: AuthFetch, id: number, body: LocationBody): Promise<AdminLocation> {
  return call(authFetch, `/admin/locations/${id}`, jsonBody("PUT", body), "Unable to save the location.")
}

export function deactivateLocation(authFetch: AuthFetch, id: number): Promise<AdminLocation> {
  return call(authFetch, `/admin/locations/${id}/deactivate`, { method: "POST" }, "Unable to deactivate the location.")
}

export function activateLocation(authFetch: AuthFetch, id: number): Promise<AdminLocation> {
  return call(authFetch, `/admin/locations/${id}/activate`, { method: "POST" }, "Unable to activate the location.")
}

export function fetchAssignments(authFetch: AuthFetch): Promise<LocationAssignments> {
  return call(authFetch, "/admin/locations/assignments", undefined, "Unable to load the assignments.")
}

export function saveAssignments(authFetch: AuthFetch, body: AssignmentsBody): Promise<LocationAssignments> {
  return call(authFetch, "/admin/locations/assignments", jsonBody("PUT", body), "Unable to save the assignments.")
}

export const HISTORY_PAGE_SIZES = [50, 100, 200] as const

export interface LocationHistoryQuery {
  locationId: number | null
  page: number
  size: number
}

export function historyPath({ locationId, page, size }: LocationHistoryQuery): string {
  const params = new URLSearchParams()
  if (locationId !== null) params.set("locationId", String(locationId))
  params.set("page", String(page))
  params.set("size", String(size))
  return `/admin/locations/history?${params.toString()}`
}

export function fetchLocationHistory(authFetch: AuthFetch, query: LocationHistoryQuery): Promise<LocationHistoryPage> {
  return call(authFetch, historyPath(query), undefined, "Unable to load the change history.")
}

// ---- The form and its client checks (contract section 2) ----

export const NAME_MAX = 50
export const SORT_ORDER_MIN = 0
export const SORT_ORDER_MAX = 9999

export function nameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "Enter a name."
  if (trimmed.length > NAME_MAX) return `At most ${NAME_MAX} characters.`
  return null
}

// LOCATION_INVALID's details.fields, as field → message.
export function invalidFields(error: LocationError): Record<string, string> {
  const fields = error.details?.fields
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {}
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

// ---- Copy ----

export function kindLabel(kind: LocationKind): string {
  return kind === "PRIMARY" ? "Primary" : "Secondary"
}

export function stockSummaryText(summary: StockSummary): string {
  const inStock = `${summary.ingredientsWithStock} ${summary.ingredientsWithStock === 1 ? "ingredient" : "ingredients"} in stock`
  return summary.ingredientsNegative > 0 ? `${inStock}, ${summary.ingredientsNegative} below zero` : inStock
}

export function stationLabel(station: SalesStation): string {
  switch (station) {
    case "KITCHEN":
      return "Kitchen"
    case "BAR":
      return "Bar"
    case "NONE":
      return "Handed over at the till"
  }
}

// What a location is assigned to, for the list's column.
export function assignmentLabel(role: AssignmentRole): string {
  switch (role) {
    case "PRODUCTION":
      return "Production"
    case "STATION_KITCHEN":
      return "Kitchen station"
    case "STATION_BAR":
      return "Bar station"
    case "STATION_NONE":
      return "Handed over at the till"
  }
}

// The ASSIGNED reason, one line per role.
export function assignedReasonLine(role: AssignmentRole): string {
  switch (role) {
    case "PRODUCTION":
      return "It's the production location"
    case "STATION_KITCHEN":
      return "It supplies the kitchen station"
    case "STATION_BAR":
      return "It supplies the bar station"
    case "STATION_NONE":
      return "It supplies items handed over at the till"
  }
}

// The role an ASSIGN history row gave the location.
function assignedRolePhrase(role: AssignmentRole | null): string {
  switch (role) {
    case "PRODUCTION":
      return "the production location"
    case "STATION_KITCHEN":
      return "the kitchen station's source"
    case "STATION_BAR":
      return "the bar station's source"
    case "STATION_NONE":
      return "the source for items handed over at the till"
    default:
      return "assigned to a job"
  }
}

function isAssignmentRole(value: unknown): value is AssignmentRole {
  return typeof value === "string" && (ASSIGNMENT_ROLES as readonly string[]).includes(value)
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : []
}

// Refusals on create, rename and activate. Null for anything else (show the server's message as it is).
export function saveRefusalMessage(error: LocationError): string | null {
  switch (error.code) {
    case "LOCATION_NAME_TAKEN": {
      const name = detailString(error.details, "name")
      return name ? `Another active location is already called ${name}.` : "Another active location already has this name."
    }
    case "LOCATION_LIMIT_REACHED":
      return limitReachedMessage(error)
    case "LOCATION_NOT_FOUND":
      return "This location no longer exists. The list has been reloaded."
    default:
      return null
  }
}

export function limitReachedMessage(error: LocationError): string {
  const max = detailNumber(error.details, "maxActive")
  const limit = max === null ? "a limited number of" : `at most ${max}`
  return `This site can have ${limit} active locations, the primary included. Deactivate one first.`
}

// The setting that holds the maximum, for a link to Admin → Settings.
export const MAX_ACTIVE_SETTING_KEY = "stock.locations.max-active"

// ---- Deactivate refusal (contract 4.4) ----

export type DeactivateReason = "PRIMARY" | "HAS_STOCK" | "ASSIGNED" | "OPEN_STOCK_REQUESTS" | "OPEN_STOCK_TAKES"

export interface StockLine {
  ingredientId: number
  name: string
  unit: string
  quantity: number
}

export type DeactivateRefusalItem =
  | { reason: "PRIMARY"; text: string }
  | { reason: "HAS_STOCK"; text: string; lines: StockLine[]; shown: number; total: number; howToClear: string }
  | { reason: "ASSIGNED"; text: string; lines: string[] }
  | { reason: "OPEN_STOCK_REQUESTS"; text: string; ids: number[] }
  | { reason: "OPEN_STOCK_TAKES"; text: string; ids: number[] }
  // A reason this screen doesn't know yet: shown by its code.
  | { reason: "OTHER"; text: string }

export const HOW_TO_CLEAR_STOCK = "To clear it, waste it, or count it to zero with a stock take."

function stockLines(value: unknown): StockLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const record = entry as Record<string, unknown>
    if (typeof record.ingredientId !== "number" || typeof record.name !== "string" || typeof record.quantity !== "number") return []
    return [{ ingredientId: record.ingredientId, name: record.name, unit: typeof record.unit === "string" ? record.unit : "", quantity: record.quantity }]
  })
}

export function formatStockLine(line: StockLine): string {
  return `${line.name}: ${line.unit ? formatQuantityWithUom(line.quantity, line.unit) : String(line.quantity)}`
}

// Every reason in details.reasons, in the order the server sent them. Null when the error isn't this refusal.
export function deactivateRefusal(error: LocationError): DeactivateRefusalItem[] | null {
  if (error.code !== "LOCATION_DEACTIVATE_REFUSED") return null
  const reasons = Array.isArray(error.details?.reasons) ? (error.details?.reasons as unknown[]) : []
  return reasons.flatMap((reason): DeactivateRefusalItem[] => {
    switch (reason) {
      case "PRIMARY":
        return [{ reason, text: "It's the primary location: every delivery is received here." }]
      case "HAS_STOCK": {
        const lines = stockLines(error.details?.stock)
        const total = detailNumber(error.details, "ingredientsWithStock") ?? lines.length
        return [
          {
            reason,
            text: `This location still holds stock: ${total} ${total === 1 ? "ingredient" : "ingredients"}`,
            lines,
            shown: lines.length,
            total,
            howToClear: HOW_TO_CLEAR_STOCK,
          },
        ]
      }
      case "ASSIGNED": {
        const roles = Array.isArray(error.details?.assignedTo) ? (error.details?.assignedTo as unknown[]).filter(isAssignmentRole) : []
        return [{ reason, text: "It's assigned to a job", lines: roles.map(assignedReasonLine) }]
      }
      case "OPEN_STOCK_REQUESTS":
        return [{ reason, text: "It has open stock requests", ids: numberList(error.details?.openStockRequestIds) }]
      case "OPEN_STOCK_TAKES":
        return [{ reason, text: "It has stock takes waiting for review", ids: numberList(error.details?.openStockTakeIds) }]
      default:
        return typeof reason === "string" ? [{ reason: "OTHER", text: reason }] : []
    }
  })
}

// ---- Assignment and ISSUE refusals (contract 4.7, section 2) ----

// Codes after which the caller reloads the locations and asks to choose again.
export const CHOOSE_AGAIN_CODES = ["ASSIGNMENT_NOT_SECONDARY", "ISSUE_LOCATION_NOT_SECONDARY", "LOCATION_INACTIVE", "LOCATION_NOT_FOUND"] as const

export function isChooseAgain(error: LocationError): boolean {
  return (CHOOSE_AGAIN_CODES as readonly (string | null)[]).includes(error.code)
}

// A location named in an assignment or an ISSUE request can't be used. Null for other codes.
export function chooseAgainMessage(error: LocationError): string | null {
  const name = detailString(error.details, "locationName")
  const subject = name ?? "That location"
  switch (error.code) {
    case "ASSIGNMENT_NOT_SECONDARY":
    case "ISSUE_LOCATION_NOT_SECONDARY":
      return `${subject} is the primary location: it supplies every issue, so it can't be chosen here. The locations have been reloaded; choose again.`
    case "LOCATION_INACTIVE":
      return `${subject} has been deactivated. The locations have been reloaded; choose again.`
    case "LOCATION_NOT_FOUND":
      return "That location no longer exists. The locations have been reloaded; choose again."
    default:
      return null
  }
}

export function assignmentErrorMessage(error: LocationError): string {
  if (error.code === "LOCATION_INVALID") return "Nothing to save: no assignment was changed."
  return chooseAgainMessage(error) ?? error.message
}

// Only what changed, or null when nothing did.
export function assignmentChanges(
  current: LocationAssignments,
  chosen: { production: number; stations: Record<SalesStation, number> },
): AssignmentsBody | null {
  const body: AssignmentsBody = {}
  if (chosen.production !== current.production.id) body.productionLocationId = chosen.production
  const stations: Partial<Record<SalesStation, number>> = {}
  for (const station of SALES_STATIONS) {
    if (chosen.stations[station] !== current.stations[station].id) stations[station] = chosen.stations[station]
  }
  if (Object.keys(stations).length > 0) body.stations = stations
  return Object.keys(body).length > 0 ? body : null
}

// ---- Moving a row (contract 4.3: no bulk endpoint) ----

export interface MoveStep {
  id: number
  name: string
  sortOrder: number
}

function clampSortOrder(value: number): number {
  return Math.min(SORT_ORDER_MAX, Math.max(SORT_ORDER_MIN, value))
}

// The PUTs that move rows[index] up or down one place, in the order to send them. Different sort orders swap
// (two PUTs, the moved row first). Equal ones (rows then sort by id) need one PUT: the moved row gets the other's
// value minus 1 going up, plus 1 going down, kept within 0–9999. Empty when the row can't move.
export function planMove(rows: readonly MoveStep[], index: number, direction: "up" | "down"): MoveStep[] {
  const otherIndex = direction === "up" ? index - 1 : index + 1
  const moved = rows[index]
  const other = rows[otherIndex]
  if (!moved || !other) return []
  if (moved.sortOrder !== other.sortOrder) {
    return [
      { id: moved.id, name: moved.name, sortOrder: other.sortOrder },
      { id: other.id, name: other.name, sortOrder: moved.sortOrder },
    ]
  }
  const target = clampSortOrder(direction === "up" ? other.sortOrder - 1 : other.sortOrder + 1)
  if (target === moved.sortOrder) return []
  return [{ id: moved.id, name: moved.name, sortOrder: target }]
}

// ---- History (contract 4.8) ----

export function historyActionLabel(action: LocationAction): string {
  switch (action) {
    case "CREATE":
      return "Created"
    case "UPDATE":
      return "Changed"
    case "DEACTIVATE":
      return "Deactivated"
    case "ACTIVATE":
      return "Activated"
    case "ASSIGN":
      return "Assigned"
  }
}

// What a history row changed, in words. `nameOf` finds a location's current name by id (null when unknown).
export function describeHistoryEntry(entry: LocationHistoryEntry, nameOf: (id: number) => string | null): string[] {
  switch (entry.action) {
    case "CREATE":
      return [entry.after ? `Created as ${entry.after.name}` : "Created"]
    case "DEACTIVATE":
      return ["Deactivated"]
    case "ACTIVATE":
      return ["Activated"]
    case "ASSIGN": {
      const previous = entry.previousLocationId === null ? null : nameOf(entry.previousLocationId)
      const was = entry.previousLocationId === null ? "" : ` (was ${previous ?? `location #${entry.previousLocationId}`})`
      return [`Now ${assignedRolePhrase(entry.role)}${was}`]
    }
    case "UPDATE": {
      const lines: string[] = []
      if (entry.before && entry.after) {
        if (entry.before.name !== entry.after.name) lines.push(`Renamed from ${entry.before.name} to ${entry.after.name}`)
        if (entry.before.sortOrder !== entry.after.sortOrder) lines.push(`Order ${entry.before.sortOrder} → ${entry.after.sortOrder}`)
      }
      return lines.length > 0 ? lines : ["Changed"]
    }
  }
}
