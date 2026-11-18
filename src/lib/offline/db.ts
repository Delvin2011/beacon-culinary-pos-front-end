// O3: what the till keeps for offline use, in IndexedDB. Every helper handles its own errors and returns null or
// false: storage can never break an online sale. When the database can't be opened (private window, blocked site
// data, no IndexedDB), the till works online as before and is "not ready" for offline.

import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import { parseGrant, parseSnapshot, type OfflineGrant, type OfflineSnapshot } from "@/lib/offline/contract"
import type { OutboxEntry } from "@/lib/offline/outbox"
import { onServerTimeChange, serverTimeOffsetMs, setServerTimeOffset } from "@/lib/offline/server-time"
import type { TillStatus } from "@/lib/till"
import type { Shift } from "@/contexts/shift-context"

export const OFFLINE_DB_NAME = "beacon-pos-offline"
export const OFFLINE_DB_VERSION = 1
export const OPEN_TIMEOUT_MS = 3_000

// Single-record stores use this key.
const CURRENT = "current"
// O4: the key of the till's offline number counter, read and written in the outbox's sale transaction.
export const OFFLINE_SEQ_KEY = CURRENT

export interface StoredGrant {
  // The POST /pos/offline/grant response exactly as received.
  body: unknown
  receivedAt: string
}

export interface StoredSnapshot {
  body: unknown
  etag: string | null
  receivedAt: string
}

// D13: the offline unlock check value. Never the PIN.
export interface UnlockVerifier {
  userId: number
  // null: made at a sign-in before the shift opened; bound to the shift when its owner opens it.
  shiftId: number | null
  salt: string // base64
  iterations: number
  hash: string // base64
  createdAt: string
}

// From the grant, for O4's offline numbering (contract 7).
export interface OfflineSeqRecord {
  nextOfflineSeq: number
  tradingDay: string
  shiftId: number
}

export type PersistResult = "persisted" | "not-persisted" | "unsupported"

export interface MetaValues {
  offlineSince: string
  serverTimeOffsetMs: number
  lastSnapshotAt: string
  lastStatusAt: string
  unlockFailures: number
  heartbeatStopped: boolean
  persistResult: PersistResult
  clockSkewMs: number
  // The last till-status answer, for readiness after a reload while offline.
  tillStatus: TillStatus
  // The last shift loaded online, restored after a reload while offline (only with a valid grant for it).
  lastShift: Shift
  // PBKDF2 iterations for the offline unlock, measured once on this till (about 0.4 s per check).
  unlockIterations: number
}

export type MetaKey = keyof MetaValues

interface OfflineDbSchema extends DBSchema {
  grant: { key: string; value: StoredGrant }
  snapshot: { key: string; value: StoredSnapshot }
  unlockVerifier: { key: string; value: UnlockVerifier }
  meta: { key: string; value: unknown }
  // O4: every offline sale until the server has it (and 7 days after). See outbox.ts.
  outbox: { key: string; value: OutboxEntry }
  // Created in O3 but unused: O4 works the ledger out from the outbox. Kept so the database stays at version 1.
  accountLedger: { key: number; value: { accountId: number } & Record<string, unknown> }
  offlineSeq: { key: string; value: OfflineSeqRecord }
}

type OfflineDb = IDBPDatabase<OfflineDbSchema>

// ---- Opening, and whether storage is available ----

export type StorageStatus = "unknown" | "available" | "unavailable"

let status: StorageStatus = "unknown"
let dbPromise: Promise<OfflineDb | null> | null = null
const statusListeners = new Set<(status: StorageStatus) => void>()

function setStatus(next: StorageStatus) {
  if (status === next) return
  status = next
  for (const listener of Array.from(statusListeners)) listener(next)
}

export function offlineStorageStatus(): StorageStatus {
  return status
}

export function onOfflineStorageStatus(listener: (status: StorageStatus) => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

async function open(): Promise<OfflineDb | null> {
  if (typeof indexedDB === "undefined") return null
  let opening: Promise<OfflineDb>
  // indexedDB.open can throw at once (e.g. SecurityError when site data is blocked), before any promise exists.
  try {
    opening = startOpen()
  } catch {
    return null
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), OPEN_TIMEOUT_MS)
  })
  try {
    const db = await Promise.race([opening, timeout])
    // Too slow: treated as unavailable. If it opens later, close that connection rather than leak it.
    if (!db) void opening.then((late) => late.close()).catch(() => {})
    return db
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function startOpen(): Promise<OfflineDb> {
  const opening: Promise<OfflineDb> = openDB<OfflineDbSchema>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("grant")
        db.createObjectStore("snapshot")
        db.createObjectStore("unlockVerifier")
        db.createObjectStore("meta")
        db.createObjectStore("outbox", { keyPath: "clientOrderId" })
        db.createObjectStore("accountLedger", { keyPath: "accountId" })
        db.createObjectStore("offlineSeq")
      }
    },
    // Another tab needs a newer version: let it, and open again next time.
    blocking() {
      void opening.then((db) => db.close())
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
  })
  return opening
}

// The database, opened once; null when storage is unavailable.
export function openOfflineDb(): Promise<OfflineDb | null> {
  if (!dbPromise) {
    dbPromise = open().then((db) => {
      setStatus(db ? "available" : "unavailable")
      if (!db) dbPromise = null
      return db
    })
  }
  return dbPromise
}

async function withDb<T>(fallback: T, run: (db: OfflineDb) => Promise<T>): Promise<T> {
  const db = await openOfflineDb()
  if (!db) return fallback
  try {
    return await run(db)
  } catch {
    return fallback
  }
}

