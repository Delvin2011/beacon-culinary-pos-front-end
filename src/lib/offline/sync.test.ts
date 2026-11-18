// O3: snapshot refresh (contract 8) and grant request (contract 5, 6, 7), on their own.
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseGrant } from "@/lib/offline/contract"
import {
  OFFLINE_DB_NAME,
  clearSnapshotAccounts,
  getGrant,
  getMeta,
  getOfflineSeq,
  getSnapshot,
  putOfflineSeq,
  putSnapshot,
  resetOfflineDbForTests,
} from "@/lib/offline/db"
import { grantNeedsRenewal, isGrantValid, requestGrant } from "@/lib/offline/grant-sync"
import { serverTimeOffsetMs, setServerTimeOffset } from "@/lib/offline/server-time"
import { refreshSnapshot } from "@/lib/offline/snapshot-sync"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  authFetch.mockReset()
})

afterEach(async () => {
  setServerTimeOffset(null)
  await resetOfflineDbForTests()
})

describe("refreshSnapshot", () => {
  it("stores a 200 with the ETag header, the server time and when it was refreshed", async () => {
    authFetch.mockResolvedValue(json(200, snapshotBody(), { ETag: '"v1"' }))
    expect(await refreshSnapshot(authFetch)).toEqual({ kind: "updated" })
    expect((await getSnapshot())?.etag).toBe('"v1"')
    expect(serverTimeOffsetMs()).not.toBeNull()
    expect(await getMeta("lastSnapshotAt")).not.toBeNull()
    // The browser's own cache must not answer for the server.
    expect(authFetch.mock.calls[0][1]?.cache).toBe("no-store")
  })

  it("rebuilds the ETag from snapshotVersion when the header can't be read (not exposed by CORS)", async () => {
    authFetch.mockResolvedValue(json(200, snapshotBody("9f2c")))
    await refreshSnapshot(authFetch)
    expect((await getSnapshot())?.etag).toBe('"9f2c"')
  })

  it("sends If-None-Match and keeps the stored snapshot on a 304", async () => {
    await putSnapshot(snapshotBody(), '"v1"')
    authFetch.mockResolvedValue(new Response(null, { status: 304 }))
    expect(await refreshSnapshot(authFetch)).toEqual({ kind: "not-modified" })
    expect(new Headers(authFetch.mock.calls[0][1]?.headers).get("If-None-Match")).toBe('"v1"')
    expect((await getSnapshot())?.snapshot.snapshotVersion).toBe("v1")
  })

  it("asks for the full body after the accounts list was cleared", async () => {
    await putSnapshot(snapshotBody(), '"v1"')
    await clearSnapshotAccounts()
    authFetch.mockResolvedValue(json(200, snapshotBody(), { ETag: '"v1"' }))
    await refreshSnapshot(authFetch)
    expect(new Headers(authFetch.mock.calls[0][1]?.headers).has("If-None-Match")).toBe(false)
    expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1)
  })

  it("keeps the stored snapshot when a refresh fails or is refused", async () => {
    await putSnapshot(snapshotBody(), '"v1"')
    authFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    expect(await refreshSnapshot(authFetch)).toEqual({ kind: "failed" })
    authFetch.mockResolvedValueOnce(json(503, {}))
    expect((await refreshSnapshot(authFetch)).kind).toBe("refused")
    authFetch.mockResolvedValueOnce(json(200, { nonsense: true }))
    expect(await refreshSnapshot(authFetch)).toEqual({ kind: "failed" })
    expect((await getSnapshot())?.snapshot.snapshotVersion).toBe("v1")
  })

  it("returns the code of a refusal", async () => {
    authFetch.mockResolvedValue(json(403, { error: "Off", code: "OFFLINE_DISABLED" }))
    expect(await refreshSnapshot(authFetch)).toEqual({ kind: "refused", status: 403, code: "OFFLINE_DISABLED" })
  })
})

describe("requestGrant", () => {
  it("stores the response as received and the offline numbering", async () => {
    authFetch.mockResolvedValue(json(201, grantBody))
    const result = await requestGrant(authFetch)
    expect(result.kind).toBe("ok")
    expect(authFetch.mock.calls[0]).toEqual(["/pos/offline/grant", { method: "POST" }])
    expect((await getGrant())?.grant.grant).toBe("opaque.grant.string")
    expect(await getOfflineSeq()).toEqual({ nextOfflineSeq: 3, tradingDay: "2026-11-18", shiftId: 412 })
  })

  it("keeps the larger next number on the same day, and the server's on a new day", async () => {
    await putOfflineSeq({ nextOfflineSeq: 9, tradingDay: "2026-11-18", shiftId: 400 })
    authFetch.mockImplementation(async () => json(201, grantBody))
    await requestGrant(authFetch)
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(9)

    await putOfflineSeq({ nextOfflineSeq: 9, tradingDay: "2026-11-17", shiftId: 400 })
    await requestGrant(authFetch)
    expect((await getOfflineSeq())?.nextOfflineSeq).toBe(3)
  })

  it("returns the code of a refusal and stores nothing", async () => {
    authFetch.mockResolvedValue(json(403, { error: "Not yours", code: "NOT_SHIFT_OWNER" }))
    expect(await requestGrant(authFetch)).toEqual({ kind: "refused", status: 403, code: "NOT_SHIFT_OWNER" })
    expect(await getGrant()).toBeNull()
  })
})

describe("grant validity", () => {
  const grant = parseGrant(grantBody)!
  const now = Date.parse("2026-11-18T10:00:00Z")
  const ok = { shiftId: 412, ownerId: 17, userId: 17, now }

  it("is valid for this till's shift, its owner signed in, before expiry", () => {
    expect(isGrantValid(grant, ok)).toBe(true)
  })

  it.each([
    ["another shift", { shiftId: 413 }],
    ["no open shift", { shiftId: null }],
    ["someone else signed in", { userId: 23 }],
    ["another owner", { ownerId: 23 }],
    ["expired by server time", { now: Date.parse("2026-11-19T00:02:12Z") }],
  ])("is not valid with %s", (_, change) => {
    expect(isGrantValid(grant, { ...ok, ...change })).toBe(false)
  })

  it("needs renewing when less than maxOfflineHours is left", () => {
    expect(grantNeedsRenewal(grant, 6, Date.parse("2026-11-18T18:00:00Z"))).toBe(false)
    expect(grantNeedsRenewal(grant, 6, Date.parse("2026-11-18T18:03:00Z"))).toBe(true)
  })
})
