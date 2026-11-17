// O3 offline foundation: the backend's grant, snapshot and status report.
// Contract: docs/2026-11-17-o3-offline-foundation-api-contract.md (POS_BE). Branch on error `code` only.

import { parseReceiptSettings, type ReceiptSettings } from "@/lib/receipt-settings"

// Contract section 4.
export const OfflineErrorCode = {
  OFFLINE_DISABLED: "OFFLINE_DISABLED",
  DEVICE_NOT_REGISTERED: "DEVICE_NOT_REGISTERED",
  SESSION_ENDED: "SESSION_ENDED",
  POS_SESSION_REQUIRED: "POS_SESSION_REQUIRED",
  NO_OPEN_SHIFT: "NO_OPEN_SHIFT",
  NOT_SHIFT_OWNER: "NOT_SHIFT_OWNER",
  OFFLINE_SALES_PENDING: "OFFLINE_SALES_PENDING",
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
} as const

export type OfflineErrorCode = (typeof OfflineErrorCode)[keyof typeof OfflineErrorCode]

// Shift close refused (contract 10.4): the count comes from details.pendingCount, never from the server's text.
export function offlineSalesPendingMessage(pendingCount: number | null): string {
  if (pendingCount === null) return "This till still has unsynced sales for this shift. Sync them before closing."
  const sales = pendingCount === 1 ? "sale" : "sales"
  return `This till still has ${pendingCount} unsynced ${sales} for this shift. Sync them before closing.`
}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === "string" ? value : null)
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

// ---- POST /pos/offline/grant, 201 (contract 5) ----

export interface OfflineGrant {
  grantId: string | null
  // Opaque: stored and sent back in O4 exactly as received. Never parsed.
  grant: string
  deviceId: string | null
  tillCode: string | null
  shiftId: number
  cashierId: number
  cashierName: string
  issuedAt: string | null
  expiresAt: string
  tradingDay: string
  nextOfflineSeq: number
  maxOfflineHours: number | null
  warnOfflineHours: number | null
  accountsEnabled: boolean
  accountCap: number | null
  serverTimeUtc: string | null
}

// The fields every use of a grant depends on; null when any is missing.
export function parseGrant(body: unknown): OfflineGrant | null {
  if (!isObject(body)) return null
  const grant = str(body.grant)
  const shiftId = num(body.shiftId)
  const cashierId = num(body.cashierId)
  const expiresAt = str(body.expiresAt)
  const tradingDay = str(body.tradingDay)
  const nextOfflineSeq = num(body.nextOfflineSeq)
  if (!grant || shiftId === null || cashierId === null || !expiresAt || !tradingDay || nextOfflineSeq === null) return null
  return {
    grantId: str(body.grantId),
    grant,
    deviceId: str(body.deviceId),
    tillCode: str(body.tillCode),
    shiftId,
    cashierId,
    cashierName: str(body.cashierName) ?? "",
    issuedAt: str(body.issuedAt),
    expiresAt,
    tradingDay,
    nextOfflineSeq,
    maxOfflineHours: num(body.maxOfflineHours),
    warnOfflineHours: num(body.warnOfflineHours),
    accountsEnabled: body.accountsEnabled === true,
    accountCap: body.accountsEnabled === true ? num(body.accountCap) : null,
    serverTimeUtc: str(body.serverTimeUtc),
  }
}

// ---- GET /pos/offline/snapshot, 200 (contract 8) ----

export interface SnapshotPeriod {
  id: number
  name: string
  startTime: string
  endTime: string
  allDay: boolean
}

export interface SnapshotOption {
  id: number
  name: string
  station: string
  group: string
  // null for beverages.
  periodId: number | null
  price: number
  // Only READY options are for sale (as known at the last refresh).
  status: string
  plannedPortions: number | null
  // null: unlimited (always-on items).
  portionsRemaining: number | null
  outToday: boolean
  alwaysOn: boolean
}

export interface SnapshotExtra {
  id: number
  periodId: number
  componentName: string
  priceDelta: number
  bufferRemaining: number | null
}

export interface SnapshotAccount {
  id: number
  accountNumber: string
  name: string
}

export interface OfflineLimits {
  maxOfflineHours: number
  warnOfflineHours: number
}

export interface OfflineSnapshot {
  snapshotVersion: string
  generatedAt: string | null
  serverTimeUtc: string | null
  tradingDay: string
  periods: SnapshotPeriod[]
  options: SnapshotOption[]
  extras: SnapshotExtra[]
  vatRate: number | null
  receiptSettings: ReceiptSettings | null
  tenders: string[]
  accountsEnabled: boolean
  accountCap: number | null
  // Only when accounts are enabled; cleared from the till at shift close, sign-out and revoke.
  accounts: SnapshotAccount[] | null
  limits: OfflineLimits | null
}

