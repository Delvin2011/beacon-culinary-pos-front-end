// T1-3: the till's stored offline data (grant, snapshot, PIN check value) is never deleted because of the customer's
// answers. Suspended: no till-status, grant or snapshot call at all, and they start again when it ends.
// Unavailable and an unknown address: the calls fail as in an outage, and what is stored is kept.
import "fake-indexeddb/auto"
import { act, cleanup, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineProvider } from "@/contexts/offline-context"
import { apiFetch } from "@/lib/api-fetch"
import { noteCustomerAnswer } from "@/lib/customer-status"
import { OFFLINE_DB_NAME, getGrant, getSnapshot, getUnlockVerifier, putGrant, putSnapshot, putUnlockVerifier, resetOfflineDbForTests } from "@/lib/offline/db"
import { setServerTimeOffset } from "@/lib/offline/server-time"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"

const thandi = { email: "thandi@x.co", cashierId: 17, role: "CASHIER" }
const authFetch = (path: string, init?: RequestInit) => apiFetch(path, { ...init, credentials: "include" })
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: thandi, isAuthenticated: true, authFetch, endOfflineSession: vi.fn() }) }))
vi.mock("@/hooks/use-shift", () => ({ useShift: () => ({ shift: { id: 412 } }) }))
vi.mock("@/contexts/connection-context", async () => {
  const { useCustomerStatus } = await import("@/hooks/use-customer-status")
  return { useConnection: () => ({ isOnline: true, suspended: useCustomerStatus().suspended }) }
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const SUSPENDED = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
const UNAVAILABLE = () => json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" })
const EMPTY_404 = () => new Response(null, { status: 404 })

const ownShift = { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false }
const tillStatus = { registered: true, tillCode: "T1", tillName: "Till 1", shift: ownShift, offlineEnabled: true, maxOfflineHours: 6, warnOfflineHours: 5 }
const verifier = { userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 1, hash: "aGFzaA==", createdAt: "2026-11-18T06:00:00Z" }

let server: (path: string) => Response
const fetchMock = vi.fn<typeof fetch>()
const paths = () => fetchMock.mock.calls.map(([url]) => String(url))

async function settle(ms = 150) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function stored() {
  const [grant, snapshot, unlock] = await Promise.all([getGrant(), getSnapshot(), getUnlockVerifier()])
  return { grant: grant?.grant.grantId ?? null, snapshot: snapshot?.snapshot.snapshotVersion ?? null, unlock: unlock?.userId ?? null }
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  await putGrant(grantBody)
  await putSnapshot(snapshotBody("v-stored"), '"v-stored"')
  await putUnlockVerifier(verifier)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => server(String(input).replace(/^\/api(?=\/)/, "")))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 150))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setServerTimeOffset(null)
  await resetOfflineDbForTests()
})

const KEPT = { grant: grantBody.grantId, snapshot: "v-stored", unlock: 17 }

describe("the till's offline data and the customer's answers", () => {
  it("CUSTOMER_SUSPENDED: nothing is called, nothing is deleted; the calls start again when it ends", async () => {
    await act(async () => {
      await noteCustomerAnswer(SUSPENDED())
    })
    server = () => SUSPENDED()
    render(<OfflineProvider>{null}</OfflineProvider>)
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000)
    })
    await settle()
    expect(paths()).toEqual([])
    expect(await stored()).toEqual(KEPT)

    server = (path) => (path === "/pos/till-status" ? json(200, tillStatus) : json(200, {}))
    await act(async () => {
      await noteCustomerAnswer(json(200, {}))
    })
    await settle()
    expect(paths()).toContain("/api/pos/till-status")
    expect(await stored()).toMatchObject({ grant: KEPT.grant, unlock: 17 })
  })

  it.each([
    ["CUSTOMER_UNAVAILABLE", UNAVAILABLE],
    ["an unknown address (empty 404 everywhere)", EMPTY_404],
  ])("%s: the calls fail as in an outage, and what is stored is kept", async (_name, answer) => {
    server = () => answer()
    render(<OfflineProvider>{null}</OfflineProvider>)
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    await settle()
    expect(paths()).toContain("/api/pos/till-status")
    expect(await stored()).toEqual(KEPT)
  })
})
