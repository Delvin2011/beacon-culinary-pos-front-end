// O4: the outbox. Every offline sale, from the moment it's confirmed until the server has it (and 7 days after, for
// lookup). Contract: docs/2026-11-18-o4-offline-sync-api-contract.md.
//
// - Recording is ONE IndexedDB transaction: the sale goes in (status PENDING) and the till's number counter moves
//   on, checked against the account cap inside the same transaction. The receipt prints only after it commits.
// - Portion counts and the account ledger aren't stored separately: they're worked out from the outbox, so they
//   can never disagree with the sales recorded.
// - Rule I: nothing unsynced is ever deleted or changed, apart from its status once the server answers, or an
//   ADMIN's "Handed to support" note. The only delete is a SYNCED entry older than 7 days.
// - Each entry keeps the signed grant it was made under, so the grant lives exactly as long as its unsent sales,
//   through a newer grant and through a revoke (wipeAll keeps the outbox).

import { OFFLINE_SEQ_KEY, openOfflineDb } from "@/lib/offline/db"
import { toCents } from "@/lib/offline/cents"
import { accountCapMessage, type OfflineSalePayload } from "@/lib/offline/offline-sale"

export const SYNCED_KEPT_MS = 7 * 24 * 3_600_000

export type OutboxStatus = "PENDING" | "SYNCED" | "INVALID" | "REFUSED"

export interface SaleException {
  code: string
  severity: string
}

// What the server said for a recorded sale (CREATED, CREATED_WITH_EXCEPTIONS, DUPLICATE).
export interface SyncedResult {
  result: "CREATED" | "CREATED_WITH_EXCEPTIONS" | "DUPLICATE"
  orderId: number | null
  orderNumber: number | null
  receiptNumber: string | null
  collectionNumber: string | null
  exceptions: SaleException[]
}

// What the slips need beyond the payload.
export interface OutboxPrint {
  tillCode: string
  tillName: string | null
  cashierName: string
  accountNames: Record<number, string>
}

export interface HandedToSupport {
  at: string
  by: string
  reason: string
}

export type OutboxEntry = {
  clientOrderId: string
  status: OutboxStatus
  // The contract's sale, without tillClockAtSendUtc (set when sent).
  payload: OfflineSalePayload
  // The signed grant string the sale was made under, exactly as received.
  grant: string
  grantId: string
  shiftId: number
  tradingDay: string
  soldAt: string
  // Server-corrected time it was written.
  recordedAt: string
  // An O1 sale whose outcome was unknown, moved into the outbox (decision H).
  wasPendingOnline: boolean
  print: OutboxPrint
  // Set once the server has it (server-corrected time).
  syncedAt: string | null
  result: SyncedResult | null
  // INVALID / REFUSED: the server's error and code.
  error: string | null
  code: string | null
  // INVALID / REFUSED kept but no longer counted as waiting, after an ADMIN handed it to support.
  handedToSupport: HandedToSupport | null
}

export type NewOutboxEntry = Omit<OutboxEntry, "status" | "syncedAt" | "result" | "error" | "code" | "handedToSupport">

// ---- Recording ----

export type RecordOutcome =
  | { kind: "recorded" }
  // Another sale took this number first (a second tab): build the sale again with `next`.
  | { kind: "seq-taken"; next: number }
  | { kind: "over-cap"; message: string }
  // The clientOrderId is already in the outbox: never written twice.
  | { kind: "exists" }
  // Storage unavailable, full or failed: nothing was written. Don't print, don't complete the sale.
  | { kind: "failed" }

function accountPayments(payload: OfflineSalePayload): Array<{ accountId: number; cents: number }> {
  return payload.payments.flatMap((payment) =>
    payment.method === "ACCOUNT" ? [{ accountId: payment.accountId, cents: toCents(payment.amount) ?? 0 }] : [],
  )
}

