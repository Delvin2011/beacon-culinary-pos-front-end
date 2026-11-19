// O3: the till's offline store (IndexedDB).
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  OFFLINE_DB_NAME,
  clearSnapshotAccounts,
  deleteGrantAndUnlock,
  getGrant,
  getMeta,
  getOfflineSeq,
  getSnapshot,
  getUnlockVerifier,
  offlineStorageStatus,
  openOfflineDb,
  persistServerTime,
  putGrant,
  putOfflineSeq,
  putSnapshot,
  putUnlockVerifier,
  requestPersistentStorage,
  resetOfflineDbForTests,
  restoreServerTime,
  setMeta,
  wipeAll,
} from "@/lib/offline/db"
import { recordServerTime, serverTimeOffsetMs, setServerTimeOffset } from "@/lib/offline/server-time"

const grantBody = {
  grantId: "g1",
  grant: "opaque.grant.string",
  deviceId: "d1",
  tillCode: "T1",
  shiftId: 412,
  cashierId: 17,
  cashierName: "Thandi Mokoena",
  issuedAt: "2026-11-18T06:02:11Z",
  expiresAt: "2026-11-19T00:02:11Z",
  tradingDay: "2026-11-18",
  nextOfflineSeq: 1,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
  accountsEnabled: true,
  accountCap: 150,
  serverTimeUtc: "2026-11-18T06:02:11Z",
}

const snapshotBody = {
  snapshotVersion: "v1",
  tradingDay: "2026-11-18",
  periods: [],
  options: [{ id: 912, name: "Still water", price: 20, status: "READY", periodId: null }],
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
}

const verifier = { userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 100_000, hash: "aGFzaA==", createdAt: "2026-11-18T06:02:11Z" }

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("offline store", () => {
  it("opens and reports storage as available", async () => {
    expect(offlineStorageStatus()).toBe("unknown")
    expect(await openOfflineDb()).not.toBeNull()
    expect(offlineStorageStatus()).toBe("available")
  })

  it("keeps the grant response as received and reads it through the parser", async () => {
    expect(await putGrant(grantBody, "2026-11-18T06:02:12Z")).toBe(true)
    const stored = await getGrant()
    expect(stored?.grant.grant).toBe("opaque.grant.string")
    expect(stored?.grant.shiftId).toBe(412)
    expect(stored?.receivedAt).toBe("2026-11-18T06:02:12Z")
  })

  it("keeps the snapshot with its ETag", async () => {
    await putSnapshot(snapshotBody, '"v1"')
    const stored = await getSnapshot()
    expect(stored?.etag).toBe('"v1"')
    expect(stored?.snapshot.accounts).toHaveLength(1)
  })

  it("clears the accounts list and the ETag, keeping the menu", async () => {
    await putSnapshot(snapshotBody, '"v1"')
    await clearSnapshotAccounts()
    const stored = await getSnapshot()
    expect(stored?.snapshot.accounts).toBeNull()
    expect(stored?.snapshot.options).toHaveLength(1)
    expect(stored?.etag).toBeNull()
  })

  it("deletes the grant and the unlock value together, keeping the snapshot and numbering", async () => {
    await putGrant(grantBody)
    await putUnlockVerifier(verifier)
    await putSnapshot(snapshotBody, '"v1"')
    await putOfflineSeq({ nextOfflineSeq: 4, tradingDay: "2026-11-18", shiftId: 412 })

    await deleteGrantAndUnlock()
    expect(await getGrant()).toBeNull()
    expect(await getUnlockVerifier()).toBeNull()
    expect(await getSnapshot()).not.toBeNull()
    expect(await getOfflineSeq()).toEqual({ nextOfflineSeq: 4, tradingDay: "2026-11-18", shiftId: 412 })
  })

  it("wipes everything when the till is revoked", async () => {
    await putGrant(grantBody)
    await putUnlockVerifier(verifier)
    await putSnapshot(snapshotBody, '"v1"')
    await putOfflineSeq({ nextOfflineSeq: 4, tradingDay: "2026-11-18", shiftId: 412 })
    await setMeta("offlineSince", "2026-11-18T08:00:00Z")

    await wipeAll()
    expect(await getGrant()).toBeNull()
    expect(await getUnlockVerifier()).toBeNull()
    expect(await getSnapshot()).toBeNull()
    expect(await getOfflineSeq()).toBeNull()
    expect(await getMeta("offlineSince")).toBeNull()
  })

  it("never stores the PIN: the unlock record has only the check value", async () => {
    await putUnlockVerifier(verifier)
    expect(Object.keys((await getUnlockVerifier()) ?? {}).sort()).toEqual(
      ["createdAt", "hash", "iterations", "salt", "shiftId", "userId"],
    )
  })
})

describe("storage unavailable", () => {
  it("reports unavailable and every helper returns empty without throwing", async () => {
    vi.stubGlobal("indexedDB", undefined)
    expect(await openOfflineDb()).toBeNull()
    expect(offlineStorageStatus()).toBe("unavailable")
    expect(await putGrant(grantBody)).toBe(false)
    expect(await getGrant()).toBeNull()
    expect(await getSnapshot()).toBeNull()
    expect(await setMeta("unlockFailures", 1)).toBe(false)
    expect(await wipeAll()).toBe(false)
  })

  it("reports unavailable when the database refuses to open", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("blocked", "SecurityError")
      },
    })
    expect(await openOfflineDb()).toBeNull()
    expect(offlineStorageStatus()).toBe("unavailable")
  })
})

describe("server time across reloads", () => {
  it("saves each offset and restores it after a reload", async () => {
    const stop = persistServerTime()
    recordServerTime("2026-11-18T09:15:02Z", Date.parse("2026-11-18T09:15:00Z"))
    await vi.waitFor(async () => expect(await getMeta("serverTimeOffsetMs")).toBe(2_000))
    stop()

    setServerTimeOffset(null) // the reload
    await restoreServerTime()
    expect(serverTimeOffsetMs()).toBe(2_000)
  })

  it("doesn't overwrite a fresh server time with the stored one", async () => {
    await setMeta("serverTimeOffsetMs", 9_000)
    setServerTimeOffset(1_000)
    await restoreServerTime()
    expect(serverTimeOffsetMs()).toBe(1_000)
  })
})

describe("persistent storage", () => {
  it("records persisted, not persisted and unsupported", async () => {
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => true } })
    expect(await requestPersistentStorage()).toBe("persisted")
    expect(await getMeta("persistResult")).toBe("persisted")

    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => false } })
    expect(await requestPersistentStorage()).toBe("not-persisted")

    vi.stubGlobal("navigator", {})
    expect(await requestPersistentStorage()).toBe("unsupported")
    expect(await getMeta("persistResult")).toBe("unsupported")
  })
})
