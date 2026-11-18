// O4: sending the outbox (docs/2026-11-18-o4-offline-sync-api-contract.md, sections 2 to 4). The till's cookie
// only: no session, so it runs signed out, locked or on the sign-in page.
//
// - Sendable sales (PENDING) go oldest first, at most 50 per batch, with the signed grants they were made under
//   (at most 10), and the body under 512 KB. tillClockAtSendUtc is the till's own clock when the batch leaves.
// - Per sale: CREATED, CREATED_WITH_EXCEPTIONS and DUPLICATE are SYNCED; INVALID and REFUSED are kept, flagged, and
//   never resent automatically. An answer the till doesn't know leaves the sale PENDING (nothing is guessed).
// - Whole batch: 403 DEVICE_NOT_REGISTERED, 400 INVALID_BATCH, 413 and 415 stop sync (a manager alert); a 5xx, a
//   network failure or any other answer waits and resends the same sales (recorded ones come back as DUPLICATE).
// - Nothing unsynced is ever deleted (rule I). SYNCED entries go 7 days after their sync.

import { readApiError } from "@/lib/api-error"
import { fetchWithTimeout } from "@/lib/net"
import type { OfflineSalePayload } from "@/lib/offline/offline-sale"
import { isSendable, markRejected, markSynced, type OutboxEntry, type SaleException, type SyncedResult } from "@/lib/offline/outbox"

export const SALES_PER_BATCH = 50
export const GRANTS_PER_BATCH = 10
// The contract's 512 KB, with room for the server's own accounting.
export const BATCH_BYTES_LIMIT = 500 * 1024
export const SALES_SYNC_TIMEOUT_MS = 60_000
// Waits before resend n (1-based) after a 5xx or a network failure; the last one repeats.
export const SYNC_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000]

export function retryDelayMs(attempt: number): number {
  return SYNC_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1), SYNC_RETRY_DELAYS_MS.length) - 1]
}

// ---- Building a batch ----

export type SyncSale = OfflineSalePayload & { tillClockAtSendUtc: string }