// One transaction: the sale, the number counter and the account-cap check. accountCapCents is the grant's (or
// snapshot's) cap in cents; null means no cap.
export async function recordOfflineSale(entry: NewOutboxEntry, accountCapCents: number | null): Promise<RecordOutcome> {
  const db = await openOfflineDb()
  if (!db) return { kind: "failed" }
  try {
    const tx = db.transaction(["outbox", "offlineSeq"], "readwrite")
    const outbox = tx.objectStore("outbox")
    const seqStore = tx.objectStore("offlineSeq")

    if (await outbox.get(entry.clientOrderId)) {
      tx.abort()
      await tx.done.catch(() => {})
      return { kind: "exists" }
    }

    const stored = await seqStore.get(OFFLINE_SEQ_KEY)
    const seq = entry.payload.offlineSeq
    if (stored && stored.tradingDay === entry.tradingDay && stored.nextOfflineSeq > seq) {
      tx.abort()
      await tx.done.catch(() => {})
      return { kind: "seq-taken", next: stored.nextOfflineSeq }
    }

    const charges = accountPayments(entry.payload)
    if (charges.length > 0 && accountCapCents !== null) {
      const all = (await outbox.getAll()) as OutboxEntry[]
      for (const charge of charges) {
        const already = accountChargedCents(all, entry.grantId, charge.accountId)
        const message = accountCapMessage(accountCapCents, already, charge.cents)
        if (message) {
          tx.abort()
          await tx.done.catch(() => {})
          return { kind: "over-cap", message }
        }
      }
    }

    const full: OutboxEntry = { ...entry, status: "PENDING", syncedAt: null, result: null, error: null, code: null, handedToSupport: null }
    await outbox.add(full)
    await seqStore.put({ nextOfflineSeq: seq + 1, tradingDay: entry.tradingDay, shiftId: entry.shiftId }, OFFLINE_SEQ_KEY)
    await tx.done
    return { kind: "recorded" }
  } catch {
    return { kind: "failed" }
  }
}

// ---- Reading ----

const bySoldAt = (a: OutboxEntry, b: OutboxEntry) => a.soldAt.localeCompare(b.soldAt) || a.payload.offlineSeq - b.payload.offlineSeq

// Every entry, oldest sale first. [] when storage is unavailable.
export async function listOutbox(): Promise<OutboxEntry[]> {
  const db = await openOfflineDb()
  if (!db) return []
  try {
    return ((await db.getAll("outbox")) as OutboxEntry[]).sort(bySoldAt)
  } catch {
    return []
  }
}

export async function getOutboxEntry(clientOrderId: string): Promise<OutboxEntry | null> {
  const db = await openOfflineDb()
  if (!db) return null
  try {
    return ((await db.get("outbox", clientOrderId)) as OutboxEntry | undefined) ?? null
  } catch {
    return null
  }
}

// ---- The server's answers (only these change an entry) ----

async function update(clientOrderId: string, change: (entry: OutboxEntry) => OutboxEntry | null): Promise<boolean> {
  const db = await openOfflineDb()
  if (!db) return false
  try {
    const tx = db.transaction("outbox", "readwrite")
    const current = (await tx.store.get(clientOrderId)) as OutboxEntry | undefined
    const next = current ? change(current) : null
    if (!next) {
      tx.abort()
      await tx.done.catch(() => {})
      return false
    }
    await tx.store.put(next)
    await tx.done
    return true
  } catch {
    return false
  }
}

// CREATED, CREATED_WITH_EXCEPTIONS or DUPLICATE: the server has it. The payload is never touched.
export function markSynced(clientOrderId: string, result: SyncedResult, syncedAt: string): Promise<boolean> {
  return update(clientOrderId, (entry) => ({ ...entry, status: "SYNCED", result, syncedAt, error: null, code: null }))
}

// INVALID or REFUSED: kept, flagged, not resent automatically. A SYNCED entry is never moved back.
export function markRejected(clientOrderId: string, status: "INVALID" | "REFUSED", error: string | null, code: string | null): Promise<boolean> {
  return update(clientOrderId, (entry) => (entry.status === "SYNCED" ? null : { ...entry, status, error, code }))
}

// An ADMIN's local note (decision 3): an INVALID or REFUSED entry stays, but no longer counts as waiting.
export function markHandedToSupport(clientOrderId: string, note: HandedToSupport): Promise<boolean> {
  return update(clientOrderId, (entry) =>
    entry.status === "INVALID" || entry.status === "REFUSED" ? { ...entry, handedToSupport: note } : null,
  )
}