// Tests only: close the connection and forget the status.
export async function resetOfflineDbForTests(): Promise<void> {
  const pending = dbPromise
  dbPromise = null
  status = "unknown"
  const db = pending ? await pending.catch(() => null) : null
  db?.close()
}

// ---- Grant ----

export function putGrant(body: unknown, receivedAt: string = new Date().toISOString()): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.put("grant", { body, receivedAt }, CURRENT)
    return true
  })
}

// The stored grant, read through the contract parser; null when none is stored or it can't be read.
export function getGrant(): Promise<{ grant: OfflineGrant; receivedAt: string } | null> {
  return withDb(null, async (db) => {
    const stored = await db.get("grant", CURRENT)
    const grant = stored ? parseGrant(stored.body) : null
    return grant && stored ? { grant, receivedAt: stored.receivedAt } : null
  })
}

// ---- Snapshot ----

export function putSnapshot(body: unknown, etag: string | null, receivedAt: string = new Date().toISOString()): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.put("snapshot", { body, etag, receivedAt }, CURRENT)
    return true
  })
}

export function getSnapshot(): Promise<{ snapshot: OfflineSnapshot; etag: string | null; receivedAt: string } | null> {
  return withDb(null, async (db) => {
    const stored = await db.get("snapshot", CURRENT)
    const snapshot = stored ? parseSnapshot(stored.body) : null
    return snapshot && stored ? { snapshot, etag: stored.etag, receivedAt: stored.receivedAt } : null
  })
}

// Shift close, sign-out (contract 11) and revoke: the accounts list goes; the rest holds no personal data.
// The ETag goes too, so the next refresh returns 200 with the list instead of a 304.
export function clearSnapshotAccounts(): Promise<boolean> {
  return withDb(false, async (db) => {
    const tx = db.transaction("snapshot", "readwrite")
    const stored = await tx.store.get(CURRENT)
    if (stored && typeof stored.body === "object" && stored.body !== null) {
      const body = { ...(stored.body as Record<string, unknown>) }
      delete body.accounts
      await tx.store.put({ ...stored, body, etag: null }, CURRENT)
    }
    await tx.done
    return true
  })
}

// ---- Unlock check value (D13) ----

export function putUnlockVerifier(verifier: UnlockVerifier): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.put("unlockVerifier", verifier, CURRENT)
    return true
  })
}

export function getUnlockVerifier(): Promise<UnlockVerifier | null> {
  return withDb(null, async (db) => (await db.get("unlockVerifier", CURRENT)) ?? null)
}

// ---- Offline numbering (O4) ----

export function putOfflineSeq(record: OfflineSeqRecord): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.put("offlineSeq", record, CURRENT)
    return true
  })
}

export function getOfflineSeq(): Promise<OfflineSeqRecord | null> {
  return withDb(null, async (db) => (await db.get("offlineSeq", CURRENT)) ?? null)
}

// ---- Meta ----

export function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | null> {
  return withDb(null, async (db) => ((await db.get("meta", key)) as MetaValues[K] | undefined) ?? null)
}

export function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.put("meta", value, key)
    return true
  })
}

export function deleteMeta(key: MetaKey): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.delete("meta", key)
    return true
  })
}

// ---- Deleting ----

// Shift closed, another cashier's shift, offline turned off, NO_OPEN_SHIFT and the like: the grant and the
// unlock value go together. The snapshot stays (it holds no secrets).
export function deleteGrantAndUnlock(): Promise<boolean> {
  return withDb(false, async (db) => {
    const tx = db.transaction(["grant", "unlockVerifier"], "readwrite")
    await Promise.all([tx.objectStore("grant").delete(CURRENT), tx.objectStore("unlockVerifier").delete(CURRENT), tx.done])
    return true
  })
}

// Only the unlock value: it belongs to a shift that isn't this till's open shift (the grant may be another's).
export function deleteUnlockVerifier(): Promise<boolean> {
  return withDb(false, async (db) => {
    await db.delete("unlockVerifier", CURRENT)
    return true
  })
}

// The till was revoked: everything goes, except the outbox. Its sales still sync (the server accepts a revoked
// till's sales, flagged), and each entry carries its own grant string.
export function wipeAll(): Promise<boolean> {
  return withDb(false, async (db) => {
    const stores = ["grant", "snapshot", "unlockVerifier", "meta", "accountLedger", "offlineSeq"] as const
    const tx = db.transaction(stores, "readwrite")
    await Promise.all([...stores.map((name) => tx.objectStore(name).clear()), tx.done])
    return true
  })
}

// ---- Persistent storage ----

// Asks the browser not to evict this site's data, and records the answer for the devices page.
export async function requestPersistentStorage(): Promise<PersistResult> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined
  let result: PersistResult
  if (!storage || typeof storage.persist !== "function") {
    result = "unsupported"
  } else {
    try {
      const already = typeof storage.persisted === "function" ? await storage.persisted() : false
      result = already || (await storage.persist()) ? "persisted" : "not-persisted"
    } catch {
      result = "not-persisted"
    }
  }
  await setMeta("persistResult", result)
  return result
}

// ---- Server time offset across reloads ----

// After a reload: the last known offset, until a fresh server time arrives.
export async function restoreServerTime(): Promise<void> {
  if (serverTimeOffsetMs() !== null) return
  const stored = await getMeta("serverTimeOffsetMs")
  if (typeof stored === "number" && serverTimeOffsetMs() === null) setServerTimeOffset(stored)
}

// Saves each new offset; returns the unsubscribe.
export function persistServerTime(): () => void {
  return onServerTimeChange((offset) => {
    if (offset !== null) void setMeta("serverTimeOffsetMs", offset)
  })
}