export interface SalesBatch {
  // The body of POST /pos/offline/sales.
  body: { grants: string[]; sales: SyncSale[] }
  // The sales in the batch, in the body's order.
  clientOrderIds: string[]
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

// The next batch: sendable sales oldest first, within the sale, grant and size limits. onlyIds: resend exactly
// these sales (after a failure), those still sendable. Null when there is nothing to send.
export function buildBatch(entries: OutboxEntry[], tillClockAtSendUtc: string, onlyIds: string[] | null = null): SalesBatch | null {
  const candidates = entries
    .filter((entry) => isSendable(entry) && (onlyIds === null || onlyIds.includes(entry.clientOrderId)))
    .sort((a, b) => a.soldAt.localeCompare(b.soldAt) || a.payload.offlineSeq - b.payload.offlineSeq)

  const grants = new Map<string, string>()
  const sales: SyncSale[] = []
  const clientOrderIds: string[] = []
  for (const entry of candidates) {
    if (sales.length >= SALES_PER_BATCH) break
    const newGrant = !grants.has(entry.grantId)
    if (newGrant && grants.size >= GRANTS_PER_BATCH) continue
    const sale: SyncSale = { ...entry.payload, tillClockAtSendUtc }
    const nextGrants = newGrant ? [...Array.from(grants.values()), entry.grant] : Array.from(grants.values())
    // The first sale always goes, so a batch is never empty while something is sendable.
    if (sales.length > 0 && byteLength({ grants: nextGrants, sales: [...sales, sale] }) > BATCH_BYTES_LIMIT) break
    if (newGrant) grants.set(entry.grantId, entry.grant)
    sales.push(sale)
    clientOrderIds.push(entry.clientOrderId)
  }
  if (sales.length === 0) return null
  return { body: { grants: Array.from(grants.values()), sales }, clientOrderIds }
}

// ---- The response (contract section 4) ----

export type SaleResultValue = "CREATED" | "CREATED_WITH_EXCEPTIONS" | "DUPLICATE" | "INVALID" | "REFUSED"

export interface SaleResult {
  clientOrderId: string | null
  result: string
  orderId: number | null
  orderNumber: number | null
  receiptNumber: string | null
  collectionNumber: string | null
  exceptions: SaleException[]
  error: string | null
  code: string | null
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const str = (value: unknown) => (typeof value === "string" ? value : null)
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

function parseException(raw: unknown): SaleException | null {
  if (!isObject(raw) || typeof raw.code !== "string") return null
  return { code: raw.code, severity: str(raw.severity) ?? "" }
}

export function parseSaleResult(raw: unknown): SaleResult | null {
  if (!isObject(raw) || typeof raw.result !== "string") return null
  return {
    clientOrderId: str(raw.clientOrderId),
    result: raw.result,
    orderId: num(raw.orderId),
    orderNumber: num(raw.orderNumber),
    receiptNumber: str(raw.receiptNumber),
    collectionNumber: str(raw.collectionNumber),
    exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.map(parseException).filter((e): e is SaleException => e !== null) : [],
    error: str(raw.error),
    code: str(raw.code),
  }
}

export type SyncStopReason = "DEVICE_NOT_REGISTERED" | "INVALID_BATCH" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE"

export type BatchOutcome =
  | { kind: "ok"; results: Array<SaleResult | null>; serverTimeUtc: string | null }
  | { kind: "stop"; reason: SyncStopReason }
  // 5xx, network failure, timeout, or an answer the contract doesn't list: wait and resend the same sales.
  | { kind: "retry" }

export async function sendBatch(apiBase: string, batch: SalesBatch): Promise<BatchOutcome> {
  const url = `${apiBase}/pos/offline/sales`
  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch.body),
      },
      SALES_SYNC_TIMEOUT_MS,
    )
  } catch {
    return { kind: "retry" }
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as unknown
    if (!isObject(body) || !Array.isArray(body.results)) return { kind: "retry" }
    return { kind: "ok", results: body.results.map(parseSaleResult), serverTimeUtc: str(body.serverTimeUtc) }
  }
  if (res.status === 413) return { kind: "stop", reason: "PAYLOAD_TOO_LARGE" }
  if (res.status === 415) return { kind: "stop", reason: "UNSUPPORTED_MEDIA_TYPE" }
  const { code } = await readApiError(res)
  if (res.status === 403 && code === "DEVICE_NOT_REGISTERED") return { kind: "stop", reason: "DEVICE_NOT_REGISTERED" }
  if (res.status === 400 && code === "INVALID_BATCH") return { kind: "stop", reason: "INVALID_BATCH" }
  return { kind: "retry" }
}

// ---- Applying the results ----

export interface ApplySummary {
  synced: number
  rejected: number
  // Results the till didn't recognise: those sales stay PENDING.
  unknown: number
}

const SYNCED_RESULTS = new Set<string>(["CREATED", "CREATED_WITH_EXCEPTIONS", "DUPLICATE"])

// Results come one per sale, in the batch's order (contract section 4). A result naming a clientOrderId that isn't
// at its position is matched by that id; an INVALID result may have no clientOrderId and goes by position.
export async function applyResults(batch: SalesBatch, results: Array<SaleResult | null>, syncedAt: string): Promise<ApplySummary> {
  const summary: ApplySummary = { synced: 0, rejected: 0, unknown: 0 }
  for (let index = 0; index < batch.clientOrderIds.length; index += 1) {
    const result = results[index] ?? null
    const positional = batch.clientOrderIds[index]
    const id = result?.clientOrderId && batch.clientOrderIds.includes(result.clientOrderId) ? result.clientOrderId : positional
    if (!result) {
      summary.unknown += 1
      continue
    }
    if (SYNCED_RESULTS.has(result.result)) {
      const synced: SyncedResult = {
        result: result.result as SyncedResult["result"],
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        receiptNumber: result.receiptNumber,
        collectionNumber: result.collectionNumber,
        exceptions: result.exceptions,
      }
      if (await markSynced(id, synced, syncedAt)) summary.synced += 1
    } else if (result.result === "INVALID" || result.result === "REFUSED") {
      if (await markRejected(id, result.result, result.error, result.code)) summary.rejected += 1
    } else {
      summary.unknown += 1
    }
  }
  return summary
}