// Deletes SYNCED entries synced more than 7 days before `nowMs` (server time). Nothing else is ever deleted.
export async function purgeOldSynced(nowMs: number): Promise<number> {
  const db = await openOfflineDb()
  if (!db) return 0
  try {
    const tx = db.transaction("outbox", "readwrite")
    const all = (await tx.store.getAll()) as OutboxEntry[]
    const old = all.filter((entry) => entry.status === "SYNCED" && entry.syncedAt && Date.parse(entry.syncedAt) < nowMs - SYNCED_KEPT_MS)
    await Promise.all(old.map((entry) => tx.store.delete(entry.clientOrderId)))
    await tx.done
    return old.length
  } catch {
    return 0
  }
}

// ---- Worked out from the outbox ----

// Still waiting for the server: everything not SYNCED, unless an ADMIN handed it to support.
export function isWaiting(entry: OutboxEntry): boolean {
  return entry.status !== "SYNCED" && entry.handedToSupport === null
}

// Not sent yet, or sent but not answered: what sync sends.
export function isSendable(entry: OutboxEntry): boolean {
  return entry.status === "PENDING"
}

// The account's offline charges under one grant, whatever their sync state (the server counts them all).
export function accountChargedCents(entries: OutboxEntry[], grantId: string, accountId: number): number {
  let total = 0
  for (const entry of entries) {
    if (entry.grantId !== grantId) continue
    for (const charge of accountPayments(entry.payload)) if (charge.accountId === accountId) total += charge.cents
  }
  return total
}

export interface SoldQuantities {
  options: Map<number, number>
  extras: Map<number, number>
}

// What the till sold that the snapshot's counts don't include yet: sales of the snapshot's trading day that the
// server didn't have when the snapshot was made (not synced, or synced after generatedAt).
export function soldSinceSnapshot(entries: OutboxEntry[], snapshot: { tradingDay: string; generatedAt: string | null }): SoldQuantities {
  const generatedAt = snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : Number.NaN
  const options = new Map<number, number>()
  const extras = new Map<number, number>()
  const add = (map: Map<number, number>, id: number | null, quantity: number) => {
    if (id !== null) map.set(id, (map.get(id) ?? 0) + quantity)
  }
  for (const entry of entries) {
    if (entry.tradingDay !== snapshot.tradingDay) continue
    const inSnapshot =
      entry.status === "SYNCED" && (Number.isNaN(generatedAt) || (entry.syncedAt !== null && Date.parse(entry.syncedAt) <= generatedAt))
    if (inSnapshot) continue
    for (const line of entry.payload.lines) {
      add(options, line.dailyMealOptionId, line.quantity)
      for (const extra of line.extras) add(extras, extra.dailyComponentStockId, extra.quantity)
    }
  }
  return { options, extras }
}

// The local count: null stays null (not counted, no limit); never below 0 (D4).
export function remainingAfter(snapshotRemaining: number | null, sold: number): number | null {
  if (snapshotRemaining === null) return null
  return Math.max(0, snapshotRemaining - sold)
}

export interface PendingGroup {
  shiftId: number
  tradingDay: string
  count: number
  oldestSoldAt: string
}

export interface PendingSummary {
  pendingCount: number
  pending: PendingGroup[]
  oldestPendingSoldAt: string | null
}

// For the status report (O3 contract 9): waiting sales in total and per shift and trading day.
export function pendingSummary(entries: OutboxEntry[]): PendingSummary {
  const groups = new Map<string, PendingGroup>()
  let oldest: string | null = null
  let count = 0
  for (const entry of entries) {
    if (!isWaiting(entry)) continue
    count += 1
    if (oldest === null || entry.soldAt < oldest) oldest = entry.soldAt
    const key = `${entry.shiftId}|${entry.tradingDay}`
    const group = groups.get(key)
    if (!group) groups.set(key, { shiftId: entry.shiftId, tradingDay: entry.tradingDay, count: 1, oldestSoldAt: entry.soldAt })
    else {
      group.count += 1
      if (entry.soldAt < group.oldestSoldAt) group.oldestSoldAt = entry.soldAt
    }
  }
  return { pendingCount: count, pending: Array.from(groups.values()), oldestPendingSoldAt: oldest }
}

// Waiting sales of one shift ("3 offline sales still to send").
export function waitingForShift(entries: OutboxEntry[], shiftId: number): number {
  return entries.filter((entry) => entry.shiftId === shiftId && isWaiting(entry)).length
}