export const OPTION_READY = "READY"

function parsePeriod(raw: unknown): SnapshotPeriod | null {
  if (!isObject(raw)) return null
  const id = num(raw.id)
  if (id === null) return null
  return {
    id,
    name: str(raw.name) ?? "",
    startTime: str(raw.startTime) ?? "",
    endTime: str(raw.endTime) ?? "",
    allDay: raw.allDay === true,
  }
}

function parseOption(raw: unknown): SnapshotOption | null {
  if (!isObject(raw)) return null
  const id = num(raw.id)
  const price = num(raw.price)
  const name = str(raw.name)
  if (id === null || price === null || !name) return null
  return {
    id,
    name,
    station: str(raw.station) ?? "NONE",
    group: str(raw.group) ?? "",
    periodId: num(raw.periodId),
    price,
    status: str(raw.status) ?? "",
    plannedPortions: num(raw.plannedPortions),
    portionsRemaining: num(raw.portionsRemaining),
    outToday: raw.outToday === true,
    alwaysOn: raw.alwaysOn === true,
  }
}

function parseExtra(raw: unknown): SnapshotExtra | null {
  if (!isObject(raw)) return null
  const id = num(raw.id)
  const periodId = num(raw.periodId)
  const priceDelta = num(raw.priceDelta)
  if (id === null || periodId === null || priceDelta === null) return null
  return { id, periodId, componentName: str(raw.componentName) ?? "", priceDelta, bufferRemaining: num(raw.bufferRemaining) }
}

function parseAccount(raw: unknown): SnapshotAccount | null {
  if (!isObject(raw)) return null
  const id = num(raw.id)
  if (id === null) return null
  return { id, accountNumber: str(raw.accountNumber) ?? "", name: str(raw.name) ?? "" }
}

function list<T>(value: unknown, parse: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map(parse).filter((item): item is T => item !== null)
}

// null when the parts every use depends on are missing. Malformed items are dropped, not the whole snapshot.
export function parseSnapshot(body: unknown): OfflineSnapshot | null {
  if (!isObject(body)) return null
  const snapshotVersion = str(body.snapshotVersion)
  const tradingDay = str(body.tradingDay)
  if (!snapshotVersion || !tradingDay || !Array.isArray(body.periods) || !Array.isArray(body.options)) return null
  const accountsEnabled = body.accountsEnabled === true
  const limits = isObject(body.limits) ? body.limits : null
  const maxOfflineHours = num(limits?.maxOfflineHours)
  const warnOfflineHours = num(limits?.warnOfflineHours)
  return {
    snapshotVersion,
    generatedAt: str(body.generatedAt),
    serverTimeUtc: str(body.serverTimeUtc),
    tradingDay,
    periods: list(body.periods, parsePeriod),
    options: list(body.options, parseOption),
    extras: list(body.extras, parseExtra),
    vatRate: num(body.vatRate),
    receiptSettings: parseReceiptSettings(body.receiptSettings),
    tenders: Array.isArray(body.tenders) ? body.tenders.filter((t): t is string => typeof t === "string") : [],
    accountsEnabled,
    accountCap: accountsEnabled ? num(body.accountCap) : null,
    accounts: accountsEnabled && Array.isArray(body.accounts) ? list(body.accounts, parseAccount) : null,
    limits: maxOfflineHours !== null && warnOfflineHours !== null ? { maxOfflineHours, warnOfflineHours } : null,
  }
}

// ---- POST /pos/offline/status (contract 9) ----

export const APP_VERSION_MAX_LENGTH = 50

export interface StatusPending {
  shiftId: number
  tradingDay: string
  count: number
  oldestSoldAt?: string
}

export interface StatusReport {
  pendingCount: number
  pending: StatusPending[]
  tillClockUtc: string
  oldestPendingSoldAt?: string
  lastSyncAt?: string
  offlineSince?: string
  appVersion?: string
}

export interface StatusReply {
  receivedAt: string | null
  // till clock − server clock: positive when the till is ahead.
  clockSkewMs: number | null
  serverTimeUtc: string | null
}

export function parseStatusReply(body: unknown): StatusReply | null {
  if (!isObject(body)) return null
  return { receivedAt: str(body.receivedAt), clockSkewMs: num(body.clockSkewMs), serverTimeUtc: str(body.serverTimeUtc) }
}
