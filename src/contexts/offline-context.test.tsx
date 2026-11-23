// O3: the offline provider: when the snapshot and grant are fetched, and the deletion rules (contract 5, 6, 8, 10.1).
import "fake-indexeddb/auto"
import { act, cleanup, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineProvider, useOffline, type OfflineContextValue } from "@/contexts/offline-context"
import {
  OFFLINE_DB_NAME,
  getGrant,
  getSnapshot,
  getUnlockVerifier,
  putGrant,
  putSnapshot,
  putUnlockVerifier,
  resetOfflineDbForTests,
} from "@/lib/offline/db"
import { setServerTimeOffset } from "@/lib/offline/server-time"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"

const API = "/api" // T1-0d: the API is /api on the page's own address

// ---- Mocked session, shift and connection ----

type User = { email: string; cashierId?: number; id?: string; role?: string }
let auth: { user: User | null; isAuthenticated: boolean }
let shiftId: number | null
let online: boolean

const fetchMock = vi.fn<typeof fetch>()
const authFetch = (path: string, init?: RequestInit) => fetchMock(`${API}${path}`, init)

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ ...auth, authFetch }) }))
vi.mock("@/hooks/use-shift", () => ({ useShift: () => ({ shift: shiftId === null ? null : { id: shiftId } }) }))
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: online }) }))

// ---- The server ----

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const thandi: User = { email: "thandi@x.co", cashierId: 17, role: "CASHIER" }
const admin: User = { email: "boss@x.co", id: "1", role: "ADMIN" }
const ownShift = { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false }

let tillStatus: Record<string, unknown>
let grantAnswer: () => Response
let snapshotAnswer: () => Response

const calls = (pathEnd: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(pathEnd))
const grants = () => calls("/pos/offline/grant").length
const snapshots = () => calls("/pos/offline/snapshot").length
const statusReads = () => calls("/pos/till-status").length

const verifier = { userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 1, hash: "aGFzaA==", createdAt: "2026-11-18T06:00:00Z" }

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  auth = { user: thandi, isAuthenticated: true }
  shiftId = 412
  online = true
  tillStatus = { registered: true, tillCode: "T1", tillName: "Till 1", shift: ownShift, offlineEnabled: true, maxOfflineHours: 6, warnOfflineHours: 5 }
  grantAnswer = () => json(201, grantBody)
  snapshotAnswer = () => json(200, snapshotBody())
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/pos/till-status")) return json(200, tillStatus)
    if (url.endsWith("/pos/offline/grant")) return grantAnswer()
    if (url.endsWith("/pos/offline/snapshot")) return snapshotAnswer()
    return json(404, {})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  // Unmount first (the shared cleanup runs after this hook), then let a sync in flight finish before the reset.
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 150))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setServerTimeOffset(null)
  await resetOfflineDbForTests()
})

let current: OfflineContextValue
function Probe() {
  current = useOffline()
  return null
}
const tree = () => (
  <OfflineProvider>
    <Probe />
  </OfflineProvider>
)

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
}

async function mount() {
  const view = render(tree())
  await vi.waitFor(() => expect(statusReads()).toBeGreaterThan(0))
  await settle()
  return { rerender: async () => { view.rerender(tree()); await settle() } }
}

async function fiveMinutes() {
  await act(async () => {
    vi.advanceTimersByTime(5 * 60_000)
  })
  await settle()
}

describe("snapshot", () => {
  it("is fetched at sign-in, every 5 minutes online and on reconnect, and exposed", async () => {
    const view = await mount()
    expect(snapshots()).toBe(1)
    expect(current.snapshot?.snapshotVersion).toBe("v1")

    await fiveMinutes()
    expect(snapshots()).toBe(2)

    online = false
    await view.rerender()
    await fiveMinutes()
    expect(snapshots()).toBe(2)

    online = true
    await view.rerender()
    expect(snapshots()).toBe(3)
  })

  it("is fetched when a shift opens", async () => {
    shiftId = null
    tillStatus.shift = null
    const view = await mount()
    const before = snapshots()
    shiftId = 412
    tillStatus.shift = ownShift
    await view.rerender()
    expect(snapshots()).toBe(before + 1)
  })

  it("is never fetched with offlineEnabled false, and neither is a grant", async () => {
    tillStatus.offlineEnabled = false
    await mount()
    await fiveMinutes()
    expect(statusReads()).toBeGreaterThan(0)
    expect(snapshots()).toBe(0)
    expect(grants()).toBe(0)
  })

  it("needs a session: nothing is fetched while signed out", async () => {
    auth = { user: null, isAuthenticated: false }
    await mount()
    expect(snapshots()).toBe(0)
    expect(grants()).toBe(0)
  })

  it("fetched with no open shift, is stored without accounts; the first refresh in a shift gets them", async () => {
    shiftId = null
    tillStatus.shift = null
    const view = await mount()
    expect((await getSnapshot())?.snapshot.accounts).toBeNull()
    expect(current.snapshot?.options).toHaveLength(1)

    shiftId = 412
    tillStatus.shift = ownShift
    await view.rerender()
    await vi.waitFor(async () => expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1))
    const lastSnapshotCall = calls("/pos/offline/snapshot").at(-1)
    expect(new Headers(lastSnapshotCall?.[1]?.headers).has("If-None-Match")).toBe(false)
  })

  it("keeps the stored one when a refresh fails", async () => {
    await putSnapshot(snapshotBody("old"), '"old"')
    snapshotAnswer = () => json(503, {})
    await mount()
    expect(current.snapshot?.snapshotVersion).toBe("old")
  })
})

describe("grant", () => {
  it("is fetched for the owner of this till's open shift, and exposed", async () => {
    await mount()
    expect(grants()).toBe(1)
    expect(current.grant?.grant).toBe("opaque.grant.string")
  })

  it("is fetched after the shift opens", async () => {
    shiftId = null
    tillStatus.shift = null
    const view = await mount()
    expect(grants()).toBe(0)
    shiftId = 412
    tillStatus.shift = ownShift
    await view.rerender()
    expect(grants()).toBe(1)
  })

  it("is fetched again at every sign-in or resume by the owner, but not on a plain refresh", async () => {
    const view = await mount()
    await fiveMinutes()
    expect(grants()).toBe(1)
    auth = { user: { ...thandi }, isAuthenticated: true } // signed in again: a new user object
    await view.rerender()
    expect(grants()).toBe(2)
  })

  it("is renewed when less than maxOfflineHours is left, by server time", async () => {
    // The server's clock agrees with the till's here (the fixtures' serverTimeUtc would move it).
    grantAnswer = () => json(201, { ...grantBody, serverTimeUtc: undefined })
    snapshotAnswer = () => json(200, { ...snapshotBody(), serverTimeUtc: undefined })
    await mount()
    expect(grants()).toBe(1)
    // expiresAt is 00:02:11; at 18:05 less than 6 hours are left.
    vi.setSystemTime(new Date("2026-11-18T18:00:00Z"))
    await fiveMinutes()
    await vi.waitFor(() => expect(grants()).toBe(2))
  })

  it("isn't asked for by an admin covering someone else's shift", async () => {
    auth = { user: admin, isAuthenticated: true }
    await mount()
    expect(grants()).toBe(0)
    expect(current.grantRefused).toBe(false)
  })

  it("NOT_SHIFT_OWNER is quiet: not ready, the stored grant kept, and no retry until the next sign-in", async () => {
    await putGrant(grantBody)
    grantAnswer = () => json(403, { error: "Not the owner", code: "NOT_SHIFT_OWNER" })
    await mount()
    expect(current.grantRefused).toBe(true)
    expect(await getGrant()).not.toBeNull()
    await fiveMinutes()
    expect(grants()).toBe(1)
  })

  it.each(["NO_OPEN_SHIFT", "DEVICE_NOT_REGISTERED", "OFFLINE_DISABLED"])("%s deletes the grant and the unlock value", async (code) => {
    await putGrant(grantBody)
    await putUnlockVerifier(verifier)
    grantAnswer = () => json(code === "NO_OPEN_SHIFT" ? 409 : 403, { error: "No", code })
    await mount()
    expect(await getGrant()).toBeNull()
    expect(await getUnlockVerifier()).toBeNull()
  })

  it("keeps the grant when the request gets no answer", async () => {
    await putGrant(grantBody)
    grantAnswer = () => {
      throw new TypeError("Failed to fetch")
    }
    await mount()
    expect(await getGrant()).not.toBeNull()
  })
})

describe("deleting", () => {
  async function stored() {
    await putGrant(grantBody)
    await putUnlockVerifier(verifier)
    await putSnapshot(snapshotBody(), '"v1"')
  }

  it("at shift close: the grant, the unlock value and the accounts list; the menu stays", async () => {
    await stored()
    const view = await mount()
    shiftId = null
    tillStatus.shift = null
    await view.rerender()
    await vi.waitFor(async () => expect(await getGrant()).toBeNull())
    expect(await getUnlockVerifier()).toBeNull()
    const snapshot = await getSnapshot()
    expect(snapshot?.snapshot.options).toHaveLength(1)
    expect(snapshot?.snapshot.accounts).toBeNull()
  })

  it("at a force close seen in till-status (the till's own view not yet changed)", async () => {
    await stored()
    await mount()
    tillStatus.shift = null
    await fiveMinutes()
    await vi.waitFor(async () => expect(await getGrant()).toBeNull())
    expect(await getUnlockVerifier()).toBeNull()
    expect((await getSnapshot())?.snapshot.accounts).toBeNull()
  })

  it("when another cashier opens a shift on this till", async () => {
    await stored()
    tillStatus.shift = { ...ownShift, shiftId: 413, ownerId: 23, ownerName: "Sipho Dlamini" }
    shiftId = 413
    auth = { user: { email: "sipho@x.co", cashierId: 23, role: "CASHIER" }, isAuthenticated: true }
    grantAnswer = () => json(201, { ...grantBody, shiftId: 413, cashierId: 23, cashierName: "Sipho Dlamini" })
    await mount()
    expect(await getUnlockVerifier()).toBeNull()
    expect((await getGrant())?.grant.cashierId).toBe(23)
  })

  it("when the till is revoked: everything", async () => {
    await stored()
    tillStatus = { registered: false, tillCode: null, tillName: null, shift: null, offlineEnabled: true }
    await mount()
    expect(await getGrant()).toBeNull()
    expect(await getUnlockVerifier()).toBeNull()
    expect(await getSnapshot()).toBeNull()
  })

  it("when offline is turned off: the grant and the unlock value; the snapshot stays", async () => {
    await stored()
    tillStatus.offlineEnabled = false
    await mount()
    expect(await getGrant()).toBeNull()
    expect(await getUnlockVerifier()).toBeNull()
    expect(await getSnapshot()).not.toBeNull()
  })

  it("also while signed out (the rules need only till-status)", async () => {
    await stored()
    auth = { user: null, isAuthenticated: false }
    tillStatus.shift = null
    await mount()
    expect(await getGrant()).toBeNull()
  })

  it("never when till-status gets no answer", async () => {
    await stored()
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch")
    })
    await mount()
    expect(await getGrant()).not.toBeNull()
    expect(await getUnlockVerifier()).not.toBeNull()
    expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1)
  })
})
